use rusqlite::{params, Connection};
use std::path::Path;

pub(crate) fn fts_available(conn: &Connection) -> bool {
    conn.query_row(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name='notes_fts' LIMIT 1",
        [],
        |_| Ok(()),
    )
    .is_ok()
}

pub(crate) fn sync_fts_row(conn: &Connection, id: &str) -> Result<(), String> {
    if !fts_available(conn) {
        return Ok(());
    }

    conn.execute("DELETE FROM notes_fts WHERE id = ?1", params![id])
        .map_err(|e| format!("删除 FTS 行失败 [{}]: {}", id, e))?;

    conn.execute(
        "INSERT INTO notes_fts (id, filename, content)
         SELECT id, filename, content FROM notes_index WHERE id = ?1",
        params![id],
    )
    .map_err(|e| format!("写入 FTS 行失败 [{}]: {}", id, e))?;

    Ok(())
}

pub(crate) fn delete_fts_row(conn: &Connection, id: &str) -> Result<(), String> {
    if !fts_available(conn) {
        return Ok(());
    }
    conn.execute("DELETE FROM notes_fts WHERE id = ?1", params![id])
        .map_err(|e| format!("删除 FTS 行失败 [{}]: {}", id, e))?;
    Ok(())
}

/// 初始化数据库：在指定的 Vault 目录下创建/打开 index.db 文件，
/// 并执行建表语句（IF NOT EXISTS 保证幂等性）。
pub fn init_db(vault_path: &str) -> Result<Connection, String> {
    let db_path = Path::new(vault_path).join("index.db");

    let conn = Connection::open(&db_path)
        .map_err(|e| format!("打开数据库失败 [{}]: {}", db_path.display(), e))?;

    // 启用 WAL 模式，提升并发读写性能
    conn.execute_batch("PRAGMA journal_mode=WAL;")
        .map_err(|e| format!("设置 WAL 模式失败: {}", e))?;

    // 笔记索引表
    conn.execute(
        "CREATE TABLE IF NOT EXISTS notes_index (
            id            TEXT PRIMARY KEY,
            filename      TEXT NOT NULL,
            absolute_path TEXT NOT NULL,
            created_at    INTEGER NOT NULL,
            updated_at    INTEGER NOT NULL,
            content       TEXT NOT NULL DEFAULT '',
            embedding     BLOB
        )",
        [],
    )
    .map_err(|e| format!("创建 notes_index 表失败: {}", e))?;

    // 兼容旧数据库：如果表已存在但缺少 embedding 列，动态添加
    // ALTER TABLE ... ADD COLUMN 在列已存在时会报错，这里静默忽略即可
    let _ = conn.execute("ALTER TABLE notes_index ADD COLUMN embedding BLOB", []);

    // 链接关系表：记录笔记之间的 [[双向链接]] 关系
    // source_id: 发起链接的笔记 ID（相对路径）
    // target_name: 被链接笔记的名称（[[...]] 内部的文字）
    // 复合主键 (source_id, target_name) 保证同一对关系不会重复
    conn.execute(
        "CREATE TABLE IF NOT EXISTS note_links (
            source_id   TEXT NOT NULL,
            target_name TEXT NOT NULL,
            PRIMARY KEY (source_id, target_name)
        )",
        [],
    )
    .map_err(|e| format!("创建 note_links 表失败: {}", e))?;

    // 为 target_name 建立索引，加速反向链接查询
    // （查询"谁链接了我"时按 target_name 检索）
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_links_target ON note_links (target_name)",
        [],
    )
    .map_err(|e| format!("创建 target_name 索引失败: {}", e))?;

    // 标签关联表：记录笔记与标签的多对多关系
    // note_id: 笔记 ID（相对路径）
    // tag_name: 标签名称（支持 / 分隔的层级标签，如 "学习/化学"）
    // 复合主键 (note_id, tag_name) 保证同一对关系不会重复
    conn.execute(
        "CREATE TABLE IF NOT EXISTS note_tags (
            note_id  TEXT NOT NULL,
            tag_name TEXT NOT NULL,
            PRIMARY KEY (note_id, tag_name)
        )",
        [],
    )
    .map_err(|e| format!("创建 note_tags 表失败: {}", e))?;

    // 为 tag_name 建立索引，加速按标签查询笔记
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_tags_name ON note_tags (tag_name)",
        [],
    )
    .map_err(|e| format!("创建 tag_name 索引失败: {}", e))?;

    // FTS5 全文索引（文件名 + 正文内容），用于快速搜索
    // 如果当前 SQLite 构建不支持 FTS5，这里会失败，后续自动回退到 LIKE 查询。
    let fts_created = conn
        .execute(
            "CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(
                id UNINDEXED,
                filename,
                content
            )",
            [],
        )
        .is_ok();
    if fts_created {
        let _ = conn.execute(
            "INSERT INTO notes_fts (id, filename, content)
             SELECT id, filename, content FROM notes_index",
            [],
        );
    }

    Ok(conn)
}
