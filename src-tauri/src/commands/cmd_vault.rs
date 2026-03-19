use std::fs;
use std::path::Path;
use std::collections::HashSet;
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use futures_util::stream::{self, StreamExt};
use tauri::{AppHandle, State};
use walkdir::WalkDir;

use crate::ai;
use crate::db::{self, DbState};
use crate::models::NoteInfo;
use crate::shared::command_utils::{
    extract_pdf_text, is_mol_extension, is_embeddable_extension, is_molecular_extension,
    is_paper_extension, is_pdf_extension, is_spectroscopy_extension, is_supported_extension,
    is_text_extension, read_ai_config,
};
use crate::AppError;

#[tauri::command]
pub fn init_vault(vault_path: String, db: State<DbState>) -> Result<(), AppError> {
    let new_conn = db::init_db(&vault_path)?;
    let mut conn = db
        .conn
        .lock()
        .map_err(|_| AppError::Lock)?;
    *conn = new_conn;
    Ok(())
}

fn parse_ignored_folders(ignored_folders: Option<String>) -> HashSet<String> {
    ignored_folders
        .unwrap_or_default()
        .split(',')
        .map(|s| s.trim().trim_matches('/').trim_matches('\\').to_string())
        .filter(|s| !s.is_empty())
        .collect()
}

/// Holds data for a note that needs to be upserted into the database.
struct PendingUpsert {
    id: String,
    name: String,
    abs_path: String,
    created_at: i64,
    updated_at: i64,
    content: String,
    ext: String,
}

#[tauri::command]
pub fn scan_vault(
    vault_path: String,
    ignored_folders: Option<String>,
    app: AppHandle,
    db: State<DbState>,
    embedding_runtime: State<ai::EmbeddingRuntimeState>,
) -> Result<Vec<NoteInfo>, AppError> {
    let vault = Path::new(&vault_path);
    if !vault.is_dir() {
        return Err(AppError::Custom(format!("路径不存在或不是一个有效目录: {}", vault_path)));
    }
    let ignored = parse_ignored_folders(ignored_folders);
    let ai_config = read_ai_config(&app)
        .ok()
        .filter(|config| !config.api_key.trim().is_empty());

    // Phase 1: ONE lock to batch-read all existing timestamps
    let existing_timestamps = {
        let conn = db
            .conn
            .lock()
            .map_err(|_| AppError::Lock)?;
        db::get_all_note_timestamps(&conn)?
    };

    let mut notes: Vec<NoteInfo> = Vec::new();
    let mut pending_upserts: Vec<PendingUpsert> = Vec::new();

    // Phase 2: Walk the directory and collect files that need updating
    for entry in WalkDir::new(vault)
        .follow_links(true)
        .into_iter()
        .filter_entry(|e| {
            if e.depth() == 0 {
                return true;
            }
            let name = match e.file_name().to_str() {
                Some(n) => n,
                None => return false,
            };
            if name.starts_with('.') {
                return false;
            }
            if ignored.contains(name) {
                return false;
            }
            true
        })
    {
        let entry = entry.map_err(|e| AppError::Custom(format!("遍历目录时出错: {}", e)))?;
        if !entry.file_type().is_file() {
            continue;
        }
        let path = entry.path();

        let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("");
        if !is_supported_extension(ext) {
            continue;
        }

        let metadata = fs::metadata(path)?;

        let updated_at = metadata
            .modified()?
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs() as i64;

        let created_at = metadata
            .created()
            .map(|t| t.duration_since(UNIX_EPOCH).unwrap_or_default().as_secs() as i64)
            .unwrap_or(updated_at);

        let relative_path = path.strip_prefix(vault).unwrap_or(path);
        let id = relative_path.to_string_lossy().into_owned();
        let name = path
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("未命名")
            .to_string();
        let abs_path = path.to_string_lossy().into_owned();
        let file_extension = ext.to_lowercase();

        if (is_text_extension(ext)
            && !is_mol_extension(ext)
            && !is_spectroscopy_extension(ext)
            && !is_molecular_extension(ext)
            && !is_paper_extension(ext))
            || is_pdf_extension(ext)
        {
            let needs_update = match existing_timestamps.get(&id) {
                None => true,
                Some(&db_ts) => updated_at > db_ts,
            };

            if needs_update {
                let content = if is_pdf_extension(ext) {
                    match extract_pdf_text(path) {
                        Ok(text) => text,
                        Err(e) => {
                            eprintln!("[PDF提取] {}", e);
                            String::new()
                        }
                    }
                } else {
                    fs::read_to_string(path)?
                };
                if !content.trim().is_empty() {
                    pending_upserts.push(PendingUpsert {
                        id: id.clone(),
                        name: name.clone(),
                        abs_path: abs_path.clone(),
                        created_at,
                        updated_at,
                        content,
                        ext: ext.to_lowercase(),
                    });
                }
            }
        }

        notes.push(NoteInfo {
            id,
            name,
            path: abs_path,
            created_at,
            updated_at,
            file_extension,
        });
    }

    // Phase 3: ONE lock + transaction to batch all upserts
    if !pending_upserts.is_empty() {
        let conn = db
            .conn
            .lock()
            .map_err(|_| AppError::Lock)?;
        conn.execute_batch("BEGIN")?;
        for upsert in &pending_upserts {
            db::upsert_note(
                &conn,
                &upsert.id,
                &upsert.name,
                &upsert.abs_path,
                upsert.created_at,
                upsert.updated_at,
                &upsert.content,
            )?;
        }
        conn.execute_batch("COMMIT")?;
    }

    // Phase 4: Spawn async embedding tasks (same as before)
    for upsert in pending_upserts {
        if is_embeddable_extension(&upsert.ext) {
            if let Some(config) = ai_config.clone() {
                let db_conn = Arc::clone(&db.conn);
                let embedding_runtime = embedding_runtime.inner().clone();
                let note_id = upsert.id;
                let text_for_embedding = upsert.content;

                tauri::async_runtime::spawn(async move {
                    match ai::fetch_embedding_cached(&text_for_embedding, &config, &embedding_runtime).await {
                        Ok(embedding) => {
                            if let Ok(conn) = db_conn.lock() {
                                if let Err(e) = db::update_note_embedding(&conn, &note_id, &embedding) {
                                    eprintln!("[向量化] 写入失败 [{}]: {}", note_id, e);
                                } else {
                                    eprintln!("[向量化] 成功 [{}]: {}维向量", note_id, embedding.len());
                                }
                            }
                        }
                        Err(e) => eprintln!("[向量化] 跳过 [{}]: {}", note_id, e),
                    }
                });
            }
        }
    }

    notes.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
    Ok(notes)
}

