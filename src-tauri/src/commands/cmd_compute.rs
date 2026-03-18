use regex::Regex;
use serde::Serialize;
use serde_json::Value;
use std::collections::HashSet;
use std::sync::OnceLock;

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
    if ["canvas"].contains(&lower.as_str()) {
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
