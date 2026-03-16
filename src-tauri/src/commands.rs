use std::fs;
use std::path::Path;
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};
use walkdir::WalkDir;

use tauri::{AppHandle, State};
use tauri_plugin_store::StoreExt;

use crate::ai::{self, AiConfig};
use crate::db::{self, DbState};
use crate::models::{GraphData, NoteInfo, TagInfo};

/// 从 tauri-plugin-store 中读取 AI 配置。
/// 前端通过 LazyStore 写入 settings.json，Rust 端通过此函数读取。
fn read_ai_config(app: &AppHandle) -> Result<AiConfig, String> {
    let store = app
        .store("settings.json")
        .map_err(|e| format!("打开 Store 失败: {}", e))?;

    let api_key = store
        .get("aiApiKey")
        .and_then(|v| v.as_str().map(|s| s.to_string()))
        .unwrap_or_default();

    let base_url = store
        .get("aiBaseUrl")
        .and_then(|v| v.as_str().map(|s| s.to_string()))
        .unwrap_or_else(|| "https://api.openai.com/v1".to_string());

    let embedding_base_url = store
        .get("embeddingBaseUrl")
        .and_then(|v| v.as_str().map(|s| s.to_string()))
        .unwrap_or_default();

    let embedding_api_key = store
        .get("embeddingApiKey")
        .and_then(|v| v.as_str().map(|s| s.to_string()))
        .unwrap_or_default();

    let embedding_model = store
        .get("embeddingModel")
        .and_then(|v| v.as_str().map(|s| s.to_string()))
        .unwrap_or_else(|| "text-embedding-3-small".to_string());

    let chat_model = store
        .get("chatModel")
        .and_then(|v| v.as_str().map(|s| s.to_string()))
        .unwrap_or_else(|| "gpt-4o-mini".to_string());

    Ok(AiConfig {
        api_key,
        base_url,
        embedding_api_key,
        embedding_base_url,
        embedding_model,
        chat_model,
    })
}

/// 测试 AI 连接：用一段短文本调用 Embedding API 验证配置是否正确。
#[tauri::command]
pub async fn test_ai_connection(app: AppHandle) -> Result<String, String> {
    let config = read_ai_config(&app)?;
    let embedding = ai::fetch_embedding("测试连接", &config).await?;
    Ok(format!("连接成功，返回 {} 维向量", embedding.len()))
}

#[tauri::command]
pub fn init_vault(vault_path: String, db: State<DbState>) -> Result<(), String> {
    let new_conn = db::init_db(&vault_path)?;
    let mut conn = db.conn.lock().map_err(|e| format!("获取数据库锁失败: {}", e))?;
    *conn = new_conn;
    Ok(())
}

/// 支持的文件扩展名白名单
const SUPPORTED_EXTENSIONS: &[&str] = &[
    "md", "txt", "json", "py", "rs", "js", "ts", "jsx", "tsx", "css", "html",
    "toml", "yaml", "yml", "xml", "sh", "bat", "c", "cpp", "h", "java", "go",
    "png", "jpg", "jpeg", "gif", "svg", "webp", "bmp", "ico",
];

/// 可以读取文本内容的扩展名（非二进制）
const TEXT_EXTENSIONS: &[&str] = &[
    "md", "txt", "json", "py", "rs", "js", "ts", "jsx", "tsx", "css", "html",
    "toml", "yaml", "yml", "xml", "sh", "bat", "c", "cpp", "h", "java", "go",
];

/// 允许进行 AI 向量化的扩展名
const EMBEDDABLE_EXTENSIONS: &[&str] = &["md", "txt"];

fn is_supported_extension(ext: &str) -> bool {
    SUPPORTED_EXTENSIONS.iter().any(|e| e.eq_ignore_ascii_case(ext))
}

fn is_text_extension(ext: &str) -> bool {
    TEXT_EXTENSIONS.iter().any(|e| e.eq_ignore_ascii_case(ext))
}

fn is_embeddable_extension(ext: &str) -> bool {
    EMBEDDABLE_EXTENSIONS.iter().any(|e| e.eq_ignore_ascii_case(ext))
}

