use std::fs;
use std::path::Path;
use std::collections::HashSet;
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use tauri::{AppHandle, State};
use walkdir::WalkDir;

use crate::ai;
use crate::db::{self, DbState};
use crate::models::NoteInfo;
use crate::shared::command_utils::{
    extract_pdf_text, is_canvas_extension, is_embeddable_extension, is_molecular_extension,
    is_pdf_extension, is_spectroscopy_extension, is_supported_extension, is_text_extension,
    is_timeline_extension, read_ai_config,
};

#[tauri::command]
pub fn init_vault(vault_path: String, db: State<DbState>) -> Result<(), String> {
    let new_conn = db::init_db(&vault_path)?;
    let mut conn = db
        .conn
        .lock()
        .map_err(|e| format!("获取数据库锁失败: {}", e))?;
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

#[tauri::command]
pub fn scan_vault(
    vault_path: String,
    ignored_folders: Option<String>,
    app: AppHandle,
    db: State<DbState>,
) -> Result<Vec<NoteInfo>, String> {
    let vault = Path::new(&vault_path);
    if !vault.is_dir() {
        return Err(format!("路径不存在或不是一个有效目录: {}", vault_path));
    }
    let ignored = parse_ignored_folders(ignored_folders);
    let ai_config = read_ai_config(&app)
        .ok()
        .filter(|config| !config.api_key.trim().is_empty());

    let mut notes: Vec<NoteInfo> = Vec::new();

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
        let entry = entry.map_err(|e| format!("遍历目录时出错: {}", e))?;
        if !entry.file_type().is_file() {
            continue;
        }
        let path = entry.path();

        let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("");
        if !is_supported_extension(ext) {
            continue;
        }

        let metadata = fs::metadata(path)
            .map_err(|e| format!("读取文件元数据失败 [{}]: {}", path.display(), e))?;

        let updated_at = metadata
            .modified()
            .map_err(|e| format!("获取修改时间失败: {}", e))?
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

        if (is_text_extension(ext) && !is_canvas_extension(ext) && !is_spectroscopy_extension(ext) && !is_molecular_extension(ext))
            || is_pdf_extension(ext)
        {
            let db_updated_at = {
                let conn = db
                    .conn
                    .lock()
                    .map_err(|e| format!("获取数据库锁失败: {}", e))?;
                db::get_note_updated_at(&conn, &id)?
            };
            let needs_update = match db_updated_at {
                None => true,
                Some(db_ts) => updated_at > db_ts,
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
                    fs::read_to_string(path)
                        .map_err(|e| format!("读取文件内容失败 [{}]: {}", path.display(), e))?
                };
                if !content.trim().is_empty() {
                    {
                        let conn = db
                            .conn
                            .lock()
                            .map_err(|e| format!("获取数据库锁失败: {}", e))?;
                        db::upsert_note(&conn, &id, &name, &abs_path, created_at, updated_at, &content)?;
                    }

                    if is_embeddable_extension(ext) {
                        if let Some(config) = ai_config.clone() {
                            let db_conn = Arc::clone(&db.conn);
                            let note_id = id.clone();
                            let text_for_embedding = content;

                            tauri::async_runtime::spawn(async move {
                                match ai::fetch_embedding(&text_for_embedding, &config).await {
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

    notes.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
    Ok(notes)
}

#[tauri::command]
pub async fn rebuild_vector_index(app: AppHandle, db: State<'_, DbState>) -> Result<u32, String> {
    let config = read_ai_config(&app)?;
    if config.api_key.trim().is_empty() {
        return Err("未配置 AI API Key，无法重建向量索引".to_string());
    }

    let all_notes = {
        let conn = db
            .conn
            .lock()
            .map_err(|e| format!("获取数据库锁失败: {}", e))?;
        db::get_all_notes_for_embedding(&conn)?
    };

    {
        let conn = db
            .conn
            .lock()
            .map_err(|e| format!("获取数据库锁失败: {}", e))?;
        db::clear_all_embeddings(&conn)?;
    }

    let mut rebuilt: u32 = 0;
    for (id, absolute_path, content) in all_notes {
        let ext = Path::new(&absolute_path)
            .extension()
            .and_then(|s| s.to_str())
            .unwrap_or("")
            .to_ascii_lowercase();
        if !is_embeddable_extension(&ext) {
            continue;
        }
        if content.trim().is_empty() {
            continue;
        }

        let embedding = ai::fetch_embedding(&content, &config).await?;
        let conn = db
            .conn
            .lock()
            .map_err(|e| format!("获取数据库锁失败: {}", e))?;
        db::update_note_embedding(&conn, &id, &embedding)?;
        rebuilt += 1;
    }

    Ok(rebuilt)
}

#[tauri::command]
pub async fn write_note(
    vault_path: String,
    file_path: String,
    content: String,
    app: AppHandle,
    db: State<'_, DbState>,
) -> Result<(), String> {
    let path = Path::new(&file_path);
    if let Some(parent) = path.parent() {
        if !parent.is_dir() {
            return Err(format!("目标目录不存在: {}", parent.display()));
        }
    }

    fs::write(path, content.as_bytes()).map_err(|e| format!("写入文件失败 [{}]: {}", file_path, e))?;

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

    if !is_canvas_extension(&file_ext) && !is_timeline_extension(&file_ext) && !is_spectroscopy_extension(&file_ext) && !is_molecular_extension(&file_ext) {
        let conn = db
            .conn
            .lock()
            .map_err(|e| format!("获取数据库锁失败: {}", e))?;
        db::update_note_content(&conn, &id, &content, updated_at)?;
    }

    if is_embeddable_extension(&file_ext) {
        let db_conn = Arc::clone(&db.conn);
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

            match ai::fetch_embedding(&text_for_embedding, &config).await {
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

#[tauri::command]
pub fn delete_entry(vault_path: String, target_path: String, db: State<'_, DbState>) -> Result<(), String> {
    let vault = Path::new(&vault_path);
    let target = Path::new(&target_path);

    if !target.exists() {
        return Err(format!("目标不存在: {}", target_path));
    }

    let vault_canonical = fs::canonicalize(vault)
        .map_err(|e| format!("无法解析知识库路径 [{}]: {}", vault_path, e))?;
    let target_canonical = fs::canonicalize(target)
        .map_err(|e| format!("无法解析目标路径 [{}]: {}", target_path, e))?;

    if target_canonical == vault_canonical {
        return Err("禁止删除知识库根目录".to_string());
    }
    if !target_canonical.starts_with(&vault_canonical) {
        return Err("禁止删除知识库目录之外的路径".to_string());
    }

    let id = target_canonical
        .strip_prefix(&vault_canonical)
        .unwrap_or(&target_canonical)
        .to_string_lossy()
        .into_owned();

    let is_file = target_canonical.is_file();
    if is_file {
        fs::remove_file(&target_canonical).map_err(|e| format!("删除文件失败 [{}]: {}", target_path, e))?;
    } else if target_canonical.is_dir() {
        fs::remove_dir_all(&target_canonical).map_err(|e| format!("删除目录失败 [{}]: {}", target_path, e))?;
    } else {
        return Err("目标既不是文件也不是目录".to_string());
    }

    let conn = db
        .conn
        .lock()
        .map_err(|e| format!("获取数据库锁失败: {}", e))?;
    if is_file {
        db::delete_note_by_id(&conn, &id)?;
    } else {
        db::delete_notes_by_prefix(&conn, &id)?;
    }

    Ok(())
}

#[tauri::command]
pub fn move_entry(
    vault_path: String,
    source_path: String,
    dest_folder: String,
    db: State<'_, DbState>,
) -> Result<(), String> {
    let vault = Path::new(&vault_path);
    let source = Path::new(&source_path);
    let dest_dir = Path::new(&dest_folder);

    if !source.exists() {
        return Err(format!("源路径不存在: {}", source_path));
    }
    if !dest_dir.is_dir() {
        return Err(format!("目标文件夹不存在: {}", dest_folder));
    }

    let vault_canonical = fs::canonicalize(vault).map_err(|e| format!("无法解析知识库路径: {}", e))?;
    let source_canonical = fs::canonicalize(source).map_err(|e| format!("无法解析源路径: {}", e))?;
    let dest_canonical = fs::canonicalize(dest_dir).map_err(|e| format!("无法解析目标路径: {}", e))?;

    if !source_canonical.starts_with(&vault_canonical) {
        return Err("禁止移动知识库外的文件".to_string());
    }
    if !dest_canonical.starts_with(&vault_canonical) {
        return Err("禁止移动到知识库外".to_string());
    }

    let file_name = source_canonical.file_name().ok_or("无法获取文件名")?;
    let new_path = dest_canonical.join(file_name);
    if new_path.exists() {
        return Err(format!("目标已存在同名文件/文件夹: {}", new_path.display()));
    }
    if source_canonical.is_dir() && dest_canonical.starts_with(&source_canonical) {
        return Err("不能将文件夹移动到自身的子目录".to_string());
    }

    let old_relative = source_canonical
        .strip_prefix(&vault_canonical)
        .unwrap_or(&source_canonical)
        .to_string_lossy()
        .replace('\\', "/");
    let new_relative = new_path
        .strip_prefix(&vault_canonical)
        .unwrap_or(&new_path)
        .to_string_lossy()
        .replace('\\', "/");

    fs::rename(&source_canonical, &new_path).map_err(|e| format!("移动失败: {}", e))?;

    let conn = db
        .conn
        .lock()
        .map_err(|e| format!("获取数据库锁失败: {}", e))?;
    if source_canonical.is_dir() || new_path.is_dir() {
        db::rename_notes_by_prefix(&conn, &old_relative, &new_relative, &vault_path)?;
    } else {
        let new_abs = new_path.to_string_lossy().replace('\\', "/");
        db::rename_note_id(&conn, &old_relative, &new_relative, &new_abs)?;
    }

    Ok(())
}

#[tauri::command]
pub fn create_folder(vault_path: String, folder_path: String) -> Result<(), String> {
    let vault = Path::new(&vault_path);
    let target = Path::new(&folder_path);

    let vault_canonical = fs::canonicalize(vault).map_err(|e| format!("无法解析知识库路径: {}", e))?;

    let parent = target.parent().ok_or("无法获取目标父目录")?;
    if !parent.exists() {
        return Err(format!("父目录不存在: {}", parent.display()));
    }

    let parent_canonical = fs::canonicalize(parent).map_err(|e| format!("无法解析父目录: {}", e))?;
    if !parent_canonical.starts_with(&vault_canonical) {
        return Err("禁止在知识库外创建文件夹".to_string());
    }

    if target.exists() {
        return Err(format!("目标已存在: {}", target.display()));
    }

    fs::create_dir(target).map_err(|e| format!("创建文件夹失败 [{}]: {}", folder_path, e))?;
    Ok(())
}

#[tauri::command]
pub fn rename_entry(
    vault_path: String,
    source_path: String,
    new_name: String,
    db: State<'_, DbState>,
) -> Result<(), String> {
    let trimmed = new_name.trim();
    if trimmed.is_empty() {
        return Err("新名称不能为空".to_string());
    }
    if trimmed == "." || trimmed == ".." || trimmed.contains('/') || trimmed.contains('\\') {
        return Err("新名称不合法".to_string());
    }

    let vault = Path::new(&vault_path);
    let source = Path::new(&source_path);
    if !source.exists() {
        return Err(format!("源路径不存在: {}", source_path));
    }

    let vault_canonical = fs::canonicalize(vault).map_err(|e| format!("无法解析知识库路径: {}", e))?;
    let source_canonical = fs::canonicalize(source).map_err(|e| format!("无法解析源路径: {}", e))?;

    if source_canonical == vault_canonical {
        return Err("禁止重命名知识库根目录".to_string());
    }
    if !source_canonical.starts_with(&vault_canonical) {
        return Err("禁止重命名知识库外的路径".to_string());
    }

    let parent = source_canonical.parent().ok_or("无法获取父目录")?;
    let target_path = parent.join(trimmed);
    if target_path == source_canonical {
        return Ok(());
    }
    if target_path.exists() {
        return Err(format!("目标已存在同名文件/文件夹: {}", target_path.display()));
    }

    let source_is_dir = source_canonical.is_dir();
    let old_relative = source_canonical
        .strip_prefix(&vault_canonical)
        .unwrap_or(&source_canonical)
        .to_string_lossy()
        .replace('\\', "/");
    let new_relative = target_path
        .strip_prefix(&vault_canonical)
        .unwrap_or(&target_path)
        .to_string_lossy()
        .replace('\\', "/");

    fs::rename(&source_canonical, &target_path).map_err(|e| format!("重命名失败: {}", e))?;

    let conn = db
        .conn
        .lock()
        .map_err(|e| format!("获取数据库锁失败: {}", e))?;
    if source_is_dir {
        db::rename_notes_by_prefix(&conn, &old_relative, &new_relative, &vault_path)?;
    } else {
        let new_abs = target_path.to_string_lossy().replace('\\', "/");
        db::rename_note_id(&conn, &old_relative, &new_relative, &new_abs)?;
    }

    Ok(())
}
