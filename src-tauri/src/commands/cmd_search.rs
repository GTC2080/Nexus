use tauri::{AppHandle, State};

use crate::ai;
use crate::db::{self, DbState};
use crate::models::{EnrichedGraphData, GraphData, NoteInfo, TagInfo, TagTreeNode};
use crate::shared::command_utils::read_ai_config;
use crate::AppError;

#[tauri::command]
pub fn search_notes(query: String, db: State<DbState>) -> Result<Vec<NoteInfo>, AppError> {
    let conn = db
        .conn
        .lock()
        .map_err(|_| AppError::Lock)?;
    db::search_notes_by_filename(&conn, &query).map_err(Into::into)
}

#[tauri::command]
pub fn get_backlinks(target_name: String, db: State<DbState>) -> Result<Vec<NoteInfo>, AppError> {
    let conn = db
        .conn
        .lock()
        .map_err(|_| AppError::Lock)?;
    db::get_backlinks(&conn, &target_name).map_err(Into::into)
}

#[tauri::command]
pub async fn semantic_search(
    query: String,
    limit: usize,
    app: AppHandle,
    db: State<'_, DbState>,
    embedding_runtime: State<'_, ai::EmbeddingRuntimeState>,
) -> Result<Vec<NoteInfo>, AppError> {
    let config = read_ai_config(&app)?;
    let query_embedding = ai::fetch_embedding_cached(&query, &config, embedding_runtime.inner()).await?;

    let all_embeddings = {
        let conn = db
            .conn
            .lock()
            .map_err(|_| AppError::Lock)?;
        db::get_all_embeddings(&conn)?
    };

    let mut scored: Vec<(NoteInfo, f32)> = all_embeddings
        .into_iter()
        .map(|(note, emb)| (note, ai::cosine_similarity(&query_embedding, &emb)))
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
    embedding_runtime: State<'_, ai::EmbeddingRuntimeState>,
) -> Result<Vec<NoteInfo>, AppError> {
    let config = read_ai_config(&app)?;
    let context_embedding = ai::fetch_embedding_cached(&context_text, &config, embedding_runtime.inner()).await?;

    let all_embeddings = {
        let conn = db
            .conn
            .lock()
            .map_err(|_| AppError::Lock)?;
        db::get_all_embeddings(&conn)?
    };

    let mut scored: Vec<(NoteInfo, f32)> = all_embeddings
        .into_iter()
        .filter(|(note, _)| note.id != current_note_id)
        .map(|(note, emb)| (note, ai::cosine_similarity(&context_embedding, &emb)))
        .collect();

    scored.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
    Ok(scored.into_iter().take(limit).map(|(note, _)| note).collect())
}

#[tauri::command]
pub fn get_graph_data(db: State<DbState>) -> Result<GraphData, AppError> {
    let conn = db
        .conn
        .lock()
        .map_err(|_| AppError::Lock)?;
    db::get_graph_data(&conn).map_err(Into::into)
}

#[tauri::command]
pub fn get_all_tags(db: State<DbState>) -> Result<Vec<TagInfo>, AppError> {
    let conn = db
        .conn
        .lock()
        .map_err(|_| AppError::Lock)?;
    db::get_all_tags(&conn).map_err(Into::into)
}

#[tauri::command]
pub fn get_notes_by_tag(tag: String, db: State<DbState>) -> Result<Vec<NoteInfo>, AppError> {
    let conn = db
        .conn
        .lock()
        .map_err(|_| AppError::Lock)?;
    db::get_notes_by_tag(&conn, &tag).map_err(Into::into)
}

// ──────────────────────────────────────────
// 性能优化：从前端迁移到 Rust 的命令
// ──────────────────────────────────────────

/// 接收原始笔记内容，在 Rust 端做语义上下文提取 + embedding 搜索
#[tauri::command]
pub async fn get_related_notes_raw(
    raw_content: String,
    current_note_id: String,
    limit: usize,
    app: AppHandle,
    db: State<'_, DbState>,
    embedding_runtime: State<'_, ai::EmbeddingRuntimeState>,
) -> Result<Vec<NoteInfo>, AppError> {
    let context_text =
        crate::commands::cmd_compute::build_semantic_context(raw_content);
    if context_text.len() < 24 {
        return Ok(Vec::new());
    }

    let config = read_ai_config(&app)?;
    let context_embedding =
        ai::fetch_embedding_cached(&context_text, &config, embedding_runtime.inner()).await?;

    let all_embeddings = {
        let conn = db.conn.lock().map_err(|_| AppError::Lock)?;
        db::get_all_embeddings(&conn)?
    };

    let mut scored: Vec<(NoteInfo, f32)> = all_embeddings
        .into_iter()
        .filter(|(note, _)| note.id != current_note_id)
        .map(|(note, emb)| (note, ai::cosine_similarity(&context_embedding, &emb)))
        .collect();

    scored.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
    Ok(scored
        .into_iter()
        .take(limit)
        .map(|(note, _)| note)
        .collect())
}

/// 返回预构建的标签树结构（替代前端 buildTagTree）
#[tauri::command]
pub fn get_tag_tree(db: State<DbState>) -> Result<Vec<TagTreeNode>, AppError> {
    let conn = db.conn.lock().map_err(|_| AppError::Lock)?;
    db::get_tag_tree(&conn).map_err(Into::into)
}

/// 返回增强版图谱数据，包含预计算的邻接索引（替代前端 useMemo 构建）
#[tauri::command]
pub fn get_enriched_graph_data(db: State<DbState>) -> Result<EnrichedGraphData, AppError> {
    let conn = db.conn.lock().map_err(|_| AppError::Lock)?;
    db::get_enriched_graph_data(&conn).map_err(Into::into)
}
