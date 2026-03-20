//! PDF 渲染引擎核心模块
//!
//! 采用「专用渲染线程」架构：PDFium 的 C 指针不可跨线程发送（!Send），
//! 因此我们将唯一的 `Pdfium` 实例及所有已打开的 `PdfDocument` 句柄
//! 全部放在一个专用线程中，通过 mpsc channel 接收命令、通过 oneshot 返回结果。

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::mpsc;

use pdfium_render::prelude::*;
use serde::Serialize;
use sha2::{Digest, Sha256};
use tokio::sync::oneshot;

use crate::error::{AppError, AppResult};

// ---------------------------------------------------------------------------
// 公开数据类型（会序列化给前端）
// ---------------------------------------------------------------------------

/// 单页尺寸（单位：PDF 点，1 pt = 1/72 inch）
#[derive(Debug, Clone, Serialize)]
pub struct PageDimension {
    pub width: f32,
    pub height: f32,
}

/// 大纲（书签）条目
#[derive(Debug, Clone, Serialize)]
pub struct OutlineEntry {
    pub title: String,
    /// 目标页码（0-based），无法解析时为 None
    pub page: Option<u16>,
    pub children: Vec<OutlineEntry>,
}

/// 打开 PDF 后返回给前端的元数据
#[derive(Debug, Clone, Serialize)]
pub struct PdfMeta {
    pub doc_id: String,
    pub page_count: u16,
    pub page_dimensions: Vec<PageDimension>,
    pub outline: Vec<OutlineEntry>,
}

// ---------------------------------------------------------------------------
// 内部：存储在 PdfState.documents 中的精简信息
// ---------------------------------------------------------------------------

#[derive(Debug, Clone)]
pub struct LoadedPdf {
    pub path: String,
    pub page_count: u16,
    pub page_dimensions: Vec<PageDimension>,
}

// ---------------------------------------------------------------------------
// 渲染线程命令
// ---------------------------------------------------------------------------

pub enum PdfCommand {
    Open {
        path: String,
        doc_id: String,
        reply: oneshot::Sender<Result<PdfMeta, AppError>>,
    },
    Close {
        doc_id: String,
        reply: oneshot::Sender<Result<(), AppError>>,
    },
    RenderPage {
        doc_id: String,
        page_index: u32,
        scale: f32,
        output_path: PathBuf,
        reply: oneshot::Sender<Result<(u32, u32), AppError>>,
    },
    ExtractText {
        doc_id: String,
        page_index: u32,
        reply: oneshot::Sender<Result<crate::pdf::text::PageTextData, AppError>>,
    },
    Search {
        doc_id: String,
        query: String,
        reply: oneshot::Sender<Result<Vec<crate::pdf::search::SearchMatch>, AppError>>,
    },
}

// ---------------------------------------------------------------------------
// Tauri 共享状态
// ---------------------------------------------------------------------------

pub struct PdfState {
    /// 已打开文档的精简元数据（不含 C 指针，可 Send）
    pub documents: std::sync::Mutex<HashMap<String, LoadedPdf>>,
    /// 渲染缓存目录
    pub cache_dir: PathBuf,
    /// 渲染缓存管理器
    pub render_cache: std::sync::Mutex<crate::pdf::cache::RenderCache>,
    /// 向渲染线程发送命令
    pub cmd_tx: mpsc::Sender<PdfCommand>,
}

impl PdfState {
    /// 初始化 PDF 引擎状态：创建缓存目录、启动渲染线程
    pub fn new(app_data_dir: &Path) -> AppResult<Self> {
        let cache_dir = app_data_dir.join("pdf-render-cache");
        std::fs::create_dir_all(&cache_dir)?;

        let (cmd_tx, cmd_rx) = mpsc::channel::<PdfCommand>();

        // 启动专用渲染线程（16 MB 栈，PDFium 递归解析深层 PDF 可能需要较大栈空间）
        std::thread::Builder::new()
            .name("pdf-render".into())
            .stack_size(16 * 1024 * 1024)
            .spawn(move || {
                pdf_render_thread(cmd_rx);
            })
            .map_err(|e| AppError::PdfEngine(format!("无法启动 PDF 渲染线程: {e}")))?;

        let render_cache = crate::pdf::cache::RenderCache::with_default_limit(&cache_dir)?;

        Ok(Self {
            documents: std::sync::Mutex::new(HashMap::new()),
            cache_dir,
            render_cache: std::sync::Mutex::new(render_cache),
            cmd_tx,
        })
    }
}

// ---------------------------------------------------------------------------
// 工具函数
// ---------------------------------------------------------------------------

