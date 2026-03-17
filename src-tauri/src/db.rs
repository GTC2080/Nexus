use regex::Regex;
use rusqlite::{params, Connection, OptionalExtension};
use std::path::Path;
use std::sync::{Arc, Mutex, OnceLock};

use std::collections::HashMap;

use crate::models::{GraphData, GraphLink, GraphNode, NoteInfo, TagInfo};

/// 从路径字符串中提取文件扩展名（小写），无扩展名返回空字符串。
fn ext_from_path(path: &str) -> String {
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

fn fts_available(conn: &Connection) -> bool {
    conn.query_row(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name='notes_fts' LIMIT 1",
        [],
        |_| Ok(()),
    )
    .is_ok()
}

fn sync_fts_row(conn: &Connection, id: &str) -> Result<(), String> {
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

fn delete_fts_row(conn: &Connection, id: &str) -> Result<(), String> {
    if !fts_available(conn) {
        return Ok(());
    }
    conn.execute("DELETE FROM notes_fts WHERE id = ?1", params![id])
        .map_err(|e| format!("删除 FTS 行失败 [{}]: {}", id, e))?;
    Ok(())
}

/// 懒加载的正则表达式实例。
/// 使用 OnceLock 确保正则只编译一次，后续调用直接复用，
/// 避免每次 extract_links 调用时重复编译带来的性能开销。
/// 模式 `\[\[([^\[\]]+)\]\]` 匹配 [[...]] 内部的非方括号文本。
fn wiki_link_regex() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"\[\[([^\[\]]+)\]\]").expect("WikiLink 正则编译失败"))
}

/// 行内标签正则：匹配 #标签 语法，排除 Markdown 标题（# 后跟空格）。
/// 模式 `(?m)(^|\s)#([^\s#]+)` 匹配行首或空白后的 #非空白非#字符。
fn inline_tag_regex() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"(?m)(?:^|\s)#([^\s#]+)").expect("行内标签正则编译失败"))
}

/// Frontmatter 正则：匹配文件开头由 --- 包裹的 YAML 区域。
fn frontmatter_regex() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"(?s)\A---\r?\n(.*?)\r?\n---").expect("Frontmatter 正则编译失败"))
}

/// 从 Markdown 纯文本中提取所有 [[双向链接]] 的目标名称。
///
/// # 示例
/// ```
/// let links = extract_links("参见 [[日记]] 和 [[项目计划]]");
/// assert_eq!(links, vec!["日记", "项目计划"]);
/// ```
///
/// # 实现细节
/// - 使用预编译的正则表达式，性能极高（万字文档 < 1ms）
/// - 自动去重：同一篇笔记中多次引用同一目标只记录一次
pub fn extract_links(content: &str) -> Vec<String> {
    let re = wiki_link_regex();
    let mut targets: Vec<String> = re
        .captures_iter(content)
        .map(|cap| cap[1].to_string())
        .collect();

    // 去重：同一篇笔记中多次 [[A]] 只保留一条关系
    targets.sort();
    targets.dedup();
    targets
}

/// 从 Frontmatter YAML 中提取 tags 数组。
///
/// 支持两种格式：
/// ```yaml
/// tags: [学习, 化学]
/// tags:
///   - 学习
///   - 化学
/// ```
fn extract_frontmatter_tags(content: &str) -> Vec<String> {
    let re = frontmatter_regex();
    let yaml_str = match re.captures(content) {
        Some(cap) => cap[1].to_string(),
        None => return Vec::new(),
    };

    // 解析 YAML 为通用 Value，只提取 tags 字段
    let value: serde_yaml::Value = match serde_yaml::from_str(&yaml_str) {
        Ok(v) => v,
        Err(_) => return Vec::new(),
    };

    match value.get("tags") {
        Some(serde_yaml::Value::Sequence(seq)) => {
            seq.iter()
                .filter_map(|v| v.as_str().map(|s| s.trim().to_string()))
                .filter(|s| !s.is_empty())
                .collect()
        }
        Some(serde_yaml::Value::String(s)) => {
            // 单个标签字符串
            let trimmed = s.trim().to_string();
            if trimmed.is_empty() { Vec::new() } else { vec![trimmed] }
        }
        _ => Vec::new(),
    }
}

