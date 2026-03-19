use rusqlite::{params, types::ToSql, Connection, OptionalExtension};

use crate::models::{NoteInfo, TagInfo, TagTreeNode};
use crate::AppResult;

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
) -> AppResult<()> {
    conn.execute(
        "INSERT OR REPLACE INTO notes_index (id, filename, absolute_path, created_at, updated_at, content)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![id, filename, absolute_path, created_at, updated_at, content],
    )?;

    // 同步链接关系：解析 content 中的 [[...]] 并写入 note_links 表
    sync_links(conn, id, content)?;

    // 同步标签关系：解析 Frontmatter 和行内 #标签 并写入 note_tags 表
    sync_tags(conn, id, content)?;
    sync_fts_row(conn, id)?;

    Ok(())
}

#[allow(dead_code)]
pub fn get_note_updated_at(conn: &Connection, id: &str) -> AppResult<Option<i64>> {
    conn.query_row(
        "SELECT updated_at FROM notes_index WHERE id = ?1",
        params![id],
        |row| row.get(0),
    )
    .optional()
    .map_err(Into::into)
}

/// Batch-read all note updated_at timestamps into a HashMap.
pub fn get_all_note_timestamps(conn: &Connection) -> AppResult<std::collections::HashMap<String, i64>> {
    let mut stmt = conn.prepare("SELECT id, updated_at FROM notes_index")?;
    let rows = stmt.query_map([], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
    })?;
    let mut map = std::collections::HashMap::new();
    for row in rows {
        let (id, ts) = row?;
        map.insert(id, ts);
    }
    Ok(map)
}

/// 更新数据库中指定笔记的内容、修改时间，并同步链接关系。
pub fn update_note_content(
    conn: &Connection,
    id: &str,
    content: &str,
    updated_at: i64,
) -> AppResult<()> {
    conn.execute(
        "UPDATE notes_index SET content = ?1, updated_at = ?2 WHERE id = ?3",
        params![content, updated_at, id],
    )?;

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

pub fn search_notes_by_filename(conn: &Connection, query: &str) -> AppResult<Vec<NoteInfo>> {
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
            )?;

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
            })?;

        let mut fts_results = Vec::new();
        for row in rows {
            fts_results.push(row?);
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
        )?;

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
        })?;

    let mut results = Vec::new();
    for row in rows {
        results.push(row?);
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
pub fn get_backlinks(conn: &Connection, target_name: &str) -> AppResult<Vec<NoteInfo>> {
    let mut stmt = conn
        .prepare(
            "SELECT n.id, n.filename, n.absolute_path, n.created_at, n.updated_at
             FROM note_links l
             INNER JOIN notes_index n ON l.source_id = n.id
             WHERE l.target_name = ?1
             ORDER BY n.updated_at DESC",
        )?;

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
        })?;

    let mut results = Vec::new();
    for row in rows {
        results.push(row?);
    }
    Ok(results)
}

/// 聚合所有标签及其关联的笔记数量。
/// 按笔记数量降序排列，相同数量按标签名排序。
pub fn get_all_tags(conn: &Connection) -> AppResult<Vec<TagInfo>> {
    let mut stmt = conn
        .prepare(
            "SELECT tag_name, COUNT(*) as cnt
             FROM note_tags
             GROUP BY tag_name
             ORDER BY cnt DESC, tag_name ASC",
        )?;

    let rows = stmt
        .query_map([], |row| {
            Ok(TagInfo {
                name: row.get(0)?,
                count: row.get(1)?,
            })
        })?;

    let mut results = Vec::new();
    for row in rows {
        results.push(row?);
    }
    Ok(results)
}

/// 查询带有特定标签的所有笔记。
pub fn get_notes_by_tag(conn: &Connection, tag: &str) -> AppResult<Vec<NoteInfo>> {
    let mut stmt = conn
        .prepare(
            "SELECT n.id, n.filename, n.absolute_path, n.created_at, n.updated_at
             FROM note_tags t
             INNER JOIN notes_index n ON t.note_id = n.id
             WHERE t.tag_name = ?1
             ORDER BY n.updated_at DESC",
        )?;

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
        })?;

    let mut results = Vec::new();
    for row in rows {
        results.push(row?);
    }
    Ok(results)
}

/// 构建层级标签树（从扁平标签列表 → 嵌套树结构）
pub fn get_tag_tree(conn: &Connection) -> AppResult<Vec<TagTreeNode>> {
    let tags = get_all_tags(conn)?;
    let mut root: Vec<TagTreeNode> = Vec::new();

    for tag in &tags {
        let parts: Vec<&str> = tag.name.split('/').collect();
        let mut current_level = &mut root;

        for (i, segment) in parts.iter().enumerate() {
            let full_path = parts[..=i].join("/");
            let pos = current_level.iter().position(|n| n.name == *segment);

            if let Some(idx) = pos {
                if full_path == tag.name {
                    current_level[idx].count = tag.count;
                }
                current_level = &mut current_level[idx].children;
            } else {
                let count = if full_path == tag.name { tag.count } else { 0 };
                current_level.push(TagTreeNode {
                    name: segment.to_string(),
                    full_path: full_path.clone(),
                    count,
                    children: Vec::new(),
                });
                let last = current_level.len() - 1;
                current_level = &mut current_level[last].children;
            }
        }
    }

    Ok(root)
}

/// 批量获取笔记的内容和文件名，用于 RAG 上下文组装。
/// 返回 Vec<(filename, content)>。
pub fn get_notes_content_by_ids(
    conn: &Connection,
    ids: &[String],
) -> AppResult<Vec<(String, String)>> {
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

    let mut stmt = conn.prepare(&sql)?;

    let params: Vec<&dyn ToSql> = ids.iter().map(|id| id as &dyn ToSql).collect();

    let rows = stmt
        .query_map(params.as_slice(), |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })?;

    let mut results = Vec::new();
    for row in rows {
        results.push(row?);
    }
    Ok(results)
}

/// 根据笔记 id 读取索引库中的内容（用于二进制文件的语义共鸣上下文）。
pub fn get_note_content_by_id(conn: &Connection, id: &str) -> AppResult<Option<String>> {
    conn.query_row(
        "SELECT content FROM notes_index WHERE id = ?1",
        params![id],
        |row| row.get::<_, String>(0),
    )
    .optional()
    .map_err(Into::into)
}

/// 拉取全部可用于重建向量索引的笔记内容。
/// 返回 (id, absolute_path, content)。
pub fn get_all_notes_for_embedding(conn: &Connection) -> AppResult<Vec<(String, String, String)>> {
    let mut stmt = conn
        .prepare(
            "SELECT id, absolute_path, content
             FROM notes_index
             WHERE length(trim(content)) > 0
             ORDER BY updated_at DESC",
        )?;

    let rows = stmt
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
            ))
        })?;

    let mut results = Vec::new();
    for row in rows {
        results.push(row?);
    }
    Ok(results)
}
