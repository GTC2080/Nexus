//! PDF 文档生命周期命令：打开 / 关闭 / 渲染页面 / 批注持久化

use std::path::{Path, PathBuf};

use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine as _};
use serde::Serialize;
use tauri::State;
use tokio::sync::oneshot;

use crate::error::{AppError, AppResult};
use crate::pdf::annotations::PdfAnnotation;
use crate::pdf::engine::{make_doc_id, LoadedPdf, PdfCommand, PdfMeta, PdfState};
use crate::pdf::search::SearchMatch;
use crate::pdf::text::PageTextData;

// ---------------------------------------------------------------------------
// 辅助：向渲染线程发送命令并等待结果
// ---------------------------------------------------------------------------

async fn send_pdf_cmd<T: Send + 'static>(
    state: &PdfState,
    build_cmd: impl FnOnce(oneshot::Sender<Result<T, AppError>>) -> PdfCommand,
) -> AppResult<T> {
    let (tx, rx) = oneshot::channel();
    let cmd = build_cmd(tx);

    state
        .cmd_tx
        .send(cmd)
        .map_err(|_| AppError::PdfEngine("PDF 渲染线程已退出".into()))?;

    rx.await
        .map_err(|_| AppError::PdfEngine("PDF 渲染线程未返回结果".into()))?
}

// ---------------------------------------------------------------------------
// Tauri 命令
// ---------------------------------------------------------------------------

/// 打开 PDF 文件，返回文档元数据
#[tauri::command]
pub async fn open_pdf(
    file_path: String,
    state: State<'_, PdfState>,
) -> AppResult<PdfMeta> {
    // 校验文件存在
    let p = Path::new(&file_path);
    if !p.exists() {
        return Err(AppError::PdfEngine(format!("文件不存在: {file_path}")));
    }
    if !p.is_file() {
        return Err(AppError::PdfEngine(format!("路径不是文件: {file_path}")));
    }

    let doc_id = make_doc_id(&file_path);

    let meta = send_pdf_cmd(&state, |reply| PdfCommand::Open {
        path: file_path.clone(),
        doc_id: doc_id.clone(),
        reply,
    })
    .await?;

    // 在共享状态中记录精简信息
    {
        let mut docs = state
            .documents
            .lock()
            .map_err(|_| AppError::Lock)?;
        docs.insert(
            doc_id.clone(),
            LoadedPdf {
                path: file_path,
                page_count: meta.page_count,
                page_dimensions: meta.page_dimensions.clone(),
            },
        );
    }

    Ok(meta)
}

/// 关闭已打开的 PDF 文档
#[tauri::command]
pub async fn close_pdf(
    doc_id: String,
    state: State<'_, PdfState>,
) -> AppResult<()> {
    send_pdf_cmd(&state, |reply| PdfCommand::Close {
        doc_id: doc_id.clone(),
        reply,
    })
    .await?;

    // 从共享状态中移除
    {
        let mut docs = state
            .documents
            .lock()
            .map_err(|_| AppError::Lock)?;
        docs.remove(&doc_id);
    }

    // 通过 RenderCache 清理该文档的所有已渲染缓存文件
    {
        let mut cache = state
            .render_cache
            .lock()
            .map_err(|_| AppError::Lock)?;
        cache.remove_doc(&doc_id);
    }

    Ok(())
}

// ---------------------------------------------------------------------------
// 渲染结果
// ---------------------------------------------------------------------------

/// 渲染单页后返回给前端的结构体
#[derive(Debug, Serialize)]
pub struct RenderResult {
    /// 渲染后 WebP 文件的绝对路径，前端需通过 convertFileSrc() 转为可用 URL
    pub file_path: String,
    /// 兜底用内联图片，避免 WebView 侧本地文件协议或 scope 问题导致无法显示
    pub data_url: Option<String>,
    pub width: u32,
    pub height: u32,
}

// ---------------------------------------------------------------------------
// render_pdf_page
// ---------------------------------------------------------------------------

/// 渲染 PDF 指定页面，返回 WebP 图片的 asset URL 及尺寸
#[tauri::command]
pub async fn render_pdf_page(
    doc_id: String,
    page_index: u32,
    scale: f32,
    state: State<'_, PdfState>,
) -> AppResult<RenderResult> {
    // 生成缓存键：{doc_id}-p{page}-s{scale_x100}
    // 将 scale 乘以 100 取整，避免浮点数在文件名中出现小数点
    let scale_key = (scale * 100.0).round() as u32;
    let cache_key = format!("{doc_id}-p{page_index}-s{scale_key}");

    // -----------------------------------------------------------------------
    // 1. 检查磁盘缓存
    // -----------------------------------------------------------------------
    let cached_path = {
        let cache = state
            .render_cache
            .lock()
            .map_err(|_| AppError::Lock)?;
        cache.get(&cache_key)
    };

    if let Some(path) = cached_path {
        if path.exists() {
            // 读取实际尺寸（从文件头解析 WebP 会比较重，直接返回 0 让前端自行处理）
            // 更好的做法是在 put 时也缓存尺寸；这里先用简单方案：
            // 尝试从缓存目录中读取同名 .meta 文件，若不存在则走渲染路径
            let meta_path = path.with_extension("meta");
            if let Ok(meta_str) = std::fs::read_to_string(&meta_path) {
                if let Some((w, h)) = parse_meta(&meta_str) {
                    return Ok(RenderResult {
                        file_path: path.to_string_lossy().into_owned(),
                        data_url: read_webp_as_data_url(&path),
                        width: w,
                        height: h,
                    });
                }
            }
        }
    }

    // -----------------------------------------------------------------------
    // 2. 缓存未命中：向渲染线程发送命令
    // -----------------------------------------------------------------------

    // 校验文档已打开
    {
        let docs = state
            .documents
            .lock()
            .map_err(|_| AppError::Lock)?;
        if !docs.contains_key(&doc_id) {
            return Err(AppError::PdfEngine(format!(
                "文档 {doc_id} 未打开，请先调用 open_pdf"
            )));
        }
    }

    // 确定输出路径
    let output_path = state
        .cache_dir
        .join(format!("{cache_key}.webp"));

    let (width, height) = send_pdf_cmd(&state, |reply| PdfCommand::RenderPage {
        doc_id: doc_id.clone(),
        page_index,
        scale,
        output_path: output_path.clone(),
        reply,
    })
    .await?;

    // -----------------------------------------------------------------------
    // 3. 将路径注册到缓存（此时文件已由渲染线程写入磁盘）
    // -----------------------------------------------------------------------
    {
        let mut cache = state
            .render_cache
            .lock()
            .map_err(|_| AppError::Lock)?;

        // 读取刚写入的文件内容以便缓存追踪其大小
        if let Ok(data) = std::fs::read(&output_path) {
            let _ = cache.put(&cache_key, &data);
        }
    }

    // 写入 .meta 文件（存储 width/height 供下次缓存命中时读取）
    let meta_path = output_path.with_extension("meta");
    let _ = std::fs::write(&meta_path, format!("{width},{height}"));

    Ok(RenderResult {
        file_path: output_path.to_string_lossy().into_owned(),
        data_url: read_webp_as_data_url(&output_path),
        width,
        height,
    })
}