/// 从正文中提取行内 #标签（排除 Markdown 标题语法）。
fn extract_inline_tags(content: &str) -> Vec<String> {
    let re = inline_tag_regex();
    re.captures_iter(content)
        .map(|cap| cap[1].to_string())
        .collect()
}

/// 从完整笔记内容中提取所有标签（Frontmatter + 行内），去重后返回。
pub fn extract_all_tags(content: &str) -> Vec<String> {
    let mut tags = extract_frontmatter_tags(content);
    tags.extend(extract_inline_tags(content));
    tags.sort();
    tags.dedup();
    tags
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

/// 同步某篇笔记的链接关系到 note_links 表。
///
/// # 更新策略（先删后插）
/// 1. DELETE 该 source_id 的所有旧链接记录
/// 2. 从 content 中提取新的 [[...]] 目标列表
/// 3. 批量 INSERT 新的链接关系
///
/// 这种"全量替换"策略简单可靠，对于单篇笔记的链接数量（通常 < 100）
/// 性能完全不是问题。
fn sync_links(conn: &Connection, source_id: &str, content: &str) -> Result<(), String> {
    // 第一步：清除该笔记的所有旧链接
    conn.execute(
        "DELETE FROM note_links WHERE source_id = ?1",
        params![source_id],
    )
    .map_err(|e| format!("清除旧链接失败 [{}]: {}", source_id, e))?;

    // 第二步：提取新链接并批量插入
    let targets = extract_links(content);
    if targets.is_empty() {
        return Ok(());
    }

    let mut stmt = conn
        .prepare("INSERT OR IGNORE INTO note_links (source_id, target_name) VALUES (?1, ?2)")
        .map_err(|e| format!("准备插入链接语句失败: {}", e))?;

    for target in &targets {
        stmt.execute(params![source_id, target])
            .map_err(|e| format!("插入链接失败 [{} → {}]: {}", source_id, target, e))?;
    }

    Ok(())
}

/// 同步某篇笔记的标签关系到 note_tags 表。
/// 策略与 sync_links 相同：先 DELETE 后 INSERT。
fn sync_tags(conn: &Connection, note_id: &str, content: &str) -> Result<(), String> {
    conn.execute(
        "DELETE FROM note_tags WHERE note_id = ?1",
        params![note_id],
    )
    .map_err(|e| format!("清除旧标签失败 [{}]: {}", note_id, e))?;

    let tags = extract_all_tags(content);
    if tags.is_empty() {
        return Ok(());
    }

    let mut stmt = conn
        .prepare("INSERT OR IGNORE INTO note_tags (note_id, tag_name) VALUES (?1, ?2)")
        .map_err(|e| format!("准备插入标签语句失败: {}", e))?;

    for tag in &tags {
        stmt.execute(params![note_id, tag])
            .map_err(|e| format!("插入标签失败 [{} → {}]: {}", note_id, tag, e))?;
    }

    Ok(())
}

/// Upsert 单条笔记记录到数据库，并同步其链接关系。
pub fn upsert_note(
    conn: &Connection,
    id: &str,
    filename: &str,
    absolute_path: &str,
    created_at: i64,
    updated_at: i64,
    content: &str,
) -> Result<(), String> {
    conn.execute(
        "INSERT OR REPLACE INTO notes_index (id, filename, absolute_path, created_at, updated_at, content)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![id, filename, absolute_path, created_at, updated_at, content],
    )
    .map_err(|e| format!("Upsert 笔记失败 [{}]: {}", id, e))?;

    // 同步链接关系：解析 content 中的 [[...]] 并写入 note_links 表
    sync_links(conn, id, content)?;

    // 同步标签关系：解析 Frontmatter 和行内 #标签 并写入 note_tags 表
    sync_tags(conn, id, content)?;
    sync_fts_row(conn, id)?;

    Ok(())
}
pub fn get_note_updated_at(conn: &Connection, id: &str) -> Result<Option<i64>, String> {
    conn.query_row(
        "SELECT updated_at FROM notes_index WHERE id = ?1",
        params![id],
        |row| row.get(0),
    )
    .optional()
    .map_err(|e| format!("查询笔记时间戳失败 [{}]: {}", id, e))
}

/// 更新数据库中指定笔记的内容、修改时间，并同步链接关系。
pub fn update_note_content(
    conn: &Connection,
    id: &str,
    content: &str,
    updated_at: i64,
) -> Result<(), String> {
    conn.execute(
        "UPDATE notes_index SET content = ?1, updated_at = ?2 WHERE id = ?3",
        params![content, updated_at, id],
    )
    .map_err(|e| format!("更新笔记内容失败 [{}]: {}", id, e))?;

    // 每次内容更新时重新同步链接关系
    sync_links(conn, id, content)?;

    // 每次内容更新时重新同步标签关系
    sync_tags(conn, id, content)?;
    sync_fts_row(conn, id)?;

    Ok(())
}

fn build_fts_match_query(query: &str) -> String {
    query
        .split_whitespace()
        .filter(|s| !s.is_empty())
        .map(|s| {
            let safe = s.replace('"', "\"\"");
            format!("\"{}\"*", safe)
        })
        .collect::<Vec<String>>()
        .join(" ")
}

pub fn search_notes_by_filename(conn: &Connection, query: &str) -> Result<Vec<NoteInfo>, String> {
    let fts_query = build_fts_match_query(query);
    if !fts_query.is_empty() && fts_available(conn) {
        let mut stmt = conn
            .prepare(
                "SELECT n.id, n.filename, n.absolute_path, n.created_at, n.updated_at
                 FROM notes_fts f
                 INNER JOIN notes_index n ON n.id = f.id
                 WHERE notes_fts MATCH ?1
                 ORDER BY bm25(notes_fts), n.updated_at DESC
                 LIMIT 10",
            )
            .map_err(|e| format!("准备 FTS 搜索语句失败: {}", e))?;

        let rows = stmt
            .query_map(params![fts_query], |row| {
                let abs_path: String = row.get(2)?;
                Ok(NoteInfo {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    file_extension: ext_from_path(&abs_path),
                    path: abs_path,
                    created_at: row.get(3)?,
                    updated_at: row.get(4)?,
                })
            })
            .map_err(|e| format!("执行 FTS 搜索查询失败: {}", e))?;

        let mut fts_results = Vec::new();
        for row in rows {
            fts_results.push(row.map_err(|e| format!("读取 FTS 搜索结果失败: {}", e))?);
        }
        if !fts_results.is_empty() {
            return Ok(fts_results);
        }
    }

    let pattern = format!("%{}%", query);

    let mut stmt = conn
        .prepare(
            "SELECT id, filename, absolute_path, created_at, updated_at
             FROM notes_index
             WHERE filename LIKE ?1
             ORDER BY updated_at DESC
             LIMIT 10",
        )
        .map_err(|e| format!("准备搜索语句失败: {}", e))?;

    let rows = stmt
        .query_map(params![pattern], |row| {
            let abs_path: String = row.get(2)?;
            Ok(NoteInfo {
                id: row.get(0)?,
                name: row.get(1)?,
                file_extension: ext_from_path(&abs_path),
                path: abs_path,
                created_at: row.get(3)?,
                updated_at: row.get(4)?,
            })
        })
        .map_err(|e| format!("执行搜索查询失败: {}", e))?;

    let mut results = Vec::new();
    for row in rows {
        results.push(row.map_err(|e| format!("读取搜索结果失败: {}", e))?);
    }
    Ok(results)
}

/// 查询反向链接：找出所有链接到指定笔记名称的源笔记。
///
/// # 查询逻辑
/// 1. 在 note_links 表中找到所有 target_name = 目标名称 的 source_id
/// 2. 用这些 source_id 去 notes_index 表中捞出完整的笔记元数据
/// 3. 使用 JOIN 一次查询完成，避免 N+1 问题
///
/// # 参数
/// - `target_name`: 被链接笔记的名称（即 [[...]] 内部的文字）
pub fn get_backlinks(conn: &Connection, target_name: &str) -> Result<Vec<NoteInfo>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT n.id, n.filename, n.absolute_path, n.created_at, n.updated_at
             FROM note_links l
             INNER JOIN notes_index n ON l.source_id = n.id
             WHERE l.target_name = ?1
             ORDER BY n.updated_at DESC",
        )
        .map_err(|e| format!("准备反向链接查询失败: {}", e))?;

    let rows = stmt
        .query_map(params![target_name], |row| {
            let abs_path: String = row.get(2)?;
            Ok(NoteInfo {
                id: row.get(0)?,
                name: row.get(1)?,
                file_extension: ext_from_path(&abs_path),
                path: abs_path,
                created_at: row.get(3)?,
                updated_at: row.get(4)?,
            })
        })
        .map_err(|e| format!("执行反向链接查询失败: {}", e))?;

    let mut results = Vec::new();
    for row in rows {
        results.push(row.map_err(|e| format!("读取反向链接结果失败: {}", e))?);
    }
    Ok(results)
}

