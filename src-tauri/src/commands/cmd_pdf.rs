//! PDF 文档生命周期命令：打开 / 关闭 / 渲染页面 / 批注持久化

use std::path::{Path, PathBuf};

use base64::Engine as _;
use serde::Serialize;
use tauri::State;
use tokio::sync::oneshot;

use crate::error::{AppError, AppResult};
use crate::pdf::annotations::PdfAnnotation;
use crate::pdf::engine::{make_doc_id, LoadedPdf, PdfCommand, PdfMeta, PdfState};
use crate::pdf::search::SearchMatch;
use crate::pdf::text::PageTextData;

/// 预取窗口：当前页前后各预取此数量的页面
const PREFETCH_WINDOW: u32 = 3;

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
                page_count: meta.page_count as u32,
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
    inline_fallback: Option<bool>,
    state: State<'_, PdfState>,
) -> AppResult<RenderResult> {
    let inline_fallback = inline_fallback.unwrap_or(false);

    // 生成缓存键：{doc_id}-p{page}-s{scale_x100}
    // 将 scale 乘以 100 取整，避免浮点数在文件名中出现小数点
    let scale_key = (scale * 100.0).round() as u32;
    let cache_key = format!("{doc_id}-p{page_index}-s{scale_key}");

    // -----------------------------------------------------------------------
    // 1. 检查缓存（内存索引 + 磁盘文件存在性）
    // -----------------------------------------------------------------------
    let cached = {
        let cache = state
            .render_cache
            .lock()
            .map_err(|_| AppError::Lock)?;
        cache.get_with_dimensions(&cache_key)
    };

    if let Some((path, w, h)) = cached {
        if w > 0 && h > 0 && path.exists() {
            // 缓存命中：尺寸从内存直接返回，零文件 I/O
            return Ok(RenderResult {
                file_path: path.to_string_lossy().into_owned(),
                data_url: if inline_fallback {
                    Some(encode_webp_data_url(&path)?)
                } else {
                    None
                },
                width: w,
                height: h,
            });
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
    let mut rendered_bytes: Option<Vec<u8>> = None;
    {
        let mut cache = state
            .render_cache
            .lock()
            .map_err(|_| AppError::Lock)?;

        if inline_fallback {
            // 仅在需要 data URL 兜底时读取字节，避免常态路径的重复 IO。
            if let Ok(data) = std::fs::read(&output_path) {
                rendered_bytes = Some(data);
            }
        }

        if output_path.exists() {
            let _ = cache.track_with_dimensions(&cache_key, output_path.clone(), width, height);
        }
    }

    // 写入 .meta 文件（供重启后缓存恢复时读取尺寸）
    let meta_path = output_path.with_extension("meta");
    let _ = std::fs::write(&meta_path, format!("{width},{height}"));

    let result = RenderResult {
        file_path: output_path.to_string_lossy().into_owned(),
        data_url: if inline_fallback {
            Some(match rendered_bytes {
                Some(data) => encode_webp_data_url_from_bytes(&data),
                None => encode_webp_data_url(&output_path)?,
            })
        } else {
            None
        },
        width,
        height,
    };

    // -----------------------------------------------------------------------
    // 4. 后台预取相邻页面（fire-and-forget）
    // -----------------------------------------------------------------------
    prefetch_adjacent_pages(&state, &doc_id, page_index, scale);

    Ok(result)
}

/// 后台预取相邻页面到缓存。不阻塞当前请求。
fn prefetch_adjacent_pages(
    state: &PdfState,
    doc_id: &str,
    current_page: u32,
    scale: f32,
) {
    // 获取文档总页数
    let page_count = {
        let docs = match state.documents.lock() {
            Ok(d) => d,
            Err(_) => return,
        };
        let Some(doc) = docs.get(doc_id) else {
            return;
        };
        doc.page_count
    };

    let scale_key = (scale * 100.0).round() as u32;

    for delta in 1..=PREFETCH_WINDOW {
        let mut candidates = Vec::with_capacity(2);
        if let Some(next_page) = current_page.checked_add(delta) {
            if next_page < page_count {
                candidates.push(next_page);
            }
        }
        if let Some(prev_page) = current_page.checked_sub(delta) {
            candidates.push(prev_page);
        }

        for page in candidates {

            let cache_key = format!("{doc_id}-p{page}-s{scale_key}");

            // 如果已缓存，跳过
            let already_cached = state
                .render_cache
                .lock()
                .map(|c| c.get(&cache_key).map(|p| p.exists()).unwrap_or(false))
                .unwrap_or(false);
            if already_cached {
                continue;
            }

            // 异步后台渲染（受信号量限制，避免过多预取挤占渲染线程）
            let sem = state.prefetch_semaphore.clone();
            let permit = match sem.try_acquire_owned() {
                Ok(p) => p,
                Err(_) => continue, // 没有空闲许可，跳过本次预取
            };

            let cmd_tx = state.cmd_tx.clone();
            let cache_dir = state.cache_dir.clone();
            let render_cache = state.render_cache.clone();
            let doc_id = doc_id.to_string();
            let cache_key = cache_key.clone();

            tauri::async_runtime::spawn(async move {
                let output_path = cache_dir.join(format!("{cache_key}.webp"));
                let (tx, rx) = oneshot::channel();
                let cmd = PdfCommand::RenderPage {
                    doc_id,
                    page_index: page,
                    scale,
                    output_path: output_path.clone(),
                    reply: tx,
                };

                if cmd_tx.send(cmd).is_err() {
                    drop(permit);
                    return;
                }

                if let Ok(Ok((w, h))) = rx.await {
                    let meta_path = output_path.with_extension("meta");
                    let _ = std::fs::write(&meta_path, format!("{w},{h}"));
                    if let Ok(mut cache) = render_cache.lock() {
                        let _ = cache.track_with_dimensions(&cache_key, output_path, w, h);
                    }
                }
                drop(permit); // 显式释放许可
            });
        }
    }
}

// ---------------------------------------------------------------------------
// 内部工具
// ---------------------------------------------------------------------------


fn encode_webp_data_url(path: &Path) -> AppResult<String> {
    let bytes = std::fs::read(path)?;
    Ok(encode_webp_data_url_from_bytes(&bytes))
}

fn encode_webp_data_url_from_bytes(bytes: &[u8]) -> String {
    let encoded = base64::engine::general_purpose::STANDARD.encode(bytes);
    format!("data:image/webp;base64,{encoded}")
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

/// 按需加载 PDF 目录，避免首开时同步提取大纲阻塞首屏。
#[tauri::command]
pub async fn get_pdf_outline(
    doc_id: String,
    state: State<'_, PdfState>,
) -> AppResult<Vec<crate::pdf::engine::OutlineEntry>> {
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

    send_pdf_cmd(&state, |reply| crate::pdf::engine::PdfCommand::GetOutline { doc_id, reply }).await
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
