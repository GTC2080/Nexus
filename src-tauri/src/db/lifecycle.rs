use rusqlite::{params, Connection};

use super::schema::{delete_fts_row, fts_available};

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
    )
    .map_err(|e| format!("重命名笔记索引失败 [{}->{}]: {}", old_id, new_id, e))?;

    conn.execute(
        "UPDATE note_links SET source_id = ?1 WHERE source_id = ?2",
        params![new_id, old_id],
    )
    .map_err(|e| format!("更新 note_links source_id 失败: {}", e))?;

    conn.execute(
        "UPDATE note_tags SET note_id = ?1 WHERE note_id = ?2",
        params![new_id, old_id],
    )
    .map_err(|e| format!("更新 note_tags note_id 失败: {}", e))?;

    if fts_available(conn) {
        conn.execute(
            "UPDATE notes_fts SET id = ?1 WHERE id = ?2",
            params![new_id, old_id],
        )
        .map_err(|e| format!("更新 notes_fts id 失败: {}", e))?;
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
        let suffix = old_id_normalized
            .strip_prefix(&old_prefix.replace('\\', "/"))
            .unwrap_or(&old_id_normalized);
        let new_id = format!("{}{}", new_prefix, suffix);
        let new_path = format!("{}/{}", vault_normalized, new_id);
        rename_note_id(conn, old_id, &new_id, &new_path)?;
    }

    Ok(())
}