#[tauri::command]
pub async fn rebuild_vector_index(
    app: AppHandle,
    db: State<'_, DbState>,
    embedding_runtime: State<'_, ai::EmbeddingRuntimeState>,
) -> Result<u32, AppError> {
    let config = read_ai_config(&app)?;
    if config.api_key.trim().is_empty() {
        return Err(AppError::Custom("未配置 AI API Key，无法重建向量索引".to_string()));
    }

    // Lock optimization: merge get_all_notes + clear_all_embeddings into single lock
    let all_notes = {
        let conn = db
            .conn
            .lock()
            .map_err(|_| AppError::Lock)?;
        let notes = db::get_all_notes_for_embedding(&conn)?;
        db::clear_all_embeddings(&conn)?;
        notes
    };

    // Process embeddings concurrently with buffer_unordered(4)
    let results: Vec<_> = stream::iter(all_notes)
        .filter_map(|(id, absolute_path, content)| {
            let ext = Path::new(&absolute_path)
                .extension()
                .and_then(|s| s.to_str())
                .unwrap_or("")
                .to_ascii_lowercase();
            if !is_embeddable_extension(&ext) || content.trim().is_empty() {
                return std::future::ready(None);
            }
            std::future::ready(Some((id, content)))
        })
        .map(|(id, content)| {
            let config = config.clone();
            let embedding_runtime = embedding_runtime.inner().clone();
            async move {
                match ai::fetch_embedding_cached(&content, &config, &embedding_runtime).await {
                    Ok(embedding) => Some((id, embedding)),
                    Err(e) => {
                        eprintln!("[向量化] 跳过 [{}]: {}", id, e);
                        None
                    }
                }
            }
        })
        .buffer_unordered(4)
        .filter_map(|x| std::future::ready(x))
        .collect()
        .await;

    // Batch write all embeddings in one lock + transaction
    let conn = db.conn.lock().map_err(|_| AppError::Lock)?;
    conn.execute_batch("BEGIN")?;
    for (id, embedding) in &results {
        db::update_note_embedding(&conn, id, embedding)?;
    }
    conn.execute_batch("COMMIT")?;

    Ok(results.len() as u32)
}

#[tauri::command]
pub async fn write_note(
    vault_path: String,
    file_path: String,
    content: String,
    app: AppHandle,
    db: State<'_, DbState>,
    embedding_runtime: State<'_, ai::EmbeddingRuntimeState>,
) -> Result<(), AppError> {
    let path = Path::new(&file_path);
    if let Some(parent) = path.parent() {
        if !parent.is_dir() {
            return Err(AppError::Custom(format!("目标目录不存在: {}", parent.display())));
        }
    }

    fs::write(path, content.as_bytes())?;

    let updated_at = fs::metadata(path)
        .and_then(|m| m.modified())
        .map(|t| t.duration_since(UNIX_EPOCH).unwrap_or_default().as_secs() as i64)
        .unwrap_or_else(|_| SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_secs() as i64);

    let vault = Path::new(&vault_path);
    let id = path.strip_prefix(vault).unwrap_or(path).to_string_lossy().into_owned();
    let file_ext = Path::new(&file_path)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();

    if !is_mol_extension(&file_ext)
        && !is_spectroscopy_extension(&file_ext)
        && !is_molecular_extension(&file_ext)
        && !is_paper_extension(&file_ext)
    {
        let conn = db
            .conn
            .lock()
            .map_err(|_| AppError::Lock)?;
        db::update_note_content(&conn, &id, &content, updated_at)?;
    }

    if is_embeddable_extension(&file_ext) {
        let db_conn = Arc::clone(&db.conn);
        let embedding_runtime = embedding_runtime.inner().clone();
        let note_id = id.clone();
        let text_for_embedding = content.clone();
        let ai_config = read_ai_config(&app).ok();

        tauri::async_runtime::spawn(async move {
            let config = match ai_config {
                Some(c) if !c.api_key.is_empty() => c,
                _ => {
                    eprintln!("[向量化] 跳过 [{}]: 未配置 API Key", note_id);
                    return;
                }
            };

            match ai::fetch_embedding_cached(&text_for_embedding, &config, &embedding_runtime).await {
                Ok(embedding) => match db_conn.lock() {
                    Ok(conn) => {
                        if let Err(e) = db::update_note_embedding(&conn, &note_id, &embedding) {
                            eprintln!("[向量化] 写入数据库失败 [{}]: {}", note_id, e);
                        } else {
                            eprintln!("[向量化] 成功 [{}]: {}维向量已存储", note_id, embedding.len());
                        }
                    }
                    Err(e) => eprintln!("[向量化] 获取数据库锁失败 [{}]: {}", note_id, e),
                },
                Err(e) => eprintln!("[向量化] 跳过 [{}]: {}", note_id, e),
            }
        });
    }

    Ok(())
}
