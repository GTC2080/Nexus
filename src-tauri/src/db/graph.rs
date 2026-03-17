use std::collections::{HashMap, HashSet};

use rusqlite::Connection;

use crate::models::{GraphData, GraphLink, GraphNode};

/// 构建全局关系图谱数据。
///
/// # 逻辑
/// 1. 从 notes_index 拉取所有笔记作为真实节点
/// 2. 建立 filename -> id 的 HashMap，用于将 note_links.target_name 映射回节点 id
/// 3. 遍历 note_links，对每条连线：
///    - 如果 target_name 能映射到已有笔记 -> 直接建立连线
///    - 如果 target_name 无对应笔记 -> 创建幽灵节点，再建立连线
/// 4. 返回完整的 GraphData { nodes, links }
pub fn get_graph_data(conn: &Connection) -> Result<GraphData, String> {
    // 第一步：拉取所有真实笔记节点
    let mut stmt = conn
        .prepare("SELECT id, filename FROM notes_index")
        .map_err(|e| format!("准备图谱节点查询失败: {}", e))?;

    let rows = stmt
        .query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(|e| format!("执行图谱节点查询失败: {}", e))?;

    let mut nodes: Vec<GraphNode> = Vec::new();
    // filename -> id 映射，用于将 target_name 解析为节点 id
    let mut name_to_id: HashMap<String, String> = HashMap::new();
    // 已存在的节点 id 集合，用于快速判重
    let mut node_ids: HashSet<String> = HashSet::new();

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
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
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
