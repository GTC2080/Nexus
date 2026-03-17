use rusqlite::Connection;
use std::path::Path;
use std::sync::{Arc, Mutex};

/// 从路径字符串中提取文件扩展名（小写），无扩展名返回空字符串。
pub(super) fn ext_from_path(path: &str) -> String {
    Path::new(path)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase()
}

/// 数据库状态包装器
/// 使用 Arc<Mutex<>> 实现跨线程共享：
/// - Mutex 保证对 SQLite 连接的互斥访问
/// - Arc 允许在 tokio 异步任务中安全引用同一个连接
///   （向量化后台任务需要在完成后写回数据库）
pub struct DbState {
    pub conn: Arc<Mutex<Connection>>,
}
