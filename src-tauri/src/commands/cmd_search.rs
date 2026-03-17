use tauri::{AppHandle, State};

use crate::ai;
use crate::db::{self, DbState};
use crate::models::{GraphData, NoteInfo, TagInfo};
use crate::shared::command_utils::{read_ai_config, semantic_candidate_limit};

#[tauri::command]
pub fn search_notes(query: String, db: State<DbState>) -> Result<Vec<NoteInfo>, String> {
    let conn = db
        .conn
        .lock()
        .map_err(|e| format!("获取数据库锁失败: {}", e))?;
    db::search_notes_by_filename(&conn, &query)
}

#[tauri::command]
pub fn get_backlinks(target_name: String, db: State<DbState>) -> Result<Vec<NoteInfo>, String> {
    let conn = db
        .conn
        .lock()
        .map_err(|e| format!("获取数据库锁失败: {}", e))?;
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
    let candidate_limit = semantic_candidate_limit(limit);

    let all_embeddings = {
        let conn = db
            .conn
            .lock()
            .map_err(|e| format!("获取数据库锁失败: {}", e))?;
        db::get_recent_embeddings(&conn, candidate_limit)?
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
) -> Result<Vec<NoteInfo>, String> {
    let context_embedding = {
        let conn = db
            .conn
            .lock()
            .map_err(|e| format!("获取数据库锁失败: {}", e))?;
        db::get_note_embedding(&conn, &current_note_id)?
    };

    let context_embedding = if let Some(embedding) = context_embedding {
        embedding
    } else {
        let config = read_ai_config(&app)?;
        ai::fetch_embedding(&context_text, &config).await?
    };

    let candidate_limit = semantic_candidate_limit(limit);
    let all_embeddings = {
        let conn = db
            .conn
            .lock()
            .map_err(|e| format!("获取数据库锁失败: {}", e))?;
        db::get_recent_embeddings(&conn, candidate_limit)?
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
pub fn get_graph_data(db: State<DbState>) -> Result<GraphData, String> {
    let conn = db
        .conn
        .lock()
        .map_err(|e| format!("获取数据库锁失败: {}", e))?;
    db::get_graph_data(&conn)
}

#[tauri::command]
pub fn get_all_tags(db: State<DbState>) -> Result<Vec<TagInfo>, String> {
    let conn = db
        .conn
        .lock()
        .map_err(|e| format!("获取数据库锁失败: {}", e))?;
    db::get_all_tags(&conn)
}

#[tauri::command]
pub fn get_notes_by_tag(tag: String, db: State<DbState>) -> Result<Vec<NoteInfo>, String> {
    let conn = db
        .conn
        .lock()
        .map_err(|e| format!("获取数据库锁失败: {}", e))?;
    db::get_notes_by_tag(&conn, &tag)
}
