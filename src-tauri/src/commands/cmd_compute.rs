use regex::Regex;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{HashMap, HashSet};
use std::sync::OnceLock;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TimelineEventDto {
    pub id: String,
    pub date: String,
    pub title: String,
    pub description: String,
    pub duration_minutes: u32,
    pub folders: Vec<String>,
    pub linked_note_id: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TimelineIssueDto {
    pub node_id: String,
    pub issue: String,
    pub suggestion: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TimelineParseResultDto {
    pub events: Vec<TimelineEventDto>,
    pub issues: Vec<TimelineIssueDto>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TruthExpAwardDto {
    pub attr: String,
    pub amount: i32,
    pub reason: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TruthDiffResultDto {
    pub awards: Vec<TruthExpAwardDto>,
}

fn code_block_regex() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"```(\w+)").expect("代码块正则编译失败"))
}

fn route_by_extension(ext: &str) -> &'static str {
    let lower = ext.to_ascii_lowercase();
    if ["jdx", "csv"].contains(&lower.as_str()) {
        return "science";
    }
    if [
        "py", "js", "ts", "tsx", "jsx", "rs", "go", "c", "cpp", "java",
    ]
    .contains(&lower.as_str())
    {
        return "engineering";
    }
    if ["timeline", "canvas"].contains(&lower.as_str()) {
        return "creation";
    }
    if ["dashboard", "base"].contains(&lower.as_str()) {
        return "finance";
    }
    "creation"
}

fn route_by_code_language(lang: &str) -> Option<&'static str> {
    let lower = lang.to_ascii_lowercase();
    if [
        "python",
        "py",
        "rust",
        "go",
        "javascript",
        "js",
        "typescript",
        "ts",
        "java",
        "c",
        "cpp",
    ]
    .contains(&lower.as_str())
    {
        return Some("engineering");
    }
    if ["smiles", "chemical", "latex", "math"].contains(&lower.as_str()) {
        return Some("science");
    }
    if ["sql", "r", "stata"].contains(&lower.as_str()) {
        return Some("finance");
    }
    None
}

fn extract_code_languages(content: &str) -> HashSet<String> {
    code_block_regex()
        .captures_iter(content)
        .filter_map(|cap| cap.get(1).map(|m| m.as_str().to_ascii_lowercase()))
        .collect()
}

fn normalize_folder_path(raw: &str) -> String {
    let normalized = raw
        .trim()
        .replace('\\', "/")
        .trim_matches('/')
        .to_string();
    if normalized.is_empty() {
        "根目录".to_string()
    } else {
        normalized
    }
}

fn parse_duration_minutes(item: &Value) -> Option<u32> {
    if let Some(value) = item.get("durationMinutes") {
        if let Some(raw) = value.as_f64() {
            if raw.is_finite() {
                return Some(raw.max(0.0).round() as u32);
            }
        }
        if let Some(raw) = value.as_str() {
            if let Ok(parsed) = raw.trim().parse::<f64>() {
                if parsed.is_finite() {
                    return Some(parsed.max(0.0).round() as u32);
                }
            }
        }
    }
    None
}

fn parse_folders(item: &Value, linked_note_id: &Option<String>) -> Vec<String> {
    let mut folders: Vec<String> = item
        .get("folders")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|v| v.as_str())
                .filter(|v| !v.trim().is_empty())
                .map(normalize_folder_path)
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();

    if folders.is_empty() {
        if let Some(single) = item.get("folder").and_then(|v| v.as_str()) {
            folders = single
                .split(',')
                .filter(|v| !v.trim().is_empty())
                .map(normalize_folder_path)
                .collect::<Vec<_>>();
        }
    }

    if folders.is_empty() {
        if let Some(linked) = linked_note_id {
            let normalized = linked.replace('\\', "/");
            if let Some(index) = normalized.rfind('/') {
                folders.push(normalize_folder_path(&normalized[..index]));
            } else {
                folders.push("根目录".to_string());
            }
        }
    }

    let mut deduped = Vec::new();
    let mut seen = HashSet::new();
    for folder in folders {
        let normalized = normalize_folder_path(&folder);
        if seen.insert(normalized.clone()) {
            deduped.push(normalized);
        }
    }
    deduped
}

