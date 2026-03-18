use rusqlite::{params, Connection};
use serde::Serialize;

// ──────────────────────────────────────────
// 数据结构
// ──────────────────────────────────────────

#[derive(Debug, Serialize)]
pub struct DailySummary {
    pub date: String,
    pub active_secs: i64,
    pub file_count: i64,
}

#[derive(Debug, Serialize)]
pub struct DailyFileDetail {
    pub note_id: String,
    pub active_secs: i64,
}

#[derive(Debug, Serialize)]
pub struct DailyDetailGroup {
    pub date: String,
    pub files: Vec<DailyFileDetail>,
}

#[derive(Debug, Serialize)]
pub struct FolderRank {
    pub folder: String,
    pub total_secs: i64,
}

#[derive(Debug, Serialize)]
pub struct HeatmapDay {
    pub date: String,
    pub active_secs: i64,
}

#[derive(Debug, Serialize)]
pub struct StudyStats {
    pub today_active_secs: i64,
    pub today_files: i64,
    pub week_active_secs: i64,
    pub streak_days: i64,
    pub daily_summary: Vec<DailySummary>,
    pub daily_details: Vec<DailyDetailGroup>,
    pub folder_ranking: Vec<FolderRank>,
    pub heatmap: Vec<HeatmapDay>,
}

// ──────────────────────────────────────────
// CRUD
// ──────────────────────────────────────────

/// 开始一次学习会话，返回新插入的 session id
pub fn start_session(conn: &Connection, note_id: &str, folder: &str) -> Result<i64, String> {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| format!("获取时间失败: {}", e))?
        .as_secs() as i64;

    conn.execute(
        "INSERT INTO study_sessions (note_id, folder, started_at, active_secs)
         VALUES (?1, ?2, ?3, 0)",
        params![note_id, folder, now],
    )
    .map_err(|e| format!("插入 study_sessions 失败: {}", e))?;

    Ok(conn.last_insert_rowid())
}

/// 心跳更新：将 active_secs 增加 delta_secs
pub fn tick_session(conn: &Connection, session_id: i64, delta_secs: i64) -> Result<(), String> {
    conn.execute(
        "UPDATE study_sessions SET active_secs = active_secs + ?1 WHERE id = ?2",
        params![delta_secs, session_id],
    )
    .map_err(|e| format!("更新 study_sessions (tick) 失败: {}", e))?;
    Ok(())
}

/// 结束会话：最终一次增量写入（与 tick_session 逻辑相同）
pub fn end_session(conn: &Connection, session_id: i64, delta_secs: i64) -> Result<(), String> {
    conn.execute(
        "UPDATE study_sessions SET active_secs = active_secs + ?1 WHERE id = ?2",
        params![delta_secs, session_id],
    )
    .map_err(|e| format!("更新 study_sessions (end) 失败: {}", e))?;
    Ok(())
}

// ──────────────────────────────────────────
// 统计查询
// ──────────────────────────────────────────