// ---------------------------------------------------------------------------
// 内部工具
// ---------------------------------------------------------------------------

/// 解析 `"width,height"` 格式的 meta 字符串
fn parse_meta(s: &str) -> Option<(u32, u32)> {
    let mut parts = s.trim().splitn(2, ',');
    let w: u32 = parts.next()?.parse().ok()?;
    let h: u32 = parts.next()?.parse().ok()?;
    Some((w, h))
}

fn read_webp_as_data_url(path: &Path) -> Option<String> {
    let bytes = std::fs::read(path).ok()?;
    let encoded = BASE64_STANDARD.encode(bytes);
    Some(format!("data:image/webp;base64,{encoded}"))
}

// ---------------------------------------------------------------------------
// get_pdf_page_text
// ---------------------------------------------------------------------------

/// 提取 PDF 指定页面的文本内容及每个单词的归一化坐标
#[tauri::command]
pub async fn get_pdf_page_text(
    doc_id: String,
    page_index: u32,
    state: State<'_, PdfState>,
) -> AppResult<PageTextData> {
    // 校验文档已打开
    {
        let docs = state
            .documents
            .lock()
            .map_err(|_| AppError::Lock)?;
        if !docs.contains_key(&doc_id) {
            return Err(AppError::PdfEngine(format!(
                "文档 {doc_id} 未打开，请先调用 open_pdf"
            )));
        }
    }

    send_pdf_cmd(&state, |reply| PdfCommand::ExtractText {
        doc_id,
        page_index,
        reply,
    })
    .await
}

// ---------------------------------------------------------------------------
// search_pdf
// ---------------------------------------------------------------------------

/// 在已打开的 PDF 文档中进行全文搜索，返回所有匹配项的页码及归一化矩形
#[tauri::command]
pub async fn search_pdf(
    doc_id: String,
    query: String,
    state: State<'_, PdfState>,
) -> AppResult<Vec<SearchMatch>> {
    if query.is_empty() {
        return Ok(Vec::new());
    }

    // 校验文档已打开
    {
        let docs = state
            .documents
            .lock()
            .map_err(|_| AppError::Lock)?;
        if !docs.contains_key(&doc_id) {
            return Err(AppError::PdfEngine(format!(
                "文档 {doc_id} 未打开，请先调用 open_pdf"
            )));
        }
    }

    send_pdf_cmd(&state, |reply| PdfCommand::Search {
        doc_id,
        query,
        reply,
    })
    .await
}

// ---------------------------------------------------------------------------
// PDF 批注持久化命令
// ---------------------------------------------------------------------------

/// 加载指定 PDF 文件的批注列表
///
/// 使用 `spawn_blocking` 避免在 async 运行时中直接阻塞线程（无需 PDF 渲染线程）。
#[tauri::command]
pub async fn load_pdf_annotations(
    vault_path: String,
    file_path: String,
) -> AppResult<Vec<PdfAnnotation>> {
    let vault_root = PathBuf::from(vault_path);
    let pdf_path = PathBuf::from(file_path);

    tokio::task::spawn_blocking(move || {
        crate::pdf::annotations::load_annotations(&vault_root, &pdf_path)
    })
    .await
    .map_err(|e| AppError::PdfAnnotation(format!("spawn_blocking 失败: {e}")))?
}

/// 保存 PDF 批注列表到磁盘
///
/// 使用 `spawn_blocking` 避免在 async 运行时中直接阻塞线程（无需 PDF 渲染线程）。
#[tauri::command]
pub async fn save_pdf_annotations(
    vault_path: String,
    file_path: String,
    annotations_data: Vec<PdfAnnotation>,
) -> AppResult<()> {
    let vault_root = PathBuf::from(vault_path);
    let pdf_path = PathBuf::from(file_path);

    tokio::task::spawn_blocking(move || {
        crate::pdf::annotations::save_annotations(&vault_root, &pdf_path, annotations_data)
    })
    .await
    .map_err(|e| AppError::PdfAnnotation(format!("spawn_blocking 失败: {e}")))?
}
