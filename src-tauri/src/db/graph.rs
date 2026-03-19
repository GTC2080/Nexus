use std::collections::{HashMap, HashSet};

use rusqlite::Connection;

use crate::models::{EnrichedGraphData, GraphData, GraphLink, GraphNode};
use crate::AppResult;

/// 构建全局关系图谱数据。
///
/// 四种连线来源（按优先级去重）：
/// 1. Wikilink (`[[...]]`) -- kind = "link"
/// 2. 标签共现（两篇笔记共享同一标签） -- kind = "tag"
/// 3. 文件名相似度（Jaccard >= 0.25 且共享 >= 2 个词元） -- kind = "similarity"
/// 4. 同文件夹（两篇笔记在同一目录下） -- kind = "folder"
pub fn get_graph_data(conn: &Connection) -> AppResult<GraphData> {
    // ── 第一步：拉取所有真实笔记节点 ──
    let mut stmt = conn
        .prepare("SELECT id, filename FROM notes_index")?;

    let rows = stmt
        .query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })?;

    let mut nodes: Vec<GraphNode> = Vec::with_capacity(128);
    let mut name_to_id: HashMap<String, String> = HashMap::with_capacity(128);
    let mut node_ids: HashSet<String> = HashSet::with_capacity(128);

    for row in rows {
        let (id, filename) = row?;
        name_to_id.insert(filename.clone(), id.clone());
        node_ids.insert(id.clone());
        nodes.push(GraphNode {
            id,
            name: filename,
            ghost: false,
        });
    }

    let mut links: Vec<GraphLink> = Vec::with_capacity(256);
    let mut pair_set: HashSet<(String, String)> = HashSet::with_capacity(256);

    // ── 第二步：Wikilink 连线 ──
    let mut link_stmt = conn
        .prepare("SELECT source_id, target_name FROM note_links")?;

    let link_rows = link_stmt
        .query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })?;

    let mut ghost_counter: u32 = 0;

    for row in link_rows {
        let (source_id, target_name) = row?;

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
        )?;

    let tag_rows = tag_stmt
        .query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })?;

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

    // ── 第四步：文件名相似度连线（跨文件夹关联的核心） ──
    // 对每个真实节点提取文件名词元，Jaccard >= 0.25 且共享 >= 2 词元则建立连线
    let real_nodes: Vec<(usize, HashSet<String>)> = nodes
        .iter()
        .enumerate()
        .filter(|(_, n)| !n.ghost)
        .map(|(i, n)| (i, tokenize_filename(&n.name)))
        .filter(|(_, tokens)| !tokens.is_empty())
        .collect();

    for i in 0..real_nodes.len() {
        for j in (i + 1)..real_nodes.len() {
            let (idx_a, tokens_a) = &real_nodes[i];
            let (idx_b, tokens_b) = &real_nodes[j];

            let shared: usize = tokens_a.intersection(tokens_b).count();
            if shared < 2 {
                continue;
            }
            let union: usize = tokens_a.union(tokens_b).count();
            let jaccard = shared as f64 / union as f64;
            if jaccard < 0.25 {
                continue;
            }

            let id_a = &nodes[*idx_a].id;
            let id_b = &nodes[*idx_b].id;
            let pair = ordered_pair(id_a, id_b);
            if pair_set.insert(pair) {
                links.push(GraphLink {
                    source: id_a.clone(),
                    target: id_b.clone(),
                    kind: "similarity".into(),
                });
            }
        }
    }

    // ── 第五步：同文件夹连线（补充） ──
    let mut folder_groups: HashMap<String, Vec<String>> = HashMap::new();
    for node in &nodes {
        if node.ghost {
            continue;
        }
        let folder = node
            .id
            .rfind(['/', '\\'])
            .map(|pos| &node.id[..pos])
            .unwrap_or("")
            .to_string();
        folder_groups.entry(folder).or_default().push(node.id.clone());
    }

    for (_, ids) in &mut folder_groups {
        if ids.len() < 2 {
            continue;
        }
        if ids.len() <= 15 {
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
        } else {
            ids.sort();
            for pair in ids.windows(2) {
                let p = ordered_pair(&pair[0], &pair[1]);
                if pair_set.insert(p) {
                    links.push(GraphLink {
                        source: pair[0].clone(),
                        target: pair[1].clone(),
                        kind: "folder".into(),
                    });
                }
            }
        }
    }

    Ok(GraphData { nodes, links })
}

/// 构建增强版图谱数据，包含预计算的邻接索引
pub fn get_enriched_graph_data(conn: &Connection) -> AppResult<EnrichedGraphData> {
    let GraphData { nodes, links } = get_graph_data(conn)?;

    let mut neighbors: HashMap<String, Vec<String>> = HashMap::with_capacity(nodes.len());
    let mut link_pairs: Vec<String> = Vec::with_capacity(links.len() * 2);

    for link in &links {
        neighbors
            .entry(link.source.clone())
            .or_default()
            .push(link.target.clone());
        neighbors
            .entry(link.target.clone())
            .or_default()
            .push(link.source.clone());

        let mut pair = String::with_capacity(link.source.len() + link.target.len() + 2);
        pair.push_str(&link.source);
        pair.push_str("->");
        pair.push_str(&link.target);
        link_pairs.push(pair);

        let mut pair_rev = String::with_capacity(link.target.len() + link.source.len() + 2);
        pair_rev.push_str(&link.target);
        pair_rev.push_str("->");
        pair_rev.push_str(&link.source);
        link_pairs.push(pair_rev);
    }

    Ok(EnrichedGraphData {
        nodes,
        links,
        neighbors,
        link_pairs,
    })
}

/// 从文件名提取词元集合（去扩展名，按空格/下划线/连字符分词，小写化，过滤过短词）
fn tokenize_filename(name: &str) -> HashSet<String> {
    let stem = name.rsplit_once('.').map(|(n, _)| n).unwrap_or(name);
    stem.split(|c: char| c.is_whitespace() || c == '_' || c == '-')
        .filter(|s| s.len() >= 2)
        .map(|s| s.to_ascii_lowercase())
        .collect()
}

fn ordered_pair(a: &str, b: &str) -> (String, String) {
    if a < b {
        (a.to_string(), b.to_string())
    } else {
        (b.to_string(), a.to_string())
    }
}