/// 聚合统计，days_back 控制 daily_summary / daily_details 回溯天数
pub fn query_stats(conn: &Connection, days_back: i64) -> Result<StudyStats, String> {
    let now_secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| format!("获取时间失败: {}", e))?
        .as_secs() as i64;

    // 今天 00:00:00 UTC 的 unix 时间戳
    let today_start = (now_secs / 86400) * 86400;
    let week_start = today_start - 6 * 86400;
    let window_start = today_start - (days_back - 1) * 86400;
    let heatmap_start = today_start - 179 * 86400;

    // ── 今日统计 ──
    let (today_active_secs, today_files): (i64, i64) = conn
        .query_row(
            "SELECT COALESCE(SUM(active_secs), 0), COUNT(DISTINCT note_id)
             FROM study_sessions
             WHERE started_at >= ?1",
            params![today_start],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .map_err(|e| format!("查询今日统计失败: {}", e))?;

    // ── 本周统计 ──
    let week_active_secs: i64 = conn
        .query_row(
            "SELECT COALESCE(SUM(active_secs), 0)
             FROM study_sessions
             WHERE started_at >= ?1",
            params![week_start],
            |row| row.get(0),
        )
        .map_err(|e| format!("查询本周统计失败: {}", e))?;

    // ── 连续打卡天数（streak）──
    // 查询有学习记录的日期（按天去重，降序），从今天起连续计数
    let streak_days = {
        let mut stmt = conn
            .prepare(
                "SELECT DISTINCT (started_at / 86400) AS day_bucket
                 FROM study_sessions
                 WHERE active_secs > 0
                 ORDER BY day_bucket DESC",
            )
            .map_err(|e| format!("准备 streak 查询失败: {}", e))?;

        let today_bucket = today_start / 86400;
        let mut streak: i64 = 0;
        let mut expected = today_bucket;

        let buckets: Vec<i64> = stmt
            .query_map([], |row| row.get(0))
            .map_err(|e| format!("执行 streak 查询失败: {}", e))?
            .filter_map(|r| r.ok())
            .collect();

        for bucket in buckets {
            if bucket == expected {
                streak += 1;
                expected -= 1;
            } else if bucket < expected {
                break;
            }
        }
        streak
    };

    // ── 每日汇总（days_back 天内）──
    let daily_summary = {
        let mut stmt = conn
            .prepare(
                "SELECT date(started_at, 'unixepoch') AS d,
                        COALESCE(SUM(active_secs), 0),
                        COUNT(DISTINCT note_id)
                 FROM study_sessions
                 WHERE started_at >= ?1
                 GROUP BY d
                 ORDER BY d DESC",
            )
            .map_err(|e| format!("准备 daily_summary 查询失败: {}", e))?;

        let result = stmt
            .query_map(params![window_start], |row| {
                Ok(DailySummary {
                    date: row.get(0)?,
                    active_secs: row.get(1)?,
                    file_count: row.get(2)?,
                })
            })
            .map_err(|e| format!("执行 daily_summary 查询失败: {}", e))?
            .filter_map(|r| r.ok())
            .collect::<Vec<_>>();
        result
    };

    // ── 每日详细分组（按日期 -> 文件）──
    let daily_details = {
        let mut stmt = conn
            .prepare(
                "SELECT date(started_at, 'unixepoch') AS d,
                        note_id,
                        COALESCE(SUM(active_secs), 0)
                 FROM study_sessions
                 WHERE started_at >= ?1
                 GROUP BY d, note_id
                 ORDER BY d DESC, SUM(active_secs) DESC",
            )
            .map_err(|e| format!("准备 daily_details 查询失败: {}", e))?;

        let rows: Vec<(String, String, i64)> = stmt
            .query_map(params![window_start], |row| {
                Ok((row.get(0)?, row.get(1)?, row.get(2)?))
            })
            .map_err(|e| format!("执行 daily_details 查询失败: {}", e))?
            .filter_map(|r| r.ok())
            .collect();

        // 按日期分组
        let mut groups: Vec<DailyDetailGroup> = Vec::new();
        for (date, note_id, active_secs) in rows {
            if let Some(g) = groups.last_mut() {
                if g.date == date {
                    g.files.push(DailyFileDetail { note_id, active_secs });
                    continue;
                }
            }
            groups.push(DailyDetailGroup {
                date,
                files: vec![DailyFileDetail { note_id, active_secs }],
            });
        }
        groups
    };

    // ── 文件夹排行（Top 5）──
    let folder_ranking = {
        let mut stmt = conn
            .prepare(
                "SELECT folder, COALESCE(SUM(active_secs), 0) AS total
                 FROM study_sessions
                 GROUP BY folder
                 ORDER BY total DESC
                 LIMIT 5",
            )
            .map_err(|e| format!("准备 folder_ranking 查询失败: {}", e))?;

        let result = stmt
            .query_map([], |row| {
                Ok(FolderRank {
                    folder: row.get(0)?,
                    total_secs: row.get(1)?,
                })
            })
            .map_err(|e| format!("执行 folder_ranking 查询失败: {}", e))?
            .filter_map(|r| r.ok())
            .collect::<Vec<_>>();
        result
    };

    // ── 热力图（最近 180 天）──
    let heatmap = {
        let mut stmt = conn
            .prepare(
                "SELECT date(started_at, 'unixepoch') AS d,
                        COALESCE(SUM(active_secs), 0)
                 FROM study_sessions
                 WHERE started_at >= ?1
                 GROUP BY d
                 ORDER BY d ASC",
            )
            .map_err(|e| format!("准备 heatmap 查询失败: {}", e))?;

        let result = stmt
            .query_map(params![heatmap_start], |row| {
                Ok(HeatmapDay {
                    date: row.get(0)?,
                    active_secs: row.get(1)?,
                })
            })
            .map_err(|e| format!("执行 heatmap 查询失败: {}", e))?
            .filter_map(|r| r.ok())
            .collect::<Vec<_>>();
        result
    };

    Ok(StudyStats {
        today_active_secs,
        today_files,
        week_active_secs,
        streak_days,
        daily_summary,
        daily_details,
        folder_ranking,
        heatmap,
    })
}
