use tauri::{AppHandle, State};

use crate::ai;
use crate::db::{self, DbState};
use crate::models::NoteInfo;
use crate::shared::command_utils::{read_ai_config, semantic_candidate_limit};
use crate::AppError;

#[tauri::command]
pub async fn test_ai_connection(
    app: AppHandle,
    embedding_runtime: State<'_, ai::EmbeddingRuntimeState>,
) -> Result<String, AppError> {
    let config = read_ai_config(&app)?;
    let embedding = ai::fetch_embedding_cached("测试连接", &config, embedding_runtime.inner()).await?;
    Ok(format!("连接成功，返回 {} 维向量", embedding.len()))
}

#[tauri::command]
pub async fn ponder_node(topic: String, context: String, app: AppHandle) -> Result<String, AppError> {
    let config = read_ai_config(&app)?;
    ai::ponder_node(&topic, &context, &config).await.map_err(Into::into)
}

#[tauri::command]
pub async fn ask_vault(
    question: String,
    active_note_id: Option<String>,
    on_event: tauri::ipc::Channel<String>,
    app: AppHandle,
    db: State<'_, DbState>,
    embedding_runtime: State<'_, ai::EmbeddingRuntimeState>,
) -> Result<(), AppError> {
    let config = read_ai_config(&app)?;
    let query_embedding = ai::fetch_embedding_cached(&question, &config, embedding_runtime.inner()).await?;
    let candidate_limit = semantic_candidate_limit(5);

    let all_embeddings = {
        let conn = db
            .conn
            .lock()
            .map_err(|_| AppError::Lock)?;
        db::get_recent_embeddings(&conn, candidate_limit)?
    };

    let mut scored: Vec<(NoteInfo, f32)> = all_embeddings
        .into_iter()
        .map(|(note, emb)| (note, ai::cosine_similarity(&query_embedding, &emb)))
        .collect();
    scored.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));

    let top_ids: Vec<String> = scored
        .iter()
        .filter(|(n, _)| active_note_id.as_ref().map_or(true, |aid| &n.id != aid))
        .take(5)
        .map(|(n, _)| n.id.clone())
        .collect();

    // Lock optimization: merge active note content + related note content into single lock
    let mut note_contents = Vec::new();
    {
        let conn = db
            .conn
            .lock()
            .map_err(|_| AppError::Lock)?;
        if let Some(ref aid) = active_note_id {
            let active_contents = db::get_notes_content_by_ids(&conn, std::slice::from_ref(aid))?;
            note_contents.extend(active_contents);
        }
        let related_contents = db::get_notes_content_by_ids(&conn, &top_ids)?;
        note_contents.extend(related_contents);
    }

    let context = ai::build_rag_context(&note_contents);
    ai::stream_chat_with_context(&question, &context, &config, |chunk| {
        on_event
            .send(chunk)
            .map_err(|e| format!("发送 IPC 消息失败: {}", e))
    })
    .await?;

    Ok(())
}