/// 将向量化结果（Vec<f32>）写入指定笔记的 embedding 字段。
///
/// # Vec<f32> → BLOB 序列化方案
/// 直接将 f32 数组的内存表示（每个 f32 占 4 字节，小端序）
/// 拷贝为连续的字节切片存入 SQLite BLOB。
/// 这种方式零拷贝、零开销，比 JSON 序列化快几个数量级。
///
/// 反序列化时只需将 BLOB 按 4 字节对齐重新解释为 &[f32] 即可。
pub fn update_note_embedding(
    conn: &Connection,
    id: &str,
    embedding: &[f32],
) -> Result<(), String> {
    // 安全地将 &[f32] 转换为 &[u8]：
    // 每个 f32 = 4 bytes，总长度 = embedding.len() * 4
    let bytes: &[u8] = unsafe {
        std::slice::from_raw_parts(
            embedding.as_ptr() as *const u8,
            embedding.len() * std::mem::size_of::<f32>(),
        )
    };

    conn.execute(
        "UPDATE notes_index SET embedding = ?1 WHERE id = ?2",
        params![bytes, id],
    )
    .map_err(|e| format!("更新笔记向量失败 [{}]: {}", id, e))?;

    Ok(())
}

/// 从 SQLite BLOB 中读取指定笔记的 embedding 向量。
///
/// # BLOB → Vec<f32> 反序列化
/// 将存储的原始字节按每 4 字节一组解释为 f32（小端序），
/// 还原为 Vec<f32>。要求 BLOB 长度必须是 4 的整数倍。
/// 已用于语义共鸣（`get_related_notes`）优先复用已有向量，
/// 以减少重复调用 Embedding API。
pub fn get_note_embedding(conn: &Connection, id: &str) -> Result<Option<Vec<f32>>, String> {
    let blob: Option<Vec<u8>> = conn
        .query_row(
            "SELECT embedding FROM notes_index WHERE id = ?1",
            params![id],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| format!("查询笔记向量失败 [{}]: {}", id, e))?
        // query_row 返回 Option<Option<Vec<u8>>>，展平为 Option<Vec<u8>>
        .flatten();

    match blob {
        None => Ok(None),
        Some(bytes) => {
            // 校验字节长度必须是 4 的整数倍（每个 f32 = 4 bytes）
            if bytes.len() % 4 != 0 {
                return Err(format!(
                    "embedding BLOB 长度异常 [{}]: {} 字节不是 4 的整数倍",
                    id,
                    bytes.len()
                ));
            }
            let float_count = bytes.len() / 4;
            let mut embedding = Vec::with_capacity(float_count);
            for chunk in bytes.chunks_exact(4) {
                // 从小端字节序还原 f32
                embedding.push(f32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]));
            }
            Ok(Some(embedding))
        }
    }
}