#[tauri::command]
pub fn scan_vault(vault_path: String, db: State<DbState>) -> Result<Vec<NoteInfo>, String> {
    let vault = Path::new(&vault_path);
    if !vault.is_dir() {
        return Err(format!("路径不存在或不是一个有效目录: {}", vault_path));
    }

    let conn = db.conn.lock().map_err(|e| format!("获取数据库锁失败: {}", e))?;
    let mut notes: Vec<NoteInfo> = Vec::new();

    for entry in WalkDir::new(vault)
        .follow_links(true)
        .into_iter()
        .filter_entry(|e| {
            e.file_name()
                .to_str()
                .map(|name| !name.starts_with('.') || e.depth() == 0)
                .unwrap_or(false)
        })
    {
        let entry = entry.map_err(|e| format!("遍历目录时出错: {}", e))?;
        if !entry.file_type().is_file() { continue; }
        let path = entry.path();

        let ext = path.extension()
            .and_then(|e| e.to_str())
            .unwrap_or("");
        if !is_supported_extension(ext) { continue; }

        let metadata = fs::metadata(path)
            .map_err(|e| format!("读取文件元数据失败 [{}]: {}", path.display(), e))?;

        let updated_at = metadata.modified()
            .map_err(|e| format!("获取修改时间失败: {}", e))?
            .duration_since(UNIX_EPOCH).unwrap_or_default().as_secs() as i64;

        let created_at = metadata.created()
            .map(|t| t.duration_since(UNIX_EPOCH).unwrap_or_default().as_secs() as i64)
            .unwrap_or(updated_at);

        let relative_path = path.strip_prefix(vault).unwrap_or(path);
        let id = relative_path.to_string_lossy().into_owned();
        let name = path.file_stem().and_then(|s| s.to_str()).unwrap_or("未命名").to_string();
        let abs_path = path.to_string_lossy().into_owned();
        let file_extension = ext.to_lowercase();

        // 只对文本文件读取内容并写入数据库
        if is_text_extension(ext) {
            let db_updated_at = db::get_note_updated_at(&conn, &id)?;
            let needs_update = match db_updated_at {
                None => true,
                Some(db_ts) => updated_at > db_ts,
            };

            if needs_update {
                let content = fs::read_to_string(path)
                    .map_err(|e| format!("读取文件内容失败 [{}]: {}", path.display(), e))?;
                db::upsert_note(&conn, &id, &name, &abs_path, created_at, updated_at, &content)?;
            }
        }

        notes.push(NoteInfo { id, name, path: abs_path, created_at, updated_at, file_extension });
    }

    notes.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
    Ok(notes)
}

#[tauri::command]
pub fn read_note(file_path: String) -> Result<String, String> {
    let path = Path::new(&file_path);
    if !path.exists() { return Err(format!("文件不存在: {}", file_path)); }
    if !path.is_file() { return Err(format!("指定路径不是一个文件: {}", file_path)); }
    fs::read_to_string(path).map_err(|e| format!("读取文件失败 [{}]: {}", file_path, e))
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

    fs::write(path, content.as_bytes())
        .map_err(|e| format!("写入文件失败 [{}]: {}", file_path, e))?;

    let updated_at = fs::metadata(path)
        .and_then(|m| m.modified())
        .map(|t| t.duration_since(UNIX_EPOCH).unwrap_or_default().as_secs() as i64)
        .unwrap_or_else(|_| {
            SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_secs() as i64
        });

    let vault = Path::new(&vault_path);
    let id = path.strip_prefix(vault).unwrap_or(path).to_string_lossy().into_owned();

    {
        let conn = db.conn.lock().map_err(|e| format!("获取数据库锁失败: {}", e))?;
        db::update_note_content(&conn, &id, &content, updated_at)?;
    }

    // 异步向量化：仅对可向量化的文本文件执行
    let file_ext = Path::new(&file_path)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();

    if is_embeddable_extension(&file_ext) {
        let db_conn = Arc::clone(&db.conn);
        let note_id = id.clone();
        let text_for_embedding = content.clone();
        let ai_config = read_ai_config(&app).ok();

        tauri::async_runtime::spawn(async move {
            let config = match ai_config {
                Some(c) if !c.api_key.is_empty() => c,
                _ => { eprintln!("[向量化] 跳过 [{}]: 未配置 API Key", note_id); return; }
            };

            match ai::fetch_embedding(&text_for_embedding, &config).await {
                Ok(embedding) => {
                    match db_conn.lock() {
                        Ok(conn) => {
                            if let Err(e) = db::update_note_embedding(&conn, &note_id, &embedding) {
                                eprintln!("[向量化] 写入数据库失败 [{}]: {}", note_id, e);
                            } else {
                                eprintln!("[向量化] 成功 [{}]: {}维向量已存储", note_id, embedding.len());
                            }
                        }
                        Err(e) => eprintln!("[向量化] 获取数据库锁失败 [{}]: {}", note_id, e),
                    }
                }
                Err(e) => eprintln!("[向量化] 跳过 [{}]: {}", note_id, e),
            }
        });
    }

    Ok(())
}

