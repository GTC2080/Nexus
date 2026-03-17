use rusqlite::{params, types::ToSql, Connection, OptionalExtension};

use crate::models::{NoteInfo, TagInfo};

use super::common::ext_from_path;
use super::relations::{sync_links, sync_tags};
use super::schema::{fts_available, sync_fts_row};

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
    let placeholders: Vec<String> = ids
        .iter()
        .enumerate()
        .map(|(i, _)| format!("?{}", i + 1))
        .collect();
    let sql = format!(
        "SELECT filename, content FROM notes_index WHERE id IN ({})",
        placeholders.join(", ")
    );

    let mut stmt = conn
        .prepare(&sql)
        .map_err(|e| format!("准备批量内容查询失败: {}", e))?;

    let params: Vec<&dyn ToSql> = ids.iter().map(|id| id as &dyn ToSql).collect();

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