/// 构建全局关系图谱数据。
///
/// # 逻辑
/// 1. 从 notes_index 拉取所有笔记作为真实节点
/// 2. 建立 filename → id 的 HashMap，用于将 note_links.target_name 映射回节点 id
/// 3. 遍历 note_links，对每条连线：
///    - 如果 target_name 能映射到已有笔记 → 直接建立连线
///    - 如果 target_name 无对应笔记 → 创建幽灵节点，再建立连线
/// 4. 返回完整的 GraphData { nodes, links }
pub fn get_graph_data(conn: &Connection) -> Result<GraphData, String> {
    // 第一步：拉取所有真实笔记节点
    let mut stmt = conn
        .prepare("SELECT id, filename FROM notes_index")
        .map_err(|e| format!("准备图谱节点查询失败: {}", e))?;

    let rows = stmt
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
            ))
        })
        .map_err(|e| format!("执行图谱节点查询失败: {}", e))?;

    let mut nodes: Vec<GraphNode> = Vec::new();
    // filename → id 映射，用于将 target_name 解析为节点 id
    let mut name_to_id: HashMap<String, String> = HashMap::new();
    // 已存在的节点 id 集合，用于快速判重
    let mut node_ids: std::collections::HashSet<String> = std::collections::HashSet::new();

    for row in rows {
        let (id, filename) = row.map_err(|e| format!("读取图谱节点失败: {}", e))?;
        name_to_id.insert(filename.clone(), id.clone());
        node_ids.insert(id.clone());
        nodes.push(GraphNode {
            id,
            name: filename,
            ghost: false,
        });
    }

    // 第二步：拉取所有连线
    let mut link_stmt = conn
        .prepare("SELECT source_id, target_name FROM note_links")
        .map_err(|e| format!("准备图谱连线查询失败: {}", e))?;

    let link_rows = link_stmt
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
            ))
        })
        .map_err(|e| format!("执行图谱连线查询失败: {}", e))?;

    let mut links: Vec<GraphLink> = Vec::new();
    // 幽灵节点计数器
    let mut ghost_counter: u32 = 0;

    for row in link_rows {
        let (source_id, target_name) = row.map_err(|e| format!("读取图谱连线失败: {}", e))?;

        // 源节点不存在于 nodes 中则跳过（理论上不会发生）
        if !node_ids.contains(&source_id) {
            continue;
        }

        // 将 target_name 映射为节点 id
        let target_id = if let Some(existing_id) = name_to_id.get(&target_name) {
            existing_id.clone()
        } else {
            // 幽灵节点：被链接但尚未创建的笔记
            ghost_counter += 1;
            let ghost_id = format!("__ghost_{}_{}", ghost_counter, &target_name);
            name_to_id.insert(target_name.clone(), ghost_id.clone());
            node_ids.insert(ghost_id.clone());
            nodes.push(GraphNode {
                id: ghost_id.clone(),
                name: target_name,
                ghost: true,
            });
            ghost_id
        };

        links.push(GraphLink {
            source: source_id,
            target: target_id,
        });
    }

    Ok(GraphData { nodes, links })
}