/// 根据文件路径生成确定性文档 ID（SHA-256 前 12 字符）
pub fn make_doc_id(path: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(path.as_bytes());
    let hash = hasher.finalize();
    hex_encode(&hash[..6]) // 6 bytes = 12 hex chars
}

fn hex_encode(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// 查找 pdfium 动态库路径：优先查找 exe 同级目录，其次 binaries/ 子目录
pub fn pdfium_lib_path() -> AppResult<PathBuf> {
    let exe = std::env::current_exe()
        .map_err(|e| AppError::PdfEngine(format!("获取 exe 路径失败: {e}")))?;
    let exe_dir = exe
        .parent()
        .ok_or_else(|| AppError::PdfEngine("无法确定 exe 所在目录".into()))?;

    // Windows: pdfium.dll
    let lib_name = Pdfium::pdfium_platform_library_name();

    // 1) exe 同级
    let candidate = exe_dir.join(&lib_name);
    if candidate.exists() {
        return Ok(candidate);
    }

    // 2) binaries/ 子目录
    let candidate = exe_dir.join("binaries").join(&lib_name);
    if candidate.exists() {
        return Ok(candidate);
    }

    Err(AppError::PdfEngine(format!(
        "找不到 PDFium 库文件 ({lib_name:?})，已搜索: {exe_dir:?}"
    )))
}

// ---------------------------------------------------------------------------
// 渲染线程主循环
// ---------------------------------------------------------------------------

fn pdf_render_thread(cmd_rx: mpsc::Receiver<PdfCommand>) {
    // 加载 PDFium 库（仅此一次）
    let pdfium = match init_pdfium() {
        Ok(p) => p,
        Err(e) => {
            eprintln!("[pdf-render] 初始化 PDFium 失败: {e}");
            // 持续接收命令并回复错误，避免调用方死锁
            drain_with_error(cmd_rx, &e.to_string());
            return;
        }
    };

    // 文档句柄映射：doc_id → PdfDocument
    // PdfDocument<'a> 的生命周期 'a 来自 &pdfium（即 Pdfium 实例的引用），
    // 由于 pdfium 在整个线程循环期间存活，这里的借用是安全的。
    let mut docs: HashMap<String, PdfDocument<'_>> = HashMap::new();

    while let Ok(cmd) = cmd_rx.recv() {
        match cmd {
            PdfCommand::Open {
                path,
                doc_id,
                reply,
            } => {
                let result = handle_open(&pdfium, &mut docs, &path, &doc_id);
                let _ = reply.send(result);
            }
            PdfCommand::Close { doc_id, reply } => {
                let result = handle_close(&mut docs, &doc_id);
                let _ = reply.send(result);
            }
            PdfCommand::RenderPage {
                doc_id,
                page_index,
                scale,
                output_path,
                reply,
            } => {
                let result = handle_render_page(&docs, &doc_id, page_index, scale, &output_path);
                let _ = reply.send(result);
            }
            PdfCommand::ExtractText {
                doc_id,
                page_index,
                reply,
            } => {
                let result = handle_extract_text(&docs, &doc_id, page_index);
                let _ = reply.send(result);
            }
            PdfCommand::Search {
                doc_id,
                query,
                reply,
            } => {
                let result = handle_search(&docs, &doc_id, &query);
                let _ = reply.send(result);
            }
        }
    }

    // channel 断开 → 应用退出，docs 在此自动 drop
}

/// 初始化 PDFium：先尝试按路径加载，再尝试系统库
fn init_pdfium() -> AppResult<Pdfium> {
    // 优先按路径加载（开发/打包场景）
    if let Ok(lib_path) = pdfium_lib_path() {
        let bindings = Pdfium::bind_to_library(lib_path)
            .map_err(|e| AppError::PdfEngine(format!("绑定 PDFium 库失败: {e}")))?;
        return Ok(Pdfium::new(bindings));
    }

    // 回退到系统库搜索
    let bindings = Pdfium::bind_to_system_library()
        .map_err(|e| AppError::PdfEngine(format!("绑定系统 PDFium 库失败: {e}")))?;
    Ok(Pdfium::new(bindings))
}

/// 当 PDFium 初始化失败时，持续消耗 channel 中的命令并回复错误
fn drain_with_error(cmd_rx: mpsc::Receiver<PdfCommand>, msg: &str) {
    while let Ok(cmd) = cmd_rx.recv() {
        let err = AppError::PdfEngine(msg.to_string());
        match cmd {
            PdfCommand::Open { reply, .. } => {
                let _ = reply.send(Err(err));
            }
            PdfCommand::Close { reply, .. } => {
                let _ = reply.send(Err(err));
            }
            PdfCommand::RenderPage { reply, .. } => {
                let _ = reply.send(Err(err));
            }
            PdfCommand::ExtractText { reply, .. } => {
                let _ = reply.send(Err(err));
            }
            PdfCommand::Search { reply, .. } => {
                let _ = reply.send(Err(err));
            }
        }
    }
}

// ---------------------------------------------------------------------------
// 命令处理
// ---------------------------------------------------------------------------

fn handle_open<'a>(
    pdfium: &'a Pdfium,
    docs: &mut HashMap<String, PdfDocument<'a>>,
    path: &str,
    doc_id: &str,
) -> Result<PdfMeta, AppError> {
    // 如果已打开，先关闭旧文档
    docs.remove(doc_id);

    // 读取文件内容到内存，让 PdfDocument 拥有字节缓冲区
    let bytes = std::fs::read(path)
        .map_err(|e| AppError::PdfEngine(format!("读取 PDF 文件失败: {e}")))?;

    let doc = pdfium
        .load_pdf_from_byte_vec(bytes, None)
        .map_err(|e| AppError::PdfEngine(format!("PDFium 打开文档失败: {e}")))?;

    // 提取元数据
    let page_count = doc.pages().len();
    let page_dimensions = extract_page_dimensions(&doc)?;
    let outline = extract_outline(&doc);

    let meta = PdfMeta {
        doc_id: doc_id.to_string(),
        page_count,
        page_dimensions,
        outline,
    };

    docs.insert(doc_id.to_string(), doc);

    Ok(meta)
}

