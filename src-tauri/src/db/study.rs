mod session;
mod stats;
mod truth;

pub use session::{start_session, tick_session, end_session};
pub use stats::{query_stats, StudyStats};
pub use truth::{query_truth_state, TruthStateDto};

// ──────────────────────────────────────────
// 共享时间工具
// ──────────────────────────────────────────

use std::time::{SystemTime, UNIX_EPOCH};

fn unix_now_secs() -> Result<i64, String> {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .map_err(|e| format!("获取时间失败: {}", e))
}

fn unix_now_ms() -> Result<i64, String> {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .map_err(|e| format!("获取时间失败: {}", e))
}