/// 聚合所有标签及其关联的笔记数量。
/// 按笔记数量降序排列，相同数量按标签名排序。
pub fn get_all_tags(conn: &Connection) -> Result<Vec<TagInfo>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT tag_name, COUNT(*) as cnt
             FROM note_tags
             GROUP BY tag_name
             ORDER BY cnt DESC, tag_name ASC",
        )
        .map_err(|e| format!("准备标签聚合查询失败: {}", e))?;

    let rows = stmt
        .query_map([], |row| {
            Ok(TagInfo {
                name: row.get(0)?,
                count: row.get(1)?,
            })
        })
        .map_err(|e| format!("执行标签聚合查询失败: {}", e))?;

    let mut results = Vec::new();
    for row in rows {
        results.push(row.map_err(|e| format!("读取标签聚合结果失败: {}", e))?);
    }
    Ok(results)
}

/// 查询带有特定标签的所有笔记。
pub fn get_notes_by_tag(conn: &Connection, tag: &str) -> Result<Vec<NoteInfo>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT n.id, n.filename, n.absolute_path, n.created_at, n.updated_at
             FROM note_tags t
             INNER JOIN notes_index n ON t.note_id = n.id
             WHERE t.tag_name = ?1
             ORDER BY n.updated_at DESC",
        )
        .map_err(|e| format!("准备按标签查询笔记失败: {}", e))?;

    let rows = stmt
        .query_map(params![tag], |row| {
            let abs_path: String = row.get(2)?;
            Ok(NoteInfo {
                id: row.get(0)?,
                name: row.get(1)?,
                file_extension: ext_from_path(&abs_path),
                path: abs_path,
                created_at: row.get(3)?,
                updated_at: row.get(4)?,
            })
        })
        .map_err(|e| format!("执行按标签查询笔记失败: {}", e))?;

    let mut results = Vec::new();
    for row in rows {
        results.push(row.map_err(|e| format!("读取按标签查询结果失败: {}", e))?);
    }
    Ok(results)
}

