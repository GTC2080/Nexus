use rusqlite::{params, Connection};

use crate::AppResult;

use super::schema::{delete_fts_row, fts_available};

/// 删除单篇笔记及其关联索引数据（链接/标签）。
pub fn delete_note_by_id(conn: &Connection, id: &str) -> AppResult<()> {
    delete_fts_row(conn, id)?;
    conn.execute("DELETE FROM note_links WHERE source_id = ?1", params![id])?;
    conn.execute("DELETE FROM note_tags WHERE note_id = ?1", params![id])?;
    conn.execute("DELETE FROM notes_index WHERE id = ?1", params![id])?;
    Ok(())
}

/// 删除目录下所有笔记索引数据（包含子目录）。
pub fn delete_notes_by_prefix(conn: &Connection, prefix: &str) -> AppResult<()> {
    let slash = format!("{}/%", prefix);
    let backslash = format!("{}\\%", prefix);

    let mut stmt = conn
        .prepare(
            "SELECT id FROM notes_index
             WHERE id = ?1 OR id LIKE ?2 OR id LIKE ?3",
        )?;

    let rows = stmt
        .query_map(params![prefix, slash, backslash], |row| row.get::<_, String>(0))?;

    let mut ids = Vec::new();
    for row in rows {
        ids.push(row?);
    }

    for id in &ids {
        delete_note_by_id(conn, id)?;
    }

    Ok(())
}

/// 重命名单个笔记的 id（相对路径）以及绝对路径，同时更新关联的链接和标签表。
pub fn rename_note_id(conn: &Connection, old_id: &str, new_id: &str, new_path: &str) -> AppResult<()> {
    conn.execute(
        "UPDATE notes_index SET id = ?1, absolute_path = ?2 WHERE id = ?3",
        params![new_id, new_path, old_id],
    )?;

    conn.execute(
        "UPDATE note_links SET source_id = ?1 WHERE source_id = ?2",
        params![new_id, old_id],
    )?;

    conn.execute(
        "UPDATE note_tags SET note_id = ?1 WHERE note_id = ?2",
        params![new_id, old_id],
    )?;

    if fts_available(conn) {
        conn.execute(
            "UPDATE notes_fts SET id = ?1 WHERE id = ?2",
            params![new_id, old_id],
        )?;
    }

    Ok(())
}

/// 批量重命名某前缀下所有笔记的 id（用于移动文件夹时）。
pub fn rename_notes_by_prefix(
    conn: &Connection,
    old_prefix: &str,
    new_prefix: &str,
    vault_path: &str,
) -> AppResult<()> {
    let slash = format!("{}/%", old_prefix);
    let backslash = format!("{}\\%", old_prefix);

    let mut stmt = conn
        .prepare("SELECT id, absolute_path FROM notes_index WHERE id = ?1 OR id LIKE ?2 OR id LIKE ?3")?;

    let rows = stmt
        .query_map(params![old_prefix, slash, backslash], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })?;

    let mut entries = Vec::new();
    for row in rows {
        entries.push(row?);
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
