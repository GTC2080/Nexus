use std::collections::{HashMap, HashSet};

use rusqlite::Connection;

use crate::models::{GraphData, GraphLink, GraphNode};

/// 构建全局关系图谱数据。
///
/// 三种连线来源：
/// 1. Wikilink (`[[...]]`) — kind = "link"
/// 2. 标签共现（两篇笔记共享同一标签） — kind = "tag"
/// 3. 同文件夹（两篇笔记在同一目录下） — kind = "folder"
pub fn get_graph_data(conn: &Connection) -> Result<GraphData, String> {
    // ── 第一步：拉取所有真实笔记节点 ──
    let mut stmt = conn
        .prepare("SELECT id, filename FROM notes_index")
        .map_err(|e| format!("准备图谱节点查询失败: {}", e))?;

    let rows = stmt
        .query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(|e| format!("执行图谱节点查询失败: {}", e))?;

    let mut nodes: Vec<GraphNode> = Vec::new();
    let mut name_to_id: HashMap<String, String> = HashMap::new();
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

    let mut links: Vec<GraphLink> = Vec::new();
    // 已建立连线的节点对集合，用于去重（低 id 在前）
    let mut pair_set: HashSet<(String, String)> = HashSet::new();

    // ── 第二步：Wikilink 连线 ──
    let mut link_stmt = conn
        .prepare("SELECT source_id, target_name FROM note_links")
        .map_err(|e| format!("准备图谱连线查询失败: {}", e))?;

    let link_rows = link_stmt
        .query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(|e| format!("执行图谱连线查询失败: {}", e))?;

    let mut ghost_counter: u32 = 0;

    for row in link_rows {
        let (source_id, target_name) =
            row.map_err(|e| format!("读取图谱连线失败: {}", e))?;

        if !node_ids.contains(&source_id) {
            continue;
        }

        let target_id = if let Some(existing_id) = name_to_id.get(&target_name) {
            existing_id.clone()
        } else {
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

        let pair = ordered_pair(&source_id, &target_id);
        pair_set.insert(pair);
        links.push(GraphLink {
            source: source_id,
            target: target_id,
            kind: "link".into(),
        });
    }

    // ── 第三步：标签共现连线 ──
    let mut tag_stmt = conn
        .prepare(
            "SELECT DISTINCT t1.note_id, t2.note_id
             FROM note_tags t1
             INNER JOIN note_tags t2
               ON t1.tag_name = t2.tag_name AND t1.note_id < t2.note_id",
        )
        .map_err(|e| format!("准备标签关联查询失败: {}", e))?;

    let tag_rows = tag_stmt
        .query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(|e| format!("执行标签关联查询失败: {}", e))?;

    for row in tag_rows.flatten() {
        let (a, b) = row;
        if !node_ids.contains(&a) || !node_ids.contains(&b) {
            continue;
        }
        let pair = ordered_pair(&a, &b);
        if pair_set.insert(pair) {
            links.push(GraphLink {
                source: a,
                target: b,
                kind: "tag".into(),
            });
        }
    }

    // ── 第四步：同文件夹连线 ──
    let mut folder_groups: HashMap<String, Vec<String>> = HashMap::new();
    for node in &nodes {
        if node.ghost {
            continue;
        }
        let folder = node
            .id
            .rsplit_once('/')
            .map(|(f, _)| f)
            .unwrap_or("")
            .to_string();
        folder_groups.entry(folder).or_default().push(node.id.clone());
    }

    for (_, ids) in &folder_groups {
        // 文件夹过大时跳过，避免产生 O(n²) 连线
        if ids.len() < 2 || ids.len() > 12 {
            continue;
        }
        for i in 0..ids.len() {
            for j in (i + 1)..ids.len() {
                let pair = ordered_pair(&ids[i], &ids[j]);
                if pair_set.insert(pair) {
                    links.push(GraphLink {
                        source: ids[i].clone(),
                        target: ids[j].clone(),
                        kind: "folder".into(),
                    });
                }
            }
        }
    }

    Ok(GraphData { nodes, links })
}

/// 生成有序对，确保 (a,b) 和 (b,a) 映射到同一个 key
fn ordered_pair(a: &str, b: &str) -> (String, String) {
    if a < b {
        (a.to_string(), b.to_string())
    } else {
        (b.to_string(), a.to_string())
    }
}