/// 批量获取笔记的内容和文件名，用于 RAG 上下文组装。
/// 返回 Vec<(filename, content)>。
pub fn get_notes_content_by_ids(
    conn: &Connection,
    ids: &[String],
) -> Result<Vec<(String, String)>, String> {
    if ids.is_empty() {
        return Ok(Vec::new());
    }

    // 动态构建 IN 子句的占位符
    let placeholders: Vec<String> = ids.iter().enumerate().map(|(i, _)| format!("?{}", i + 1)).collect();
    let sql = format!(
        "SELECT filename, content FROM notes_index WHERE id IN ({})",
        placeholders.join(", ")
    );

    let mut stmt = conn.prepare(&sql).map_err(|e| format!("准备批量内容查询失败: {}", e))?;

    let params: Vec<&dyn rusqlite::types::ToSql> = ids.iter().map(|id| id as &dyn rusqlite::types::ToSql).collect();

    let rows = stmt
        .query_map(params.as_slice(), |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(|e| format!("执行批量内容查询失败: {}", e))?;

    let mut results = Vec::new();
    for row in rows {
        results.push(row.map_err(|e| format!("读取批量内容结果失败: {}", e))?);
    }
    Ok(results)
}

/// 拉取最近更新的、已向量化的候选集，避免每次语义检索全表扫描。
pub fn get_recent_embeddings(
    conn: &Connection,
    candidate_limit: usize,
) -> Result<Vec<(NoteInfo, Vec<f32>)>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, filename, absolute_path, created_at, updated_at, embedding
             FROM notes_index
             WHERE embedding IS NOT NULL
             ORDER BY updated_at DESC
             LIMIT ?1",
        )
        .map_err(|e| format!("准备候选向量查询语句失败: {}", e))?;

    let rows = stmt
        .query_map(params![candidate_limit as i64], |row| {
            let blob: Vec<u8> = row.get(5)?;
            let abs_path: String = row.get(2)?;
            Ok((
                NoteInfo {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    file_extension: ext_from_path(&abs_path),
                    path: abs_path,
                    created_at: row.get(3)?,
                    updated_at: row.get(4)?,
                },
                blob,
            ))
        })
        .map_err(|e| format!("执行候选向量查询失败: {}", e))?;

    let mut results = Vec::new();
    for row in rows {
        let (note, bytes) = row.map_err(|e| format!("读取候选向量数据失败: {}", e))?;
        if bytes.len() % 4 != 0 {
            continue;
        }
        let embedding: Vec<f32> = bytes
            .chunks_exact(4)
            .map(|c| f32::from_le_bytes([c[0], c[1], c[2], c[3]]))
            .collect();
        results.push((note, embedding));
    }

    Ok(results)
}

/// 根据笔记 id 读取索引库中的内容（用于二进制文件的语义共鸣上下文）。
pub fn get_note_content_by_id(conn: &Connection, id: &str) -> Result<Option<String>, String> {
    conn.query_row(
        "SELECT content FROM notes_index WHERE id = ?1",
        params![id],
        |row| row.get::<_, String>(0),
    )
    .optional()
    .map_err(|e| format!("读取笔记内容失败 [{}]: {}", id, e))
}

