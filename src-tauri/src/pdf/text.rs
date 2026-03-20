//! PDF 文本提取模块
//!
//! 从 PdfDocument 中提取指定页面的文本内容及每个单词的归一化坐标信息。

use pdfium_render::prelude::*;
use serde::Serialize;

use crate::error::{AppError, AppResult};

// ---------------------------------------------------------------------------
// 公开数据类型
// ---------------------------------------------------------------------------

/// 归一化矩形，坐标范围 0.0–1.0，相对于页面尺寸
///
/// - `x`, `y`：左上角坐标（y=0 为页面顶部）
/// - `w`, `h`：宽度、高度
#[derive(Debug, Clone, Copy, Serialize)]
pub struct NormRect {
    pub x: f32,
    pub y: f32,
    pub w: f32,
    pub h: f32,
}

/// 单词信息：文本内容、在完整页面文本中的字节偏移量及归一化边框
#[derive(Debug, Clone, Serialize)]
pub struct WordInfo {
    pub word: String,
    /// 该单词在页面完整文本字符串中的起始字节偏移量（UTF-8）
    pub char_index: usize,
    pub rect: NormRect,
}

/// 单页文本数据
#[derive(Debug, Clone, Serialize)]
pub struct PageTextData {
    /// 页面完整文本
    pub text: String,
    /// 按单词拆分后的列表
    pub words: Vec<WordInfo>,
}

// ---------------------------------------------------------------------------
// 矩形合并工具
// ---------------------------------------------------------------------------

/// 将多个 `NormRect` 合并为一个包围盒。
///
/// 若输入为空则返回 `None`。
pub fn merge_rects(rects: &[NormRect]) -> Option<NormRect> {
    if rects.is_empty() {
        return None;
    }

    let mut min_x = f32::MAX;
    let mut min_y = f32::MAX;
    let mut max_x = f32::MIN;
    let mut max_y = f32::MIN;

    for r in rects {
        if r.x < min_x {
            min_x = r.x;
        }
        if r.y < min_y {
            min_y = r.y;
        }
        let rx = r.x + r.w;
        let ry = r.y + r.h;
        if rx > max_x {
            max_x = rx;
        }
        if ry > max_y {
            max_y = ry;
        }
    }

    Some(NormRect {
        x: min_x,
        y: min_y,
        w: max_x - min_x,
        h: max_y - min_y,
    })
}

// ---------------------------------------------------------------------------
// 核心提取函数
// ---------------------------------------------------------------------------

/// 将 PDFium 坐标（左下角原点，单位 pt）转换为归一化 NormRect（左上角原点，0-1）
fn pdf_rect_to_norm(
    bounds: &PdfRect,
    page_width: f32,
    page_height: f32,
) -> NormRect {
    let left = bounds.left().value;
    let top_pdf = bounds.top().value;
    let right = bounds.right().value;
    let bottom_pdf = bounds.bottom().value;

    let x = left / page_width;
    // 翻转 Y 轴：PDFium y=0 在底部，我们需要 y=0 在顶部
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

/// 从已打开的 `PdfDocument` 中提取指定页面的文本和单词坐标。
///
/// # 参数
/// - `doc`        — 已打开的 PDF 文档引用（在渲染线程中调用）
/// - `page_index` — 页码，0-based
///
/// # 坐标系
/// PDFium 坐标原点在左下角；本函数将 Y 轴翻转为左上角原点，
/// 并将所有坐标归一化到 0.0–1.0 范围。
pub fn extract_page_text_from_doc(
    doc: &PdfDocument<'_>,
    page_index: u32,
) -> AppResult<PageTextData> {
    // -----------------------------------------------------------------------
    // 1. 获取页面句柄
    // -----------------------------------------------------------------------
    let page_index_u16 = u16::try_from(page_index)
        .map_err(|_| AppError::PdfEngine(format!("页码 {page_index} 超出 u16 范围")))?;

    let page = doc
        .pages()
        .get(page_index_u16)
        .map_err(|e| AppError::PdfEngine(format!("获取第 {page_index} 页失败: {e}")))?;

    // -----------------------------------------------------------------------
    // 2. 获取页面尺寸（单位：PDF pt）
    // -----------------------------------------------------------------------
    let page_width = page.width().value;
    let page_height = page.height().value;

    if page_width <= 0.0 || page_height <= 0.0 {
        return Ok(PageTextData {
            text: String::new(),
            words: Vec::new(),
        });
    }

    // -----------------------------------------------------------------------
    // 3. 获取文本页对象并提取完整文本
    // -----------------------------------------------------------------------
    let text_page = page
        .text()
        .map_err(|e| AppError::PdfEngine(format!("获取第 {page_index} 页文本失败: {e}")))?;

    let full_text = text_page.all();

    // -----------------------------------------------------------------------
    // 4. 逐字符提取 tight_bounds，建立有序 (char, NormRect) 列表
    //    只收集有有效边界框的字符，忽略无法获取坐标的字符
    // -----------------------------------------------------------------------
    struct CharEntry {
        ch: char,
        norm_rect: NormRect,
    }

    let mut char_entries: Vec<CharEntry> = Vec::new();

    for c in text_page.chars().iter() {
        let ch = match c.unicode_char() {
            Some(ch) => ch,
            None => continue,
        };

        let norm_rect = match c.tight_bounds() {
            Ok(bounds) => pdf_rect_to_norm(&bounds, page_width, page_height),
            Err(_) => continue,
        };

        char_entries.push(CharEntry { ch, norm_rect });
    }

    // -----------------------------------------------------------------------
    // 5. 将字符序列与 full_text 的字节偏移量对应，按空白符拆分为单词
    //    full_text 来自 text_page.all()，与 chars().iter() 的字符顺序一致
    // -----------------------------------------------------------------------
    let mut words: Vec<WordInfo> = Vec::new();
    let mut in_word = false;
    let mut current_word_chars: Vec<char> = Vec::new();
    let mut current_word_byte_start: usize = 0;
    let mut current_word_rects: Vec<NormRect> = Vec::new();

    // zip full_text 的 char_indices 与 char_entries
    // 两者长度可能不同（char_entries 跳过了部分字符），取 min
    for ((byte_offset, _), entry) in full_text.char_indices().zip(char_entries.iter()) {
        let ch = entry.ch;
        if ch.is_whitespace() {
            if in_word {
                if let Some(merged) = merge_rects(&current_word_rects) {
                    words.push(WordInfo {
                        word: current_word_chars.iter().collect(),
                        char_index: current_word_byte_start,
                        rect: merged,
                    });
                }
                in_word = false;
                current_word_chars.clear();
                current_word_rects.clear();
            }
        } else {
            if !in_word {
                in_word = true;
                current_word_byte_start = byte_offset;
            }
            current_word_chars.push(ch);
            current_word_rects.push(entry.norm_rect);
        }
    }

    // 处理末尾未结束的单词
    if in_word {
        if let Some(merged) = merge_rects(&current_word_rects) {
            words.push(WordInfo {
                word: current_word_chars.iter().collect(),
                char_index: current_word_byte_start,
                rect: merged,
            });
        }
    }

    Ok(PageTextData {
        text: full_text,
        words,
    })
}
