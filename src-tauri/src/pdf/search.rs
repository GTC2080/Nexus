//! PDF 全文搜索模块
//!
//! 在已打开的 PdfDocument 中进行跨页全文搜索，返回每个匹配项的页码及归一化高亮矩形。

use pdfium_render::prelude::*;
use serde::Serialize;

use crate::error::{AppError, AppResult};
use crate::pdf::text::{merge_rects, NormRect};

// ---------------------------------------------------------------------------
// 公开数据类型
// ---------------------------------------------------------------------------

/// 单条搜索匹配结果
#[derive(Debug, Clone, Serialize)]
pub struct SearchMatch {
    /// 匹配所在的页码（0-based）
    pub page: u32,
    /// 匹配文本的归一化包围盒列表（通常只有一个，但跨行时可能有多个）
    pub rects: Vec<NormRect>,
}

// ---------------------------------------------------------------------------
// 搜索实现
// ---------------------------------------------------------------------------

/// 在已打开的 PDF 文档中对所有页面进行大小写不敏感的全文搜索。
///
/// # 参数
/// - `doc`   — 已打开的 PDF 文档引用（在渲染线程中调用）
/// - `query` — 搜索字符串（非空）
///
/// # 返回
/// 所有匹配结果，按页码顺序排列。
pub fn search_in_doc(
    doc: &PdfDocument<'_>,
    query: &str,
) -> AppResult<Vec<SearchMatch>> {
    if query.is_empty() {
        return Ok(Vec::new());
    }

    let query_lower = query.to_lowercase();
    let query_len = query_lower.chars().count();

    let page_count = doc.pages().len();
    let mut results: Vec<SearchMatch> = Vec::new();

    for page_idx in 0..page_count {
        let page_matches = search_page(doc, page_idx as u32, &query_lower, query_len)?;
        results.extend(page_matches);
    }

    Ok(results)
}

/// 在单个页面中搜索，返回该页面的所有匹配项
fn search_page(
    doc: &PdfDocument<'_>,
    page_index: u32,
    query_lower: &str,
    query_char_len: usize,
) -> AppResult<Vec<SearchMatch>> {
    let page_index_u16 = u16::try_from(page_index)
        .map_err(|_| AppError::PdfEngine(format!("页码 {page_index} 超出 u16 范围")))?;

    let page = doc
        .pages()
        .get(page_index_u16)
        .map_err(|e| AppError::PdfEngine(format!("获取第 {page_index} 页失败: {e}")))?;

    let page_width = page.width().value;
    let page_height = page.height().value;

    if page_width <= 0.0 || page_height <= 0.0 {
        return Ok(Vec::new());
    }

    let text_page = match page.text() {
        Ok(tp) => tp,
        Err(_) => return Ok(Vec::new()),
    };

    // 获取页面完整文本（小写用于搜索）
    let full_text = text_page.all();
    let full_text_lower = full_text.to_lowercase();

    if full_text_lower.is_empty() {
        return Ok(Vec::new());
    }

    // 收集所有字符的 (unicode_char, NormRect)，顺序与 full_text 一致
    struct CharEntry {
        norm_rect: NormRect,
    }

    let mut char_entries: Vec<CharEntry> = Vec::new();
    for c in text_page.chars().iter() {
        if c.unicode_char().is_none() {
            continue;
        }

        let norm_rect = match c.tight_bounds() {
            Ok(bounds) => pdf_rect_to_norm(&bounds, page_width, page_height),
            Err(_) => {
                // 无法获取坐标的字符：用零矩形占位，保持与 full_text 的对应关系
                NormRect { x: 0.0, y: 0.0, w: 0.0, h: 0.0 }
            }
        };

        char_entries.push(CharEntry { norm_rect });
    }

    // 将 full_text 的字符序列与 char_entries 对应
    // full_text.chars() 与 char_entries 的顺序应一致（两者均按页面顺序）
    let text_chars: Vec<char> = full_text_lower.chars().collect();

    // 取两者长度的最小值，避免越界
    let paired_len = text_chars.len().min(char_entries.len());

    // 在小写文本中查找所有匹配位置（字符索引）
    let mut matches: Vec<SearchMatch> = Vec::new();
    let mut search_start = 0usize;

    // 将 query 也转为字符数组方便按字符索引搜索
    let query_chars: Vec<char> = query_lower.chars().collect();

    'outer: loop {
        if search_start + query_char_len > paired_len {
            break;
        }

        // 在 text_chars[search_start..] 中查找 query_chars
        let mut found_at: Option<usize> = None;
        'find: for i in search_start..=(paired_len.saturating_sub(query_char_len)) {
            let mut matched = true;
            for (qi, &qc) in query_chars.iter().enumerate() {
                if i + qi >= text_chars.len() || text_chars[i + qi] != qc {
                    matched = false;
                    break;
                }
            }
            if matched {
                found_at = Some(i);
                break 'find;
            }
        }

        let start_idx = match found_at {
            Some(idx) => idx,
            None => break 'outer,
        };

        let end_idx = start_idx + query_char_len; // exclusive

        // 收集匹配字符的矩形
        let match_rects: Vec<NormRect> = (start_idx..end_idx)
            .filter(|&i| i < char_entries.len())
            .map(|i| char_entries[i].norm_rect)
            .filter(|r| r.w > 0.0 && r.h > 0.0) // 忽略无效坐标的字符
            .collect();

        if let Some(merged) = merge_rects(&match_rects) {
            matches.push(SearchMatch {
                page: page_index,
                rects: vec![merged],
            });
        }

        // 移动搜索起点，允许重叠匹配（从下一个字符开始）
        search_start = start_idx + 1;
    }

    Ok(matches)
}

/// 将 PDFium 坐标（左下角原点，单位 pt）转换为归一化 NormRect（左上角原点，0-1）
fn pdf_rect_to_norm(bounds: &PdfRect, page_width: f32, page_height: f32) -> NormRect {
    let left = bounds.left().value;
    let top_pdf = bounds.top().value;
    let right = bounds.right().value;
    let bottom_pdf = bounds.bottom().value;

    let x = left / page_width;
    let y = 1.0 - top_pdf / page_height;
    let w = (right - left) / page_width;
    let h = (top_pdf - bottom_pdf) / page_height;

    NormRect {
        x: x.max(0.0),
        y: y.max(0.0),
        w: w.max(0.0),
        h: h.max(0.0),
    }
}