/// 删除单篇笔记及其关联索引数据（链接/标签）。
pub fn delete_note_by_id(conn: &Connection, id: &str) -> Result<(), String> {
    delete_fts_row(conn, id)?;
    conn.execute("DELETE FROM note_links WHERE source_id = ?1", params![id])
        .map_err(|e| format!("删除 note_links 失败 [{}]: {}", id, e))?;
    conn.execute("DELETE FROM note_tags WHERE note_id = ?1", params![id])
        .map_err(|e| format!("删除 note_tags 失败 [{}]: {}", id, e))?;
    conn.execute("DELETE FROM notes_index WHERE id = ?1", params![id])
        .map_err(|e| format!("删除 notes_index 失败 [{}]: {}", id, e))?;
    Ok(())
}

/// 删除目录下所有笔记索引数据（包含子目录）。
pub fn delete_notes_by_prefix(conn: &Connection, prefix: &str) -> Result<(), String> {
    let slash = format!("{}/%", prefix);
    let backslash = format!("{}\\%", prefix);

    let mut stmt = conn
        .prepare(
            "SELECT id FROM notes_index
             WHERE id = ?1 OR id LIKE ?2 OR id LIKE ?3",
        )
        .map_err(|e| format!("准备批量删除查询失败: {}", e))?;

    let rows = stmt
        .query_map(params![prefix, slash, backslash], |row| row.get::<_, String>(0))
        .map_err(|e| format!("执行批量删除查询失败: {}", e))?;

    let mut ids = Vec::new();
    for row in rows {
        ids.push(row.map_err(|e| format!("读取批量删除结果失败: {}", e))?);
    }

    for id in &ids {
        delete_note_by_id(conn, id)?;
    }

    Ok(())
}

/// 重命名单个笔记的 id（相对路径）以及绝对路径，同时更新关联的链接和标签表。
pub fn rename_note_id(conn: &Connection, old_id: &str, new_id: &str, new_path: &str) -> Result<(), String> {
    conn.execute(
        "UPDATE notes_index SET id = ?1, absolute_path = ?2 WHERE id = ?3",
        params![new_id, new_path, old_id],
    ).map_err(|e| format!("重命名笔记索引失败 [{}→{}]: {}", old_id, new_id, e))?;

    conn.execute(
        "UPDATE note_links SET source_id = ?1 WHERE source_id = ?2",
        params![new_id, old_id],
    ).map_err(|e| format!("更新 note_links source_id 失败: {}", e))?;

    conn.execute(
        "UPDATE note_tags SET note_id = ?1 WHERE note_id = ?2",
        params![new_id, old_id],
    ).map_err(|e| format!("更新 note_tags note_id 失败: {}", e))?;

    if fts_available(conn) {
        conn.execute(
            "UPDATE notes_fts SET id = ?1 WHERE id = ?2",
            params![new_id, old_id],
        ).map_err(|e| format!("更新 notes_fts id 失败: {}", e))?;
    }

    Ok(())
}

/// 批量重命名某前缀下所有笔记的 id（用于移动文件夹时）。
pub fn rename_notes_by_prefix(
    conn: &Connection,
    old_prefix: &str,
    new_prefix: &str,
    vault_path: &str,
) -> Result<(), String> {
    let slash = format!("{}/%", old_prefix);
    let backslash = format!("{}\\%", old_prefix);

    let mut stmt = conn
        .prepare("SELECT id, absolute_path FROM notes_index WHERE id = ?1 OR id LIKE ?2 OR id LIKE ?3")
        .map_err(|e| format!("准备批量重命名查询失败: {}", e))?;

    let rows = stmt
        .query_map(params![old_prefix, slash, backslash], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(|e| format!("执行批量重命名查询失败: {}", e))?;

    let mut entries = Vec::new();
    for row in rows {
        entries.push(row.map_err(|e| format!("读取批量重命名结果失败: {}", e))?);
    }

    let vault_normalized = vault_path.replace('\\', "/").trim_end_matches('/').to_string();
    for (old_id, _old_path) in &entries {
        let old_id_normalized = old_id.replace('\\', "/");
        let suffix = old_id_normalized.strip_prefix(&old_prefix.replace('\\', "/")).unwrap_or(&old_id_normalized);
        let new_id = format!("{}{}", new_prefix, suffix);
        let new_path = format!("{}/{}", vault_normalized, new_id);
        rename_note_id(conn, old_id, &new_id, &new_path)?;
    }

    Ok(())
}
