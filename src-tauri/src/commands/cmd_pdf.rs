//! PDF 文档生命周期命令：打开 / 关闭

use std::path::Path;

use tauri::State;
use tokio::sync::oneshot;

use crate::error::{AppError, AppResult};
use crate::pdf::engine::{make_doc_id, LoadedPdf, PdfCommand, PdfMeta, PdfState};

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

    // 清理该文档的渲染缓存文件
    let cache_dir = &state.cache_dir;
    if let Ok(entries) = std::fs::read_dir(cache_dir) {
        for entry in entries.flatten() {
            let name = entry.file_name();
            if name.to_string_lossy().starts_with(&doc_id) {
                let _ = std::fs::remove_file(entry.path());
            }
        }
    }

    Ok(())
}
