use rusqlite::{params, Connection, OptionalExtension};

use crate::models::NoteInfo;

use super::common::ext_from_path;

/// 将向量化结果（Vec<f32>）写入指定笔记的 embedding 字段。
///
/// # Vec<f32> -> BLOB 序列化方案
/// 直接将 f32 数组的内存表示（每个 f32 占 4 字节，小端序）
/// 拷贝为连续的字节切片存入 SQLite BLOB。
/// 这种方式零拷贝、零开销，比 JSON 序列化快几个数量级。
///
/// 反序列化时只需将 BLOB 按 4 字节对齐重新解释为 &[f32] 即可。
pub fn update_note_embedding(conn: &Connection, id: &str, embedding: &[f32]) -> Result<(), String> {
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
/// # BLOB -> Vec<f32> 反序列化
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