#[tauri::command]
pub fn search_notes(query: String, db: State<DbState>) -> Result<Vec<NoteInfo>, String> {
    let conn = db.conn.lock().map_err(|e| format!("获取数据库锁失败: {}", e))?;
    db::search_notes_by_filename(&conn, &query)
}

#[tauri::command]
pub fn get_backlinks(target_name: String, db: State<DbState>) -> Result<Vec<NoteInfo>, String> {
    let conn = db.conn.lock().map_err(|e| format!("获取数据库锁失败: {}", e))?;
    db::get_backlinks(&conn, &target_name)
}

#[tauri::command]
pub async fn semantic_search(
    query: String,
    limit: usize,
    app: AppHandle,
    db: State<'_, DbState>,
) -> Result<Vec<NoteInfo>, String> {
    let config = read_ai_config(&app)?;
    let query_embedding = ai::fetch_embedding(&query, &config).await?;

    let all_embeddings = {
        let conn = db.conn.lock().map_err(|e| format!("获取数据库锁失败: {}", e))?;
        db::get_all_embeddings(&conn)?
    };

    let mut scored: Vec<(NoteInfo, f32)> = all_embeddings
        .into_iter()
        .map(|(note, emb)| {
            let score = ai::cosine_similarity(&query_embedding, &emb);
            (note, score)
        })
        .collect();

    scored.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));

    Ok(scored.into_iter().take(limit).map(|(note, _)| note).collect())
}

#[tauri::command]
pub async fn get_related_notes(
    context_text: String,
    current_note_id: String,
    limit: usize,
    app: AppHandle,
    db: State<'_, DbState>,
) -> Result<Vec<NoteInfo>, String> {
    let config = read_ai_config(&app)?;
    let context_embedding = ai::fetch_embedding(&context_text, &config).await?;

    let all_embeddings = {
        let conn = db.conn.lock().map_err(|e| format!("获取数据库锁失败: {}", e))?;
        db::get_all_embeddings(&conn)?
    };

    let mut scored: Vec<(NoteInfo, f32)> = all_embeddings
        .into_iter()
        .filter(|(note, _)| note.id != current_note_id)
        .map(|(note, emb)| {
            let score = ai::cosine_similarity(&context_embedding, &emb);
            (note, score)
        })
        .collect();

    scored.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));

    Ok(scored.into_iter().take(limit).map(|(note, _)| note).collect())
}

#[tauri::command]
pub fn get_graph_data(db: State<DbState>) -> Result<GraphData, String> {
    let conn = db.conn.lock().map_err(|e| format!("获取数据库锁失败: {}", e))?;
    db::get_graph_data(&conn)
}

#[tauri::command]
pub fn get_all_tags(db: State<DbState>) -> Result<Vec<TagInfo>, String> {
    let conn = db.conn.lock().map_err(|e| format!("获取数据库锁失败: {}", e))?;
    db::get_all_tags(&conn)
}

#[tauri::command]
pub fn get_notes_by_tag(tag: String, db: State<DbState>) -> Result<Vec<NoteInfo>, String> {
    let conn = db.conn.lock().map_err(|e| format!("获取数据库锁失败: {}", e))?;
    db::get_notes_by_tag(&conn, &tag)
}

#[tauri::command]
pub async fn ask_vault(
    question: String,
    on_event: tauri::ipc::Channel<String>,
    app: AppHandle,
    db: State<'_, DbState>,
) -> Result<(), String> {
    let config = read_ai_config(&app)?;

    let query_embedding = ai::fetch_embedding(&question, &config).await?;

    let all_embeddings = {
        let conn = db.conn.lock().map_err(|e| format!("获取数据库锁失败: {}", e))?;
        db::get_all_embeddings(&conn)?
    };

    let mut scored: Vec<(NoteInfo, f32)> = all_embeddings
        .into_iter()
        .map(|(note, emb)| {
            let score = ai::cosine_similarity(&query_embedding, &emb);
            (note, score)
        })
        .collect();

    scored.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));

    let top_ids: Vec<String> = scored.iter().take(5).map(|(n, _)| n.id.clone()).collect();

    let note_contents = {
        let conn = db.conn.lock().map_err(|e| format!("获取数据库锁失败: {}", e))?;
        db::get_notes_content_by_ids(&conn, &top_ids)?
    };

    let context = ai::build_rag_context(&note_contents);

    ai::stream_chat_with_context(&question, &context, &config, |chunk| {
        on_event.send(chunk).map_err(|e| format!("发送 IPC 消息失败: {}", e))
    })
    .await?;

    Ok(())
}
