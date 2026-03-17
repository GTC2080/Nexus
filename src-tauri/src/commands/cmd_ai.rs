use serde_json::Value;
use tauri::{AppHandle, State};

use crate::ai;
use crate::db::{self, DbState};
use crate::models::NoteInfo;
use crate::shared::command_utils::{read_ai_config, semantic_candidate_limit};

#[tauri::command]
pub async fn test_ai_connection(app: AppHandle) -> Result<String, String> {
    let config = read_ai_config(&app)?;
    let embedding = ai::fetch_embedding("测试连接", &config).await?;
    Ok(format!("连接成功，返回 {} 维向量", embedding.len()))
}

#[tauri::command]
pub async fn ponder_node(topic: String, context: String, app: AppHandle) -> Result<String, String> {
    let config = read_ai_config(&app)?;
    ai::ponder_node(&topic, &context, &config).await
}

#[tauri::command]
pub async fn analyze_timeline(timeline_data: String, app: AppHandle) -> Result<String, String> {
    let config = read_ai_config(&app)?;
    let raw = ai::analyze_timeline(&timeline_data, &config).await?;
    let trimmed = raw.trim();

    let candidate = if trimmed.starts_with("```") {
        let lines: Vec<&str> = trimmed.lines().collect();
        if lines.len() >= 3 {
            lines[1..lines.len() - 1].join("\n")
        } else {
            trimmed.to_string()
        }
    } else {
        trimmed.to_string()
    };

    let parsed: Value = serde_json::from_str(candidate.trim())
        .map_err(|e| format!("Timeline 分析返回非 JSON: {}", e))?;
    if !parsed.is_array() {
        return Err("Timeline 分析返回格式错误：必须是 JSON 数组".to_string());
    }
    Ok(parsed.to_string())
}

#[tauri::command]
pub async fn ask_vault(
    question: String,
    active_note_id: Option<String>,
    on_event: tauri::ipc::Channel<String>,
    app: AppHandle,
    db: State<'_, DbState>,
) -> Result<(), String> {
    let config = read_ai_config(&app)?;
    let query_embedding = ai::fetch_embedding(&question, &config).await?;
    let candidate_limit = semantic_candidate_limit(5);

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

    let top_ids: Vec<String> = scored
        .iter()
        .filter(|(n, _)| active_note_id.as_ref().map_or(true, |aid| &n.id != aid))
        .take(5)
        .map(|(n, _)| n.id.clone())
        .collect();

    let mut note_contents = Vec::new();
    if let Some(ref aid) = active_note_id {
        let conn = db
            .conn
            .lock()
            .map_err(|e| format!("获取数据库锁失败: {}", e))?;
        let active_contents = db::get_notes_content_by_ids(&conn, std::slice::from_ref(aid))?;
        note_contents.extend(active_contents);
    }
    {
        let conn = db
            .conn
            .lock()
            .map_err(|e| format!("获取数据库锁失败: {}", e))?;
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
