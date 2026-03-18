use tauri::State;
use crate::db::{self, DbState};

#[tauri::command]
pub fn study_session_start(
    note_id: String,
    folder: String,
    db: State<'_, DbState>,
) -> Result<i64, String> {
    let conn = db.conn.lock().map_err(|e| format!("获取数据库锁失败: {}", e))?;
    db::start_session(&conn, &note_id, &folder)
}

#[tauri::command]
pub fn study_session_tick(
    session_id: i64,
    active_secs: i64,
    db: State<'_, DbState>,
) -> Result<(), String> {
    let conn = db.conn.lock().map_err(|e| format!("获取数据库锁失败: {}", e))?;
    db::tick_session(&conn, session_id, active_secs)
}

#[tauri::command]
pub fn study_session_end(
    session_id: i64,
    active_secs: i64,
    db: State<'_, DbState>,
) -> Result<(), String> {
    let conn = db.conn.lock().map_err(|e| format!("获取数据库锁失败: {}", e))?;
    db::end_session(&conn, session_id, active_secs)
}

#[tauri::command]
pub fn study_stats_query(
    days_back: i64,
    db: State<'_, DbState>,
) -> Result<db::StudyStats, String> {
    let conn = db.conn.lock().map_err(|e| format!("获取数据库锁失败: {}", e))?;
    db::query_stats(&conn, days_back)
}