#[tauri::command]
pub fn parse_timeline_content(content: String) -> Result<TimelineParseResultDto, String> {
    if content.trim().is_empty() {
        return Ok(TimelineParseResultDto {
            events: Vec::new(),
            issues: Vec::new(),
        });
    }

    let value: Value = match serde_json::from_str(&content) {
        Ok(v) => v,
        Err(_) => {
            return Ok(TimelineParseResultDto {
                events: Vec::new(),
                issues: vec![TimelineIssueDto {
                    node_id: String::new(),
                    issue: "时间轴文件不是有效 JSON，已回退为空时间轴。".to_string(),
                    suggestion: "请修复 JSON 结构，或在编辑器内重新创建事件。".to_string(),
                }],
            });
        }
    };

    let Some(raw_events) = value.get("events").and_then(|v| v.as_array()) else {
        return Ok(TimelineParseResultDto {
            events: Vec::new(),
            issues: vec![TimelineIssueDto {
                node_id: String::new(),
                issue: "时间轴缺少 events 数组，已回退为空时间轴。".to_string(),
                suggestion: "请确保结构为 {\"events\": [...]}。".to_string(),
            }],
        });
    };

    let mut events = Vec::new();
    let mut issues = Vec::new();
    let mut id_counter: HashMap<String, u32> = HashMap::new();

    for (idx, item) in raw_events.iter().enumerate() {
        if !item.is_object() {
            issues.push(TimelineIssueDto {
                node_id: String::new(),
                issue: format!("第 {} 个事件不是对象，已跳过。", idx + 1),
                suggestion: "每个事件都应是 JSON 对象。".to_string(),
            });
            continue;
        }

        let mut id = item
            .get("id")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .trim()
            .to_string();
        let date = item
            .get("date")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .trim()
            .to_string();
        let mut title = item
            .get("title")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .trim()
            .to_string();
        let description = item
            .get("description")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let linked_note_id = item
            .get("linkedNoteId")
            .and_then(|v| v.as_str())
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty());
        let duration_minutes = parse_duration_minutes(item).unwrap_or(0);
        let folders = parse_folders(item, &linked_note_id);

        if id.is_empty() {
            id = format!("event-{}", idx + 1);
        }
        if title.is_empty() {
            title = format!("学习记录 {}", idx + 1);
            issues.push(TimelineIssueDto {
                node_id: id.clone(),
                issue: "学习主题为空，已自动填充默认标题。".to_string(),
                suggestion: "建议补充更具体的学习主题（如章节、反应类型、实验名）。".to_string(),
            });
        }
        if date.is_empty() {
            issues.push(TimelineIssueDto {
                node_id: id.clone(),
                issue: "学习日期为空。".to_string(),
                suggestion: "建议填写日期，便于后续统计学习节奏。".to_string(),
            });
        }
        if duration_minutes == 0 {
            issues.push(TimelineIssueDto {
                node_id: id.clone(),
                issue: "学习时长为 0 分钟。".to_string(),
                suggestion: "建议填写本次实际学习时长（分钟）。".to_string(),
            });
        }
        if folders.is_empty() {
            issues.push(TimelineIssueDto {
                node_id: id.clone(),
                issue: "未记录学习文件夹。".to_string(),
                suggestion: "建议至少填写 1 个学习来源文件夹。".to_string(),
            });
        }

        let count = id_counter.entry(id.clone()).or_insert(0);
        *count += 1;
        if *count > 1 {
            let deduped = format!("{}-{}", id, count);
            issues.push(TimelineIssueDto {
                node_id: id.clone(),
                issue: "检测到重复事件 id，已自动重命名。".to_string(),
                suggestion: format!("建议将重复 id 分别改为唯一值（例如 {}）。", deduped),
            });
            id = deduped;
        }

        events.push(TimelineEventDto {
            id,
            date,
            title,
            description,
            duration_minutes,
            folders,
            linked_note_id,
        });
    }

    Ok(TimelineParseResultDto { events, issues })
}

#[tauri::command]
pub fn compute_truth_diff(
    prev_content: String,
    curr_content: String,
    file_extension: String,
) -> Result<TruthDiffResultDto, String> {
    const EXP_PER_100_CHARS: i32 = 2;
    const EXP_PER_CANVAS_NODE: i32 = 5;
    const EXP_PER_CODE_BLOCK: i32 = 8;

    if prev_content.is_empty() || curr_content.is_empty() {
        return Ok(TruthDiffResultDto { awards: Vec::new() });
    }

    let mut awards = Vec::new();
    let delta = curr_content.len() as i32 - prev_content.len() as i32;
    if delta > 10 {
        let char_exp = ((delta as f64 / 100.0) * EXP_PER_100_CHARS as f64).floor() as i32;
        if char_exp > 0 {
            awards.push(TruthExpAwardDto {
                attr: route_by_extension(&file_extension).to_string(),
                amount: char_exp,
                reason: "文本净增量经验".to_string(),
            });
        }
    }

    let new_blocks = extract_code_languages(&curr_content);
    let old_blocks = extract_code_languages(&prev_content);
    for lang in new_blocks.difference(&old_blocks) {
        if let Some(attr) = route_by_code_language(lang) {
            awards.push(TruthExpAwardDto {
                attr: attr.to_string(),
                amount: EXP_PER_CODE_BLOCK,
                reason: format!("新增代码块语言: {}", lang),
            });
        }
    }

    if file_extension.eq_ignore_ascii_case("canvas") {
        let prev_nodes = serde_json::from_str::<Value>(&prev_content)
            .ok()
            .and_then(|v| v.get("nodes").and_then(|n| n.as_array().map(|a| a.len())))
            .unwrap_or(0);
        let curr_nodes = serde_json::from_str::<Value>(&curr_content)
            .ok()
            .and_then(|v| v.get("nodes").and_then(|n| n.as_array().map(|a| a.len())))
            .unwrap_or(0);
        if curr_nodes > prev_nodes {
            awards.push(TruthExpAwardDto {
                attr: "creation".to_string(),
                amount: (curr_nodes - prev_nodes) as i32 * EXP_PER_CANVAS_NODE,
                reason: "新增画布节点".to_string(),
            });
        }
    }

    Ok(TruthDiffResultDto { awards })
}