fn handle_close(
    docs: &mut HashMap<String, PdfDocument<'_>>,
    doc_id: &str,
) -> Result<(), AppError> {
    docs.remove(doc_id);
    Ok(())
}

fn handle_render_page(
    docs: &HashMap<String, PdfDocument<'_>>,
    doc_id: &str,
    page_index: u32,
    scale: f32,
    output_path: &Path,
) -> Result<(u32, u32), AppError> {
    let doc = docs
        .get(doc_id)
        .ok_or_else(|| AppError::PdfEngine(format!("文档 {doc_id} 未打开")))?;

    crate::pdf::renderer::render_page_from_doc(doc, page_index, scale, output_path)
}

fn handle_extract_text(
    docs: &HashMap<String, PdfDocument<'_>>,
    doc_id: &str,
    page_index: u32,
) -> Result<crate::pdf::text::PageTextData, AppError> {
    let doc = docs
        .get(doc_id)
        .ok_or_else(|| AppError::PdfEngine(format!("文档 {doc_id} 未打开")))?;

    crate::pdf::text::extract_page_text_from_doc(doc, page_index)
}

fn handle_search(
    docs: &HashMap<String, PdfDocument<'_>>,
    doc_id: &str,
    query: &str,
) -> Result<Vec<crate::pdf::search::SearchMatch>, AppError> {
    let doc = docs
        .get(doc_id)
        .ok_or_else(|| AppError::PdfEngine(format!("文档 {doc_id} 未打开")))?;

    crate::pdf::search::search_in_doc(doc, query)
}

// ---------------------------------------------------------------------------
// 元数据提取
// ---------------------------------------------------------------------------

fn extract_page_dimensions(doc: &PdfDocument<'_>) -> Result<Vec<PageDimension>, AppError> {
    let pages = doc.pages();
    let count = pages.len();
    let mut dims = Vec::with_capacity(count as usize);

    for i in 0..count {
        let size = pages
            .page_size(i)
            .map_err(|e| AppError::PdfEngine(format!("获取第 {i} 页尺寸失败: {e}")))?;
        dims.push(PageDimension {
            width: size.width().value,
            height: size.height().value,
        });
    }

    Ok(dims)
}

/// 从 PDF 书签树中提取大纲（尽力而为，失败返回空 Vec）
fn extract_outline(doc: &PdfDocument<'_>) -> Vec<OutlineEntry> {
    let bookmarks = doc.bookmarks();
    let root = match bookmarks.root() {
        Some(r) => r,
        None => return Vec::new(),
    };

    // 从根书签开始，递归收集同级 + 子级
    collect_siblings(&root)
}

/// 递归收集书签的同级链及其子树
fn collect_siblings(first: &PdfBookmark<'_>) -> Vec<OutlineEntry> {
    let mut entries = Vec::new();
    let mut current = Some(first.clone());

    while let Some(bm) = current {
        let title = bm.title().unwrap_or_default();
        let page = bm
            .destination()
            .and_then(|dest| dest.page_index().ok());

        let children = match bm.first_child() {
            Some(child) => collect_siblings(&child),
            None => Vec::new(),
        };

        entries.push(OutlineEntry {
            title,
            page,
            children,
        });

        current = bm.next_sibling();
    }

    entries
}
