//! PDF 页面渲染模块
//!
//! 调用 PDFium 将 `PdfDocument` 中的单页渲染为 RGBA 位图，
//! 再使用 `webp` crate 编码为 WebP 格式，写入指定输出路径。
//!
//! 此模块的函数在专用渲染线程中被调用，因此可以安全地持有 `PdfDocument` 引用。

use std::path::Path;

use pdfium_render::prelude::*;
use webp::Encoder as WebpEncoder;

use crate::error::{AppError, AppResult};

/// 将 PDF 文档中的一页渲染为 WebP 文件。
///
/// # 参数
/// - `doc`         — 已打开的 PDF 文档引用
/// - `page_index`  — 页码（0-based，对应 PDFium 的 `u16`）
/// - `scale`       — 缩放因子（例如 1.0 = 96 dpi；1.5 = 144 dpi；2.0 = 192 dpi）
/// - `output_path` — 渲染结果写入的路径（需以 `.webp` 结尾）
///
/// # 返回值
/// `(width_px, height_px)`：渲染后图像的像素尺寸
pub fn render_page_from_doc(
    doc: &PdfDocument<'_>,
    page_index: u32,
    scale: f32,
    output_path: &Path,
) -> AppResult<(u32, u32)> {
    // -----------------------------------------------------------------------
    // 1. 获取页面句柄
    // -----------------------------------------------------------------------
    let page_index_u16 = u16::try_from(page_index)
        .map_err(|_| AppError::PdfRender(format!("页码 {page_index} 超出 u16 范围")))?;

    let page = doc
        .pages()
        .get(page_index_u16)
        .map_err(|e| AppError::PdfRender(format!("获取第 {page_index} 页失败: {e}")))?;

    // -----------------------------------------------------------------------
    // 2. 根据 scale 因子渲染为位图
    //    PDFium 页面尺寸单位为 pt（1/72 英寸），scale_page_by_factor 会自动将
    //    pt 转换为像素（1 pt × scale ≈ 1.333 × scale 像素，72 dpi 基准）。
    //    使用 set_reverse_byte_order(true) 可直接得到 RGB/RGBA，避免手动 BGR→RGB 转换。
    // -----------------------------------------------------------------------
    let config = PdfRenderConfig::new()
        .scale_page_by_factor(scale)
        .set_reverse_byte_order(true); // 渲染输出 RGBA 而非 BGRA

    let bitmap = page
        .render_with_config(&config)
        .map_err(|e| AppError::PdfRender(format!("PDFium 渲染失败: {e}")))?;

    let width_px = bitmap.width() as u32;
    let height_px = bitmap.height() as u32;

    // as_rgba_bytes() 已按格式规范化为标准 RGBA（每像素 4 字节）
    let rgba_bytes = bitmap.as_rgba_bytes();

    // -----------------------------------------------------------------------
    // 3. 编码为 WebP
    // -----------------------------------------------------------------------
    let encoder = WebpEncoder::from_rgba(&rgba_bytes, width_px, height_px);
    let webp_data = encoder.encode(85.0); // 85% 质量，兼顾清晰度与体积

    // -----------------------------------------------------------------------
    // 4. 写入磁盘
    // -----------------------------------------------------------------------
    if let Some(parent) = output_path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::write(output_path, &*webp_data)?;

    Ok((width_px, height_px))
}
