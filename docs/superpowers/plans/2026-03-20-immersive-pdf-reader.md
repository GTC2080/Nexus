# Immersive PDF Reader Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the browser-native PDF embed with a Rust-driven, immersive PDF reader featuring custom UI, text highlighting, and annotation support.

**Architecture:** PDFium renders pages to WebP bitmaps in Rust, served to the frontend via Tauri's asset protocol. The frontend is a thin display layer — Canvas/img for rendering, transparent text spans for selection, SVG overlay for annotations. All heavy computation (rendering, search, text extraction) runs in Rust with `tokio::spawn_blocking`.

**Tech Stack:** Rust (`pdfium-render`, `webp`, `sha2`), Tauri 2.x asset protocol, React 19, TypeScript, CSS (glassmorphism tokens from `tokens.css`)

**Spec:** `docs/superpowers/specs/2026-03-20-immersive-pdf-reader-design.md`

---

## Task 1: Add Rust Dependencies & Download PDFium Binary

**Files:**

- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/tauri.conf.json`
- Create: `src-tauri/scripts/download-pdfium.sh`

- [ ] **Step 1: Add crate dependencies to Cargo.toml**

In `src-tauri/Cargo.toml`, add under `[dependencies]`:

```toml
pdfium-render = "0.8"
webp = "0.3"
sha2 = "0.10"
```

- [ ] **Step 2: Add asset protocol scope to tauri.conf.json**

In `src-tauri/tauri.conf.json`, add inside `"app"` → `"security"`:

```json
"assetProtocol": {
  "scope": ["$APPDATA/pdf-render-cache/**", "$TEMP/**"]
}
```

Also add to `"bundle"` → `"resources"`:

```json
"resources": [{ "src": "binaries/pdfium.dll", "target": "" }]
```

- [ ] **Step 3: Create PDFium download script**

Create `src-tauri/scripts/download-pdfium.sh`:

```bash
#!/bin/bash
# Downloads pre-built PDFium binary for the current platform
set -e

PDFIUM_VERSION="6866"
PLATFORM="win-x64"
URL="https://github.com/nickel-nickel/nickel-nickel/releases/download/chromium/${PDFIUM_VERSION}/pdfium-${PLATFORM}.tgz"
# NOTE: Replace with actual pdfium-binaries repo URL at implementation time.
# Check https://github.com/nickel-nickel/nickel-nickel or pdfium-binaries releases.
TARGET_DIR="$(dirname "$0")/../binaries"

mkdir -p "$TARGET_DIR"

if [ -f "$TARGET_DIR/pdfium.dll" ]; then
  echo "pdfium.dll already exists, skipping download"
  exit 0
fi

echo "Downloading PDFium ${PDFIUM_VERSION} for ${PLATFORM}..."
curl -L "$URL" | tar xz -C "$TARGET_DIR" lib/pdfium.dll --strip-components=1
echo "Downloaded pdfium.dll to $TARGET_DIR"
```

- [ ] **Step 4: Download PDFium and verify build compiles**

Run:

```bash
cd src-tauri && bash scripts/download-pdfium.sh
cd .. && cargo check --manifest-path src-tauri/Cargo.toml
```

Expected: Compiles without errors. `pdfium.dll` present in `src-tauri/binaries/`.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/tauri.conf.json src-tauri/scripts/download-pdfium.sh
git commit -m "feat(pdf): add pdfium-render, webp, sha2 deps and PDFium download script"
```

---

## Task 2: Rust PDF Engine Core — State Management & Open/Close

**Files:**

- Create: `src-tauri/src/pdf/mod.rs`
- Create: `src-tauri/src/pdf/engine.rs`
- Modify: `src-tauri/src/commands.rs`
- Create: `src-tauri/src/commands/cmd_pdf.rs`
- Modify: `src-tauri/src/error.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Add PDF error variants**

In `src-tauri/src/error.rs`, add three new variants to `AppError`:

```rust
#[error("PDF 引擎错误: {0}")]
PdfEngine(String),

#[error("PDF 渲染错误: {0}")]
PdfRender(String),

#[error("PDF 批注错误: {0}")]
PdfAnnotation(String),
```

- [ ] **Step 2: Create PDF engine module with state**

Create `src-tauri/src/pdf/mod.rs`:

```rust
pub mod engine;
```

Create `src-tauri/src/pdf/engine.rs`:

```rust
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use pdfium_render::prelude::*;

use crate::AppError;

/// Metadata returned to frontend when a PDF is opened.
#[derive(serde::Serialize, Clone)]
pub struct PdfMetadata {
    pub doc_id: String,
    pub page_count: u32,
    /// Each entry: [width_pts, height_pts] in PDF points (1 point = 1/72 inch).
    pub page_dimensions: Vec<[f32; 2]>,
    pub outline: Vec<OutlineEntry>,
}

#[derive(serde::Serialize, Clone)]
pub struct OutlineEntry {
    pub title: String,
    pub page: u32,
    pub children: Vec<OutlineEntry>,
}

/// Holds a loaded PDFium document metadata plus its source path.
/// The actual PDFium document handle lives on the dedicated render thread.
pub struct LoadedPdf {
    pub path: PathBuf,
    pub page_count: u32,
    pub page_dimensions: Vec<[f32; 2]>,
}

/// Commands that can be sent to the dedicated PDF render thread.
/// The render thread owns the Pdfium instance and all loaded documents,
/// avoiding the need to reload PDFium/documents per operation.
pub enum PdfCommand {
    Open {
        doc_id: String,
        path: PathBuf,
        reply: tokio::sync::oneshot::Sender<Result<(u32, Vec<[f32; 2]>, Vec<OutlineEntry>), AppError>>,
    },
    Close {
        doc_id: String,
    },
    RenderPage {
        doc_id: String,
        page_index: u32,
        scale: f32,
        output_path: PathBuf,
        reply: tokio::sync::oneshot::Sender<Result<(u32, u32), AppError>>,
    },
    ExtractText {
        doc_id: String,
        page_index: u32,
        reply: tokio::sync::oneshot::Sender<Result<super::text::PageTextData, AppError>>,
    },
    Search {
        doc_id: String,
        query: String,
        reply: tokio::sync::oneshot::Sender<Result<Vec<super::search::SearchMatch>, AppError>>,
    },
}

/// Shared state managed by Tauri.
pub struct PdfState {
    pub documents: Arc<Mutex<HashMap<String, LoadedPdf>>>,
    pub cache_dir: PathBuf,
    /// Channel to send commands to the dedicated render thread.
    pub cmd_tx: std::sync::mpsc::Sender<PdfCommand>,
}

impl PdfState {
    pub fn new(app_data_dir: &Path) -> Self {
        let cache_dir = app_data_dir.join("pdf-render-cache");
        std::fs::create_dir_all(&cache_dir).ok();

        let (cmd_tx, cmd_rx) = std::sync::mpsc::channel::<PdfCommand>();

        // Spawn dedicated render thread — owns Pdfium instance + loaded documents
        let lib_path = pdfium_lib_path().expect("PDFium DLL 未找到");
        std::thread::Builder::new()
            .name("pdf-render".into())
            .stack_size(16 * 1024 * 1024) // 16MB stack for large PDFs
            .spawn(move || {
                pdf_render_thread(lib_path, cmd_rx);
            })
            .expect("无法启动 PDF 渲染线程");

        Self {
            documents: Arc::new(Mutex::new(HashMap::new())),
            cache_dir,
            cmd_tx,
        }
    }
}

/// The render thread loop. Owns Pdfium + all loaded PdfDocument handles.
/// Receives commands via channel, executes them, sends results back.
fn pdf_render_thread(
    lib_path: PathBuf,
    cmd_rx: std::sync::mpsc::Receiver<PdfCommand>,
) {
    // Initialize Pdfium ONCE on this thread
    let pdfium = Pdfium::new(
        Pdfium::bind_to_library(lib_path.to_str().unwrap_or_default())
            .expect("加载 PDFium 失败"),
    );
    // Keep loaded documents alive — keyed by doc_id
    // NOTE: PdfDocument is not Send, so it must stay on this thread
    let mut docs: HashMap<String, pdfium_render::prelude::PdfDocument<'_>> = HashMap::new();

    while let Ok(cmd) = cmd_rx.recv() {
        match cmd {
            PdfCommand::Open { doc_id, path, reply } => {
                // Load document and keep handle alive
                let result = (|| {
                    let doc = pdfium
                        .load_pdf_from_file(path.to_str().unwrap_or_default(), None)
                        .map_err(|e| AppError::PdfEngine(format!("打开 PDF 失败: {}", e)))?;
                    let page_count = doc.pages().len() as u32;
                    let mut dims = Vec::with_capacity(page_count as usize);
                    for i in 0..page_count.min(65535) {
                        let page = doc.pages().get(i as u16).map_err(|e| {
                            AppError::PdfEngine(format!("读取第 {} 页失败: {}", i, e))
                        })?;
                        dims.push([page.width().value, page.height().value]);
                    }
                    // Extract outline via bookmarks API
                    let outline = extract_outline(&doc);
                    docs.insert(doc_id.clone(), doc);
                    Ok((page_count, dims, outline))
                })();
                let _ = reply.send(result);
            }
            PdfCommand::Close { doc_id } => {
                docs.remove(&doc_id); // drops the PdfDocument handle
            }
            PdfCommand::RenderPage { doc_id, page_index, scale, output_path, reply } => {
                let result = (|| {
                    let doc = docs.get(&doc_id).ok_or_else(|| {
                        AppError::PdfRender(format!("文档未打开: {}", doc_id))
                    })?;
                    super::renderer::render_page_from_doc(doc, page_index, scale, &output_path)
                })();
                let _ = reply.send(result);
            }
            PdfCommand::ExtractText { doc_id, page_index, reply } => {
                let result = (|| {
                    let doc = docs.get(&doc_id).ok_or_else(|| {
                        AppError::PdfRender(format!("文档未打开: {}", doc_id))
                    })?;
                    super::text::extract_page_text_from_doc(doc, page_index)
                })();
                let _ = reply.send(result);
            }
            PdfCommand::Search { doc_id, query, reply } => {
                let result = (|| {
                    let doc = docs.get(&doc_id).ok_or_else(|| {
                        AppError::PdfRender(format!("文档未打开: {}", doc_id))
                    })?;
                    super::search::search_in_doc(doc, &query)
                })();
                let _ = reply.send(result);
            }
        }
    }
}

/// Extract bookmark/outline tree from a loaded document.
fn extract_outline(doc: &pdfium_render::prelude::PdfDocument) -> Vec<OutlineEntry> {
    // Use PDFium's bookmarks API
    // This is a best-effort extraction; return empty if no bookmarks
    match doc.bookmarks() {
        Ok(bookmarks) => {
            bookmarks.iter().filter_map(|b| {
                let title = b.title().unwrap_or_default();
                let page = b.destination().and_then(|d| d.page_index()).unwrap_or(0);
                Some(OutlineEntry {
                    title,
                    page: page as u32,
                    children: Vec::new(), // TODO: recursive children
                })
            }).collect()
        }
        Err(_) => Vec::new(),
    }
}

/// Generate a short document ID from the file path.
pub fn make_doc_id(path: &str) -> String {
    use sha2::{Digest, Sha256};
    let hash = Sha256::digest(path.as_bytes());
    format!("{:x}", &hash)[..12].to_string()
}

/// Resolve path to the bundled pdfium.dll relative to the executable.
pub fn pdfium_lib_path() -> Result<PathBuf, AppError> {
    let exe = std::env::current_exe()
        .map_err(|e| AppError::PdfEngine(format!("无法获取可执行文件路径: {}", e)))?;
    let dir = exe.parent().ok_or_else(|| {
        AppError::PdfEngine("无法获取可执行文件目录".into())
    })?;
    let lib = dir.join("binaries").join("pdfium.dll");
    if !lib.exists() {
        // Also check next to exe directly (dev vs production layout)
        let alt = dir.join("pdfium.dll");
        if alt.exists() {
            return Ok(alt);
        }
        return Err(AppError::PdfEngine(format!(
            "PDF 引擎未找到: {} 或 {}",
            lib.display(),
            alt.display()
        )));
    }
    Ok(lib)
}
```

- [ ] **Step 3: Create cmd_pdf with open/close commands**

Create `src-tauri/src/commands/cmd_pdf.rs`:

```rust
use std::path::{Path, PathBuf};
use tauri::State;

use crate::error::AppError;
use crate::pdf::engine::{self, LoadedPdf, PdfCommand, PdfMetadata, PdfState};

/// Helper: send a command to the render thread and await the reply.
async fn send_pdf_cmd<T: Send + 'static>(
    state: &PdfState,
    build_cmd: impl FnOnce(tokio::sync::oneshot::Sender<Result<T, AppError>>) -> PdfCommand,
) -> Result<T, AppError> {
    let (tx, rx) = tokio::sync::oneshot::channel();
    state
        .cmd_tx
        .send(build_cmd(tx))
        .map_err(|_| AppError::PdfEngine("PDF 渲染线程已关闭".into()))?;
    rx.await
        .map_err(|_| AppError::PdfEngine("渲染线程无响应".into()))?
}

#[tauri::command]
pub async fn open_pdf(
    file_path: String,
    state: State<'_, PdfState>,
) -> Result<PdfMetadata, AppError> {
    let path = Path::new(&file_path);
    if !path.exists() {
        return Err(AppError::Custom(format!("文件不存在: {}", file_path)));
    }
    if !path.is_file() {
        return Err(AppError::Custom(format!("不是文件: {}", file_path)));
    }

    let doc_id = engine::make_doc_id(&file_path);
    let path_buf = PathBuf::from(&file_path);

    // Send Open command to the dedicated render thread
    let (page_count, page_dimensions, outline) = send_pdf_cmd(&state, |reply| {
        PdfCommand::Open {
            doc_id: doc_id.clone(),
            path: path_buf,
            reply,
        }
    })
    .await?;

    // Store metadata in shared state (render thread keeps the actual doc handle)
    {
        let mut docs = state.documents.lock().map_err(|_| AppError::Lock)?;
        docs.insert(
            doc_id.clone(),
            LoadedPdf {
                path: Path::new(&file_path).to_path_buf(),
                page_count,
                page_dimensions: page_dimensions.clone(),
            },
        );
    }

    Ok(PdfMetadata {
        doc_id,
        page_count,
        page_dimensions,
        outline,
    })
}

#[tauri::command]
pub async fn close_pdf(
    doc_id: String,
    state: State<'_, PdfState>,
) -> Result<(), AppError> {
    // Remove metadata from shared state
    {
        let mut docs = state.documents.lock().map_err(|_| AppError::Lock)?;
        docs.remove(&doc_id);
    }

    // Tell render thread to drop the document handle
    state
        .cmd_tx
        .send(PdfCommand::Close { doc_id: doc_id.clone() })
        .ok();

    // Clean up cache files
    let cache_dir = state.cache_dir.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let prefix = format!("{}-", doc_id);
        if let Ok(entries) = std::fs::read_dir(&cache_dir) {
            for entry in entries.flatten() {
                if let Some(name) = entry.file_name().to_str() {
                    if name.starts_with(&prefix) {
                        std::fs::remove_file(entry.path()).ok();
                    }
                }
            }
        }
    })
    .await
    .ok();

    Ok(())
}
```

- [ ] **Step 4: Register module and commands**

In `src-tauri/src/commands.rs`, add:

```rust
pub(crate) mod cmd_pdf;
```

In `src-tauri/src/lib.rs`, add:

1. Module declaration at the top: `mod pdf;`
2. In `setup` closure, after existing `app.manage()` calls:

```rust
let app_data_dir = app.path().app_data_dir().expect("无法获取应用数据目录");
app.manage(pdf::engine::PdfState::new(&app_data_dir));
```

3. In `generate_handler![]`, add:

```rust
commands::cmd_pdf::open_pdf,
commands::cmd_pdf::close_pdf,
```

- [ ] **Step 5: Verify it compiles**

Run: `cargo check --manifest-path src-tauri/Cargo.toml`

Expected: Compiles without errors.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/pdf/ src-tauri/src/commands/cmd_pdf.rs src-tauri/src/commands.rs src-tauri/src/error.rs src-tauri/src/lib.rs
git commit -m "feat(pdf): add PDF engine core with open/close document lifecycle"
```

---

## Task 3: Rust Page Rendering — Render to WebP + Cache

**Files:**

- Create: `src-tauri/src/pdf/renderer.rs`
- Create: `src-tauri/src/pdf/cache.rs`
- Modify: `src-tauri/src/pdf/mod.rs`
- Modify: `src-tauri/src/commands/cmd_pdf.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Create render cache module**

Create `src-tauri/src/pdf/cache.rs`:

```rust
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

/// LRU-like cache tracking rendered page files on disk.
pub struct RenderCache {
    dir: PathBuf,
    /// Maps cache key → file size in bytes
    entries: Mutex<HashMap<String, u64>>,
    max_bytes: u64,
}

impl RenderCache {
    pub fn new(dir: PathBuf, max_bytes: u64) -> Self {
        std::fs::create_dir_all(&dir).ok();
        Self {
            dir,
            entries: Mutex::new(HashMap::new()),
            max_bytes,
        }
    }

    /// Returns the cache file path for a given key, or None if not cached.
    pub fn get(&self, key: &str) -> Option<PathBuf> {
        let entries = self.entries.lock().ok()?;
        if entries.contains_key(key) {
            let path = self.dir.join(format!("{}.webp", key));
            if path.exists() {
                return Some(path);
            }
        }
        None
    }

    /// Store a rendered page. Returns the file path.
    pub fn put(&self, key: &str, data: &[u8]) -> std::io::Result<PathBuf> {
        let path = self.dir.join(format!("{}.webp", key));
        std::fs::write(&path, data)?;

        if let Ok(mut entries) = self.entries.lock() {
            entries.insert(key.to_string(), data.len() as u64);
            self.evict_if_needed(&mut entries);
        }

        Ok(path)
    }

    /// Remove all entries for a given doc_id prefix.
    pub fn remove_doc(&self, doc_id: &str) {
        if let Ok(mut entries) = self.entries.lock() {
            let keys_to_remove: Vec<String> = entries
                .keys()
                .filter(|k| k.starts_with(doc_id))
                .cloned()
                .collect();
            for key in &keys_to_remove {
                entries.remove(key);
                let path = self.dir.join(format!("{}.webp", key));
                std::fs::remove_file(path).ok();
            }
        }
    }

    fn evict_if_needed(&self, entries: &mut HashMap<String, u64>) {
        let total: u64 = entries.values().sum();
        if total <= self.max_bytes {
            return;
        }
        // Simple eviction: remove oldest entries until under limit
        // (HashMap iteration order is arbitrary, which approximates random eviction)
        let mut to_remove = Vec::new();
        let mut running = total;
        for (key, size) in entries.iter() {
            if running <= self.max_bytes {
                break;
            }
            to_remove.push(key.clone());
            running -= size;
        }
        for key in &to_remove {
            entries.remove(key);
            let path = self.dir.join(format!("{}.webp", key));
            std::fs::remove_file(path).ok();
        }
    }

    pub fn cache_dir(&self) -> &Path {
        &self.dir
    }
}
```

- [ ] **Step 2: Create page renderer module**

Create `src-tauri/src/pdf/renderer.rs`:

```rust
use std::path::Path;

use pdfium_render::prelude::*;

use crate::error::AppError;

/// Render a single page from an already-loaded PdfDocument to WebP.
/// Called on the dedicated render thread — no need to reload PDFium or the document.
///
/// - `doc`: reference to the loaded PdfDocument (owned by render thread)
/// - `page_index`: 0-based page number
/// - `scale`: zoom multiplier (1.0 = 72 DPI, 2.0 = 144 DPI, etc.)
/// - `output_path`: where to write the WebP file
///
/// Returns (width_px, height_px) of the rendered image.
pub fn render_page_from_doc(
    doc: &PdfDocument,
    page_index: u32,
    scale: f32,
    output_path: &Path,
) -> Result<(u32, u32), AppError> {
    let page = doc.pages().get(page_index.min(65534) as u16).map_err(|e| {
        AppError::PdfRender(format!("获取第 {} 页失败: {}", page_index, e))
    })?;

    let width_px = (page.width().value * scale) as u32;
    let height_px = (page.height().value * scale) as u32;

    let bitmap = page
        .render_with_config(
            &PdfRenderConfig::new()
                .set_target_width(width_px as i32)
                .set_target_height(height_px as i32),
        )
        .map_err(|e| AppError::PdfRender(format!("渲染第 {} 页失败: {}", page_index, e)))?;

    let image = bitmap.as_image();
    let rgba = image.to_rgba8();
    let encoder = webp::Encoder::from_rgba(&rgba, width_px, height_px);
    let webp_data = encoder.encode(80.0);

    // Write to disk
    if let Some(parent) = output_path.parent() {
        std::fs::create_dir_all(parent).ok();
    }
    std::fs::write(output_path, &*webp_data)
        .map_err(|e| AppError::PdfRender(format!("写入缓存失败: {}", e)))?;

    Ok((width_px, height_px))
}
```

- [ ] **Step 3: Update mod.rs**

In `src-tauri/src/pdf/mod.rs`, add:

```rust
pub mod engine;
pub mod renderer;
pub mod cache;
```

- [ ] **Step 4: Add render_page command to cmd_pdf.rs**

Append to `src-tauri/src/commands/cmd_pdf.rs`:

```rust
#[derive(serde::Serialize)]
pub struct RenderResult {
    /// Asset protocol URL to the rendered WebP image
    pub asset_url: String,
    pub width: u32,
    pub height: u32,
}

#[tauri::command]
pub async fn render_pdf_page(
    doc_id: String,
    page_index: u32,
    scale: f32,
    state: State<'_, PdfState>,
) -> Result<RenderResult, AppError> {
    let cache_key = format!("{}-p{}-s{:.1}", doc_id, page_index, scale);
    let cache_dir = state.cache_dir.clone();
    let cached_path = cache_dir.join(format!("{}.webp", cache_key));

    // Check cache first
    if cached_path.exists() {
        let url = format!(
            "asset://localhost/{}",
            cached_path.to_str().unwrap_or_default().replace('\\', "/")
        );
        let (w, h) = {
            let docs = state.documents.lock().map_err(|_| AppError::Lock)?;
            let doc = docs.get(&doc_id).ok_or_else(|| {
                AppError::PdfRender("文档未打开".into())
            })?;
            let [pw, ph] = doc.page_dimensions[page_index as usize];
            ((pw * scale) as u32, (ph * scale) as u32)
        };
        return Ok(RenderResult { asset_url: url, width: w, height: h });
    }

    // Send render command to the dedicated render thread
    let (w, h) = send_pdf_cmd(&state, |reply| PdfCommand::RenderPage {
        doc_id: doc_id.clone(),
        page_index,
        scale,
        output_path: cached_path.clone(),
        reply,
    })
    .await?;

    let url = format!(
        "asset://localhost/{}",
        cached_path.to_str().unwrap_or_default().replace('\\', "/")
    );

    Ok(RenderResult { asset_url: url, width: w, height: h })
}
```

- [ ] **Step 5: Register new command in lib.rs**

Add to `generate_handler![]`:

```rust
commands::cmd_pdf::render_pdf_page,
```

- [ ] **Step 6: Verify compilation**

Run: `cargo check --manifest-path src-tauri/Cargo.toml`

Expected: Compiles without errors.

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/pdf/
git commit -m "feat(pdf): add page rendering to WebP with disk cache"
```

---

## Task 4: Rust Text Extraction with Word Coordinates

**Files:**

- Create: `src-tauri/src/pdf/text.rs`
- Modify: `src-tauri/src/pdf/mod.rs`
- Modify: `src-tauri/src/commands/cmd_pdf.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Create text extraction module**

Create `src-tauri/src/pdf/text.rs`:

```rust
use pdfium_render::prelude::*;

use crate::error::AppError;

#[derive(serde::Serialize, Clone)]
pub struct WordInfo {
    pub word: String,
    pub char_index: usize,
    /// Bounding rect normalized to 0-1 relative to page dimensions.
    pub rect: NormRect,
}

#[derive(serde::Serialize, Clone, Copy)]
pub struct NormRect {
    pub x: f32,
    pub y: f32,
    pub w: f32,
    pub h: f32,
}

#[derive(serde::Serialize, Clone)]
pub struct PageTextData {
    pub text: String,
    pub words: Vec<WordInfo>,
}

/// Extract text and per-word bounding boxes from an already-loaded document.
/// Called on the dedicated render thread.
/// Coordinates are normalized 0-1 relative to page size.
pub fn extract_page_text_from_doc(
    doc: &PdfDocument,
    page_index: u32,
) -> Result<PageTextData, AppError> {
    let page = doc.pages().get(page_index.min(65534) as u16).map_err(|e| {
        AppError::PdfRender(format!("获取第 {} 页失败: {}", page_index, e))
    })?;

    let page_w = page.width().value;
    let page_h = page.height().value;

    let text_page = page.text().map_err(|e| {
        AppError::PdfRender(format!("获取文本层失败: {}", e))
    })?;

    let full_text = text_page.all();

    // First pass: collect per-character bounding boxes into a Vec
    // indexed by character position in the text string
    let chars_collection = text_page.chars().map_err(|e| {
        AppError::PdfRender(format!("获取字符集合失败: {}", e))
    })?;

    let mut char_rects: Vec<Option<NormRect>> = Vec::with_capacity(full_text.len());
    for char_obj in chars_collection.iter() {
        let rect = char_obj.loose_bounds().map(|bounds| NormRect {
            x: bounds.left.value / page_w,
            // PDF coordinates: origin at bottom-left; convert to top-left origin
            y: 1.0 - bounds.top.value / page_h,
            w: (bounds.right.value - bounds.left.value) / page_w,
            h: (bounds.top.value - bounds.bottom.value) / page_h,
        });
        char_rects.push(rect);
    }

    // Second pass: group characters into words
    let mut words = Vec::new();
    let mut current_word = String::new();
    let mut word_start_idx: usize = 0;
    let mut word_char_rects: Vec<NormRect> = Vec::new();
    let mut char_position: usize = 0; // Index into char_rects

    for (byte_idx, ch) in full_text.char_indices() {
        if ch.is_whitespace() {
            if !current_word.is_empty() {
                if let Some(merged) = merge_rects(&word_char_rects) {
                    words.push(WordInfo {
                        word: current_word.clone(),
                        char_index: word_start_idx,
                        rect: merged,
                    });
                }
                current_word.clear();
                word_char_rects.clear();
            }
            word_start_idx = byte_idx + ch.len_utf8();
            char_position += 1;
            continue;
        }

        if current_word.is_empty() {
            word_start_idx = byte_idx;
        }
        current_word.push(ch);

        // Get this character's rect by position index
        if let Some(Some(rect)) = char_rects.get(char_position) {
            word_char_rects.push(*rect);
        }
        char_position += 1;
    }

    // Don't forget the last word
    if !current_word.is_empty() {
        if let Some(merged) = merge_rects(&word_char_rects) {
            words.push(WordInfo {
                word: current_word,
                char_index: word_start_idx,
                rect: merged,
            });
        }
    }

    Ok(PageTextData {
        text: full_text,
        words,
    })
}

pub fn merge_rects(rects: &[NormRect]) -> Option<NormRect> {
    if rects.is_empty() {
        return None;
    }
    let mut min_x = f32::MAX;
    let mut min_y = f32::MAX;
    let mut max_x = f32::MIN;
    let mut max_y = f32::MIN;
    for r in rects {
        min_x = min_x.min(r.x);
        min_y = min_y.min(r.y);
        max_x = max_x.max(r.x + r.w);
        max_y = max_y.max(r.y + r.h);
    }
    Some(NormRect {
        x: min_x,
        y: min_y,
        w: max_x - min_x,
        h: max_y - min_y,
    })
}
```

- [ ] **Step 2: Add get_page_text command to cmd_pdf.rs**

Append to `src-tauri/src/commands/cmd_pdf.rs`:

```rust
use crate::pdf::text::PageTextData;

#[tauri::command]
pub async fn get_pdf_page_text(
    doc_id: String,
    page_index: u32,
    state: State<'_, PdfState>,
) -> Result<PageTextData, AppError> {
    send_pdf_cmd(&state, |reply| PdfCommand::ExtractText {
        doc_id,
        page_index,
        reply,
    })
    .await
}
```

- [ ] **Step 3: Update mod.rs and register command**

In `src-tauri/src/pdf/mod.rs`, add: `pub mod text;`

In `src-tauri/src/lib.rs` `generate_handler![]`, add:

```rust
commands::cmd_pdf::get_pdf_page_text,
```

- [ ] **Step 4: Verify compilation**

Run: `cargo check --manifest-path src-tauri/Cargo.toml`

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/pdf/text.rs src-tauri/src/pdf/mod.rs src-tauri/src/commands/cmd_pdf.rs src-tauri/src/lib.rs
git commit -m "feat(pdf): add text extraction with word-level bounding boxes"
```

---

## Task 5: Rust Full-Text Search

**Files:**

- Create: `src-tauri/src/pdf/search.rs`
- Modify: `src-tauri/src/pdf/mod.rs`
- Modify: `src-tauri/src/commands/cmd_pdf.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Create search module**

Create `src-tauri/src/pdf/search.rs`:

```rust
use pdfium_render::prelude::*;

use crate::error::AppError;
use super::text::NormRect;

#[derive(serde::Serialize)]
pub struct SearchMatch {
    pub page: u32,
    pub rects: Vec<NormRect>,
}

/// Search all pages of an already-loaded document.
/// Called on the dedicated render thread.
/// Returns match positions with bounding rectangles from character bounds.
pub fn search_in_doc(
    doc: &PdfDocument,
    query: &str,
) -> Result<Vec<SearchMatch>, AppError> {
    if query.is_empty() {
        return Ok(Vec::new());
    }

    let query_lower = query.to_lowercase();
    let page_count = doc.pages().len() as u32;
    let mut results = Vec::new();

    for page_idx in 0..page_count.min(65535) {
        let page = match doc.pages().get(page_idx as u16) {
            Ok(p) => p,
            Err(_) => continue,
        };

        let page_w = page.width().value;
        let page_h = page.height().value;

        let text_page = match page.text() {
            Ok(t) => t,
            Err(_) => continue,
        };

        let full_text = text_page.all();
        let full_text_lower = full_text.to_lowercase();

        // Pre-collect character bounds for this page
        let char_bounds: Vec<Option<NormRect>> = match text_page.chars() {
            Ok(chars) => chars
                .iter()
                .map(|c| {
                    c.loose_bounds().map(|b| NormRect {
                        x: b.left.value / page_w,
                        y: 1.0 - b.top.value / page_h,
                        w: (b.right.value - b.left.value) / page_w,
                        h: (b.top.value - b.bottom.value) / page_h,
                    })
                })
                .collect(),
            Err(_) => continue,
        };

        // Find all occurrences and compute bounding rects from character bounds
        let mut search_start = 0;
        let mut page_rects = Vec::new();

        while let Some(pos) = full_text_lower[search_start..].find(&query_lower) {
            let abs_pos = search_start + pos;
            let end_pos = abs_pos + query_lower.len();

            // Merge character rects for the matched range
            let match_rects: Vec<NormRect> = (abs_pos..end_pos)
                .filter_map(|i| char_bounds.get(i).copied().flatten())
                .collect();

            if let Some(merged) = super::text::merge_rects(&match_rects) {
                page_rects.push(merged);
            }

            search_start = abs_pos + query_lower.len();
        }

        if !page_rects.is_empty() {
            results.push(SearchMatch {
                page: page_idx,
                rects: page_rects,
            });
        }
    }

    Ok(results)
}
```

- [ ] **Step 2: Add search command to cmd_pdf.rs**

Append to `src-tauri/src/commands/cmd_pdf.rs`:

```rust
use crate::pdf::search::SearchMatch;

#[tauri::command]
pub async fn search_pdf(
    doc_id: String,
    query: String,
    state: State<'_, PdfState>,
) -> Result<Vec<SearchMatch>, AppError> {
    send_pdf_cmd(&state, |reply| PdfCommand::Search {
        doc_id,
        query,
        reply,
    })
    .await
}
```

- [ ] **Step 3: Update mod.rs and register command**

In `src-tauri/src/pdf/mod.rs`, add: `pub mod search;`

In `src-tauri/src/lib.rs` `generate_handler![]`, add:

```rust
commands::cmd_pdf::search_pdf,
```

- [ ] **Step 4: Verify compilation and commit**

```bash
cargo check --manifest-path src-tauri/Cargo.toml
git add src-tauri/src/pdf/search.rs src-tauri/src/pdf/mod.rs src-tauri/src/commands/cmd_pdf.rs src-tauri/src/lib.rs
git commit -m "feat(pdf): add full-text search across PDF pages"
```

---

## Task 6: Rust Annotation Persistence

**Files:**

- Create: `src-tauri/src/pdf/annotations.rs`
- Modify: `src-tauri/src/pdf/mod.rs`
- Modify: `src-tauri/src/commands/cmd_pdf.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Create annotations module**

Create `src-tauri/src/pdf/annotations.rs`:

```rust
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::error::AppError;

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PdfAnnotation {
    pub id: String,
    pub page_number: u32,
    #[serde(rename = "type")]
    pub annotation_type: String, // "highlight" | "note" | "area"
    pub color: String,           // "yellow" | "red" | "green" | "blue" | "purple"
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text_ranges: Option<Vec<TextRange>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub area: Option<Rect>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub selected_text: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TextRange {
    pub start_offset: usize,
    pub end_offset: usize,
    pub rects: Vec<Rect>,
}

#[derive(Serialize, Deserialize, Clone, Copy)]
pub struct Rect {
    pub x: f32,
    pub y: f32,
    pub w: f32,
    pub h: f32,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnnotationFile {
    pub pdf_path: String,
    pub pdf_hash: String,
    pub annotations: Vec<PdfAnnotation>,
}

/// Compute identity hash: SHA-256 of (first 1KB + last 1KB + file size).
/// Only reads 2KB from disk regardless of PDF size.
pub fn compute_pdf_hash(path: &Path) -> Result<String, AppError> {
    use std::io::{Read, Seek, SeekFrom};

    let mut file = std::fs::File::open(path)
        .map_err(|e| AppError::PdfAnnotation(format!("读取 PDF 失败: {}", e)))?;
    let file_size = file.metadata()
        .map_err(|e| AppError::PdfAnnotation(format!("获取文件信息失败: {}", e)))?
        .len();

    let mut hasher = Sha256::new();

    // Read first 1KB
    let mut first_buf = vec![0u8; 1024.min(file_size as usize)];
    file.read_exact(&mut first_buf)
        .map_err(|e| AppError::PdfAnnotation(format!("读取失败: {}", e)))?;
    hasher.update(&first_buf);

    // Read last 1KB (if file > 1KB)
    if file_size > 1024 {
        let last_start = file_size.saturating_sub(1024);
        file.seek(SeekFrom::Start(last_start))
            .map_err(|e| AppError::PdfAnnotation(format!("定位失败: {}", e)))?;
        let mut last_buf = vec![0u8; (file_size - last_start) as usize];
        file.read_exact(&mut last_buf)
            .map_err(|e| AppError::PdfAnnotation(format!("读取失败: {}", e)))?;
        hasher.update(&last_buf);
    }

    hasher.update(file_size.to_le_bytes());

    Ok(format!("{:x}", hasher.finalize()))
}

/// Resolve the annotation file path for a given PDF.
/// Stored in {vault_root}/.nexus/pdf-annotations/{hash}.json
pub fn annotation_file_path(vault_root: &Path, pdf_path: &Path) -> PathBuf {
    let hash = {
        let mut hasher = Sha256::new();
        hasher.update(pdf_path.to_str().unwrap_or_default().as_bytes());
        format!("{:x}", hasher.finalize())
    };
    let short_hash = &hash[..16];

    let dir = vault_root.join(".nexus").join("pdf-annotations");
    std::fs::create_dir_all(&dir).ok();
    dir.join(format!("{}.json", short_hash))
}

/// Load annotations for a PDF file.
pub fn load_annotations(
    vault_root: &Path,
    pdf_path: &Path,
) -> Result<Vec<PdfAnnotation>, AppError> {
    let file = annotation_file_path(vault_root, pdf_path);
    if !file.exists() {
        return Ok(Vec::new());
    }

    let data = std::fs::read_to_string(&file)
        .map_err(|e| AppError::PdfAnnotation(format!("读取批注文件失败: {}", e)))?;
    let ann_file: AnnotationFile = serde_json::from_str(&data)
        .map_err(|e| AppError::PdfAnnotation(format!("解析批注文件失败: {}", e)))?;

    Ok(ann_file.annotations)
}

/// Save annotations for a PDF file.
pub fn save_annotations(
    vault_root: &Path,
    pdf_path: &Path,
    annotations: Vec<PdfAnnotation>,
) -> Result<(), AppError> {
    let pdf_hash = compute_pdf_hash(pdf_path)?;
    let relative_path = pdf_path
        .strip_prefix(vault_root)
        .unwrap_or(pdf_path)
        .to_str()
        .unwrap_or_default()
        .to_string();

    let ann_file = AnnotationFile {
        pdf_path: relative_path,
        pdf_hash,
        annotations,
    };

    let file = annotation_file_path(vault_root, pdf_path);
    let json = serde_json::to_string_pretty(&ann_file)
        .map_err(|e| AppError::PdfAnnotation(format!("序列化批注失败: {}", e)))?;
    std::fs::write(&file, json)
        .map_err(|e| AppError::PdfAnnotation(format!("写入批注文件失败: {}", e)))?;

    Ok(())
}
```

- [ ] **Step 2: Add annotation commands to cmd_pdf.rs**

Append to `src-tauri/src/commands/cmd_pdf.rs`:

```rust
use crate::pdf::annotations::{self, PdfAnnotation};

#[tauri::command]
pub async fn load_pdf_annotations(
    vault_path: String,
    file_path: String,
) -> Result<Vec<PdfAnnotation>, AppError> {
    let vault = std::path::PathBuf::from(&vault_path);
    let pdf = std::path::PathBuf::from(&file_path);

    tauri::async_runtime::spawn_blocking(move || {
        annotations::load_annotations(&vault, &pdf)
    })
    .await
    .map_err(|e| AppError::Custom(format!("线程执行错误: {}", e)))?
}

#[tauri::command]
pub async fn save_pdf_annotations(
    vault_path: String,
    file_path: String,
    annotations_data: Vec<PdfAnnotation>,
) -> Result<(), AppError> {
    let vault = std::path::PathBuf::from(&vault_path);
    let pdf = std::path::PathBuf::from(&file_path);

    tauri::async_runtime::spawn_blocking(move || {
        annotations::save_annotations(&vault, &pdf, annotations_data)
    })
    .await
    .map_err(|e| AppError::Custom(format!("线程执行错误: {}", e)))?
}
```

- [ ] **Step 3: Update mod.rs and register commands**

In `src-tauri/src/pdf/mod.rs`, add: `pub mod annotations;`

In `src-tauri/src/lib.rs` `generate_handler![]`, add:

```rust
commands::cmd_pdf::load_pdf_annotations,
commands::cmd_pdf::save_pdf_annotations,
```

- [ ] **Step 4: Verify compilation and commit**

```bash
cargo check --manifest-path src-tauri/Cargo.toml
git add src-tauri/src/pdf/annotations.rs src-tauri/src/pdf/mod.rs src-tauri/src/commands/cmd_pdf.rs src-tauri/src/lib.rs
git commit -m "feat(pdf): add annotation persistence with JSON storage"
```

---

## Task 7: Frontend TypeScript Types

**Files:**

- Create: `src/types/pdf.ts`

- [ ] **Step 1: Create PDF type definitions**

Create `src/types/pdf.ts`:

```typescript
// --- Rust IPC response types ---

export interface PdfMetadata {
  doc_id: string;
  page_count: number;
  /** Each entry: [width_pts, height_pts] in PDF points (72 DPI). */
  page_dimensions: [number, number][];
  outline: OutlineEntry[];
}

export interface OutlineEntry {
  title: string;
  page: number;
  children: OutlineEntry[];
}

export interface RenderResult {
  asset_url: string;
  width: number;
  height: number;
}

export interface PageTextData {
  text: string;
  words: WordInfo[];
}

export interface WordInfo {
  word: string;
  char_index: number;
  rect: NormRect;
}

export interface NormRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface SearchMatch {
  page: number;
  rects: NormRect[];
}

// --- Annotation types ---

export type AnnotationColor = "yellow" | "red" | "green" | "blue" | "purple";
export type AnnotationType = "highlight" | "note" | "area";

export interface TextRange {
  startOffset: number;
  endOffset: number;
  rects: NormRect[];
}

export interface PdfAnnotation {
  id: string;
  pageNumber: number;
  type: AnnotationType;
  color: AnnotationColor;
  textRanges?: TextRange[];
  area?: NormRect;
  content?: string;
  selectedText?: string;
  createdAt: string;
  updatedAt: string;
}

// --- Viewer state types ---

export type ZoomPreset =
  | "fit-width"
  | "fit-page"
  | number; // percentage, e.g. 100 = 100%

export interface PdfViewerState {
  docId: string | null;
  metadata: PdfMetadata | null;
  currentPage: number;
  zoom: number; // percentage, e.g. 150 = 150%
  searchQuery: string;
  searchResults: SearchMatch[];
  searchIndex: number; // current match index
  annotations: PdfAnnotation[];
  showSearch: boolean;
  showOutline: boolean;
  showAnnotationPanel: boolean;
}

/** Highlight color palette matching Obsidian. */
export const HIGHLIGHT_COLORS: Record<AnnotationColor, string> = {
  yellow: "rgba(255, 208, 0, 0.35)",
  red: "rgba(255, 69, 58, 0.35)",
  green: "rgba(50, 215, 75, 0.35)",
  blue: "rgba(10, 132, 255, 0.35)",
  purple: "rgba(191, 90, 242, 0.35)",
};
```

- [ ] **Step 2: Commit**

```bash
git add src/types/pdf.ts
git commit -m "feat(pdf): add TypeScript type definitions for PDF viewer"
```

---

## Task 8: Frontend usePdfRenderer Hook

**Files:**

- Create: `src/hooks/usePdfRenderer.ts`

- [ ] **Step 1: Create the hook**

Create `src/hooks/usePdfRenderer.ts`:

```typescript
import { invoke } from "@tauri-apps/api/core";
import { createContext, useCallback, useContext, useRef } from "react";
import type {
  PdfMetadata,
  RenderResult,
  PageTextData,
  SearchMatch,
  PdfAnnotation,
} from "../types/pdf";

/**
 * Context to share the active doc ID across all PDF viewer sub-components.
 * PdfViewer sets this; PdfPage, PdfTextLayer, etc. consume it.
 */
export const PdfDocContext = createContext<string | null>(null);

/**
 * Hook for the top-level PdfViewer — manages open/close lifecycle.
 */
export function usePdfLifecycle() {
  const docIdRef = useRef<string | null>(null);

  const openPdf = useCallback(async (filePath: string): Promise<PdfMetadata> => {
    const meta = await invoke<PdfMetadata>("open_pdf", { filePath });
    docIdRef.current = meta.doc_id;
    return meta;
  }, []);

  const closePdf = useCallback(async () => {
    if (docIdRef.current) {
      await invoke("close_pdf", { docId: docIdRef.current }).catch(() => {});
      docIdRef.current = null;
    }
  }, []);

  return { docIdRef, openPdf, closePdf };
}

/**
 * Hook for child components — uses PdfDocContext to get the doc ID.
 * Safe to call from PdfPage, PdfTextLayer, etc.
 */
export function usePdfRenderer() {
  const docId = useContext(PdfDocContext);

  const renderPage = useCallback(
    async (pageIndex: number, scale: number): Promise<RenderResult> => {
      if (!docId) throw new Error("PDF not open");
      return invoke<RenderResult>("render_pdf_page", {
        docId,
        pageIndex,
        scale,
      });
    },
    [docId],
  );

  const getPageText = useCallback(
    async (pageIndex: number): Promise<PageTextData> => {
      if (!docId) throw new Error("PDF not open");
      return invoke<PageTextData>("get_pdf_page_text", {
        docId,
        pageIndex,
      });
    },
    [docId],
  );

  const searchPdf = useCallback(
    async (query: string): Promise<SearchMatch[]> => {
      if (!docId) throw new Error("PDF not open");
      return invoke<SearchMatch[]>("search_pdf", {
        docId,
        query,
      });
    },
    [docId],
  );

  return { renderPage, getPageText, searchPdf };
}

/**
 * Hook for annotation persistence — does not depend on doc ID context.
 */
export function usePdfAnnotations() {
  const loadAnnotations = useCallback(
    async (vaultPath: string, filePath: string): Promise<PdfAnnotation[]> => {
      return invoke<PdfAnnotation[]>("load_pdf_annotations", {
        vaultPath,
        filePath,
      });
    },
    [],
  );

  const saveAnnotations = useCallback(
    async (
      vaultPath: string,
      filePath: string,
      annotations: PdfAnnotation[],
    ): Promise<void> => {
      await invoke("save_pdf_annotations", {
        vaultPath,
        filePath,
        annotationsData: annotations,
      });
    },
    [],
  );

  return { loadAnnotations, saveAnnotations };
}
```

**IMPORTANT:** The `PdfViewer` shell component wraps its children with `<PdfDocContext.Provider value={docIdRef.current}>` so that all child components (PdfPage, PdfTextLayer, etc.) can access the doc ID via `usePdfRenderer()`. This avoids each child creating its own hook instance with a separate (null) ref.
```

- [ ] **Step 2: Commit**

```bash
git add src/hooks/usePdfRenderer.ts
git commit -m "feat(pdf): add usePdfRenderer hook for Rust IPC"
```

---

## Task 9: Frontend PdfViewer Shell + PdfToolbar

**Files:**

- Create: `src/components/pdf-viewer/PdfViewer.tsx`
- Create: `src/components/pdf-viewer/PdfToolbar.tsx`
- Create: `src/components/pdf-viewer/pdf-viewer.css`

- [ ] **Step 1: Create pdf-viewer.css**

Create `src/components/pdf-viewer/pdf-viewer.css`:

```css
/* === Container === */
.pdf-viewer {
  position: relative;
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--workspace-bg);
  overflow: hidden;
}

/* === Toolbar === */
.pdf-toolbar {
  position: absolute;
  top: 8px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 20;
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 4px 8px;
  background: rgba(24, 31, 44, 0.7);
  border: 0.5px solid var(--panel-border);
  border-radius: 8px;
  -webkit-backdrop-filter: blur(18px) saturate(1.3);
  backdrop-filter: blur(18px) saturate(1.3);
  transition: opacity 0.3s ease;
  user-select: none;
}

.pdf-toolbar.hidden {
  opacity: 0;
  pointer-events: none;
}

.pdf-toolbar-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: none;
  border-radius: 5px;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  font-size: 13px;
  transition: background 0.15s;
}

.pdf-toolbar-btn:hover {
  background: var(--accent-hover);
  color: var(--text-primary);
}

.pdf-toolbar-btn.active {
  background: var(--accent-soft);
  color: var(--accent);
}

.pdf-toolbar-separator {
  width: 1px;
  height: 18px;
  margin: 0 4px;
  background: var(--panel-border);
}

.pdf-toolbar-page-input {
  width: 40px;
  height: 24px;
  padding: 0 4px;
  border: 0.5px solid var(--panel-border);
  border-radius: 4px;
  background: rgba(0, 0, 0, 0.2);
  color: var(--text-primary);
  font-size: 12px;
  text-align: center;
  outline: none;
}

.pdf-toolbar-page-input:focus {
  border-color: var(--accent);
}

.pdf-toolbar-text {
  font-size: 12px;
  color: var(--text-tertiary);
  white-space: nowrap;
}

.pdf-toolbar-zoom-text {
  font-size: 12px;
  color: var(--text-secondary);
  min-width: 36px;
  text-align: center;
}

/* === Page container === */
.pdf-page-container {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 40px 0 24px;
  gap: 8px;
  scroll-behavior: smooth;
}

/* === Single page === */
.pdf-page {
  position: relative;
  flex-shrink: 0;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
}

.pdf-page-canvas {
  display: block;
}

.pdf-page-placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--subtle-surface);
  color: var(--text-quaternary);
  font-size: 14px;
}

/* === Text layer === */
.pdf-text-layer {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  overflow: hidden;
  line-height: 1;
}

.pdf-text-layer span {
  position: absolute;
  color: transparent;
  white-space: pre;
  cursor: text;
}

.pdf-text-layer ::selection {
  background: rgba(10, 132, 255, 0.3);
}

/* === Annotation layer === */
.pdf-annotation-layer {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
}

.pdf-annotation-layer .annotation-highlight {
  position: absolute;
  pointer-events: auto;
  cursor: pointer;
  border-radius: 2px;
  transition: opacity 0.15s;
}

.pdf-annotation-layer .annotation-highlight:hover {
  opacity: 0.8;
}

/* === Floating action bar === */
.pdf-selection-toolbar {
  position: absolute;
  z-index: 30;
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 4px 6px;
  background: rgba(24, 31, 44, 0.9);
  border: 0.5px solid var(--panel-border);
  border-radius: 8px;
  backdrop-filter: blur(12px);
  animation: fadeIn 0.15s ease;
}

.pdf-color-btn {
  width: 20px;
  height: 20px;
  border: 2px solid transparent;
  border-radius: 50%;
  cursor: pointer;
  transition: transform 0.1s;
}

.pdf-color-btn:hover {
  transform: scale(1.2);
}

/* === Search bar === */
.pdf-search-bar {
  position: absolute;
  top: 48px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 20;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  background: rgba(24, 31, 44, 0.85);
  border: 0.5px solid var(--panel-border);
  border-radius: 8px;
  backdrop-filter: blur(18px) saturate(1.3);
  animation: fadeIn 0.2s ease;
}

.pdf-search-input {
  width: 200px;
  height: 26px;
  padding: 0 8px;
  border: 0.5px solid var(--panel-border);
  border-radius: 4px;
  background: rgba(0, 0, 0, 0.3);
  color: var(--text-primary);
  font-size: 13px;
  outline: none;
}

.pdf-search-input:focus {
  border-color: var(--accent);
}

/* === Annotation panel === */
.pdf-annotation-panel {
  position: absolute;
  top: 0;
  right: 0;
  width: 280px;
  height: 100%;
  background: var(--panel-bg);
  border-left: 0.5px solid var(--panel-border);
  overflow-y: auto;
  z-index: 10;
  animation: slideInRight 0.25s ease;
}

@keyframes slideInRight {
  from {
    transform: translateX(100%);
    opacity: 0;
  }
  to {
    transform: translateX(0);
    opacity: 1;
  }
}

.pdf-annotation-panel-header {
  padding: 12px 16px;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-secondary);
  border-bottom: 0.5px solid var(--panel-border);
}

.pdf-annotation-item {
  padding: 10px 16px;
  border-bottom: 0.5px solid var(--panel-border);
  cursor: pointer;
  transition: background 0.15s;
}

.pdf-annotation-item:hover {
  background: var(--subtle-surface);
}

.pdf-annotation-item-color {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  display: inline-block;
  margin-right: 6px;
}

.pdf-annotation-item-text {
  font-size: 12px;
  color: var(--text-tertiary);
  margin-top: 4px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* === Outline panel === */
.pdf-outline-panel {
  position: absolute;
  top: 48px;
  left: 8px;
  width: 240px;
  max-height: calc(100% - 64px);
  background: rgba(24, 31, 44, 0.9);
  border: 0.5px solid var(--panel-border);
  border-radius: 8px;
  backdrop-filter: blur(18px);
  overflow-y: auto;
  z-index: 15;
  animation: fadeIn 0.2s ease;
}

.pdf-outline-item {
  padding: 6px 12px;
  font-size: 13px;
  color: var(--text-secondary);
  cursor: pointer;
  transition: background 0.15s;
}

.pdf-outline-item:hover {
  background: var(--accent-hover);
  color: var(--text-primary);
}

/* === Animations === */
@keyframes fadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}
```

- [ ] **Step 2: Create PdfToolbar component**

Create `src/components/pdf-viewer/PdfToolbar.tsx`:

```tsx
import { useState, useCallback, useRef } from "react";
import type { PdfMetadata } from "../../types/pdf";

interface PdfToolbarProps {
  metadata: PdfMetadata;
  currentPage: number;
  zoom: number;
  showOutline: boolean;
  visible: boolean;
  onPageChange: (page: number) => void;
  onZoomChange: (zoom: number) => void;
  onToggleSearch: () => void;
  onToggleOutline: () => void;
  onToggleAnnotations: () => void;
}

export default function PdfToolbar({
  metadata,
  currentPage,
  zoom,
  showOutline,
  visible,
  onPageChange,
  onZoomChange,
  onToggleSearch,
  onToggleOutline,
  onToggleAnnotations,
}: PdfToolbarProps) {
  const [pageInput, setPageInput] = useState("");
  const [editingPage, setEditingPage] = useState(false);

  const handlePageInputSubmit = useCallback(() => {
    const page = parseInt(pageInput, 10);
    if (page >= 1 && page <= metadata.page_count) {
      onPageChange(page - 1); // 0-indexed
    }
    setEditingPage(false);
    setPageInput("");
  }, [pageInput, metadata.page_count, onPageChange]);

  return (
    <div className={`pdf-toolbar ${visible ? "" : "hidden"}`}>
      {/* TOC */}
      <button
        className={`pdf-toolbar-btn ${showOutline ? "active" : ""}`}
        onClick={onToggleOutline}
        title="目录"
      >
        ☰
      </button>

      <div className="pdf-toolbar-separator" />

      {/* Zoom */}
      <button
        className="pdf-toolbar-btn"
        onClick={() => onZoomChange(Math.max(25, zoom - 25))}
        title="缩小"
      >
        −
      </button>
      <button
        className="pdf-toolbar-btn"
        onClick={() => onZoomChange(Math.min(400, zoom + 25))}
        title="放大"
      >
        +
      </button>
      <span className="pdf-toolbar-zoom-text">{zoom}%</span>

      <div className="pdf-toolbar-separator" />

      {/* Search */}
      <button
        className="pdf-toolbar-btn"
        onClick={onToggleSearch}
        title="搜索 (Ctrl+F)"
      >
        🔍
      </button>

      <div className="pdf-toolbar-separator" />

      {/* Page navigation */}
      <button
        className="pdf-toolbar-btn"
        onClick={() => onPageChange(Math.max(0, currentPage - 1))}
        disabled={currentPage <= 0}
        title="上一页"
      >
        ◀
      </button>

      {editingPage ? (
        <input
          className="pdf-toolbar-page-input"
          autoFocus
          value={pageInput}
          onChange={e => setPageInput(e.target.value)}
          onKeyDown={e => {
            if (e.key === "Enter") handlePageInputSubmit();
            if (e.key === "Escape") setEditingPage(false);
          }}
          onBlur={() => setEditingPage(false)}
        />
      ) : (
        <span
          className="pdf-toolbar-text"
          onClick={() => {
            setEditingPage(true);
            setPageInput(String(currentPage + 1));
          }}
          style={{ cursor: "pointer" }}
        >
          {currentPage + 1} / {metadata.page_count}
        </span>
      )}

      <button
        className="pdf-toolbar-btn"
        onClick={() =>
          onPageChange(Math.min(metadata.page_count - 1, currentPage + 1))
        }
        disabled={currentPage >= metadata.page_count - 1}
        title="下一页"
      >
        ▶
      </button>

      <div className="pdf-toolbar-separator" />

      {/* Annotation panel toggle */}
      <button
        className="pdf-toolbar-btn"
        onClick={onToggleAnnotations}
        title="批注"
      >
        📝
      </button>
    </div>
  );
}
```

- [ ] **Step 3: Create PdfViewer shell component**

Create `src/components/pdf-viewer/PdfViewer.tsx`:

```tsx
import { useState, useEffect, useCallback, useRef } from "react";
import { usePdfLifecycle, usePdfAnnotations, PdfDocContext } from "../../hooks/usePdfRenderer";
import PdfToolbar from "./PdfToolbar";
import type { NoteInfo } from "../../types";
import type { PdfMetadata, PdfAnnotation } from "../../types/pdf";
import "./pdf-viewer.css";

interface PdfViewerProps {
  note: NoteInfo;
  vaultPath?: string;
}

export default function PdfViewer({ note, vaultPath }: PdfViewerProps) {
  const { docIdRef, openPdf, closePdf } = usePdfLifecycle();
  const { loadAnnotations, saveAnnotations } = usePdfAnnotations();
  const [metadata, setMetadata] = useState<PdfMetadata | null>(null);
  const [currentPage, setCurrentPage] = useState(0);
  const [zoom, setZoom] = useState(100);
  const [error, setError] = useState<string | null>(null);
  const [showSearch, setShowSearch] = useState(false);
  const [showOutline, setShowOutline] = useState(false);
  const [showAnnotationPanel, setShowAnnotationPanel] = useState(false);
  const [annotations, setAnnotations] = useState<PdfAnnotation[]>([]);
  const [toolbarVisible, setToolbarVisible] = useState(true);

  const containerRef = useRef<HTMLDivElement>(null);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout>>();

  // Open PDF on mount
  useEffect(() => {
    let cancelled = false;
    setError(null);

    openPdf(note.path)
      .then(meta => {
        if (!cancelled) setMetadata(meta);
      })
      .catch(err => {
        if (!cancelled) setError(String(err));
      });

    // Load annotations
    if (vaultPath) {
      loadAnnotations(vaultPath, note.path)
        .then(anns => {
          if (!cancelled) setAnnotations(anns);
        })
        .catch(() => {}); // Annotations are optional
    }

    return () => {
      cancelled = true;
      closePdf();
    };
  }, [note.path, vaultPath, openPdf, closePdf, loadAnnotations]);

  // Toolbar auto-hide
  const resetHideTimer = useCallback(() => {
    setToolbarVisible(true);
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    hideTimerRef.current = setTimeout(() => setToolbarVisible(false), 3000);
  }, []);

  useEffect(() => {
    resetHideTimer();
    return () => {
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    };
  }, [resetHideTimer]);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === "f") {
        e.preventDefault();
        setShowSearch(s => !s);
      }
      if (e.key === "Escape") {
        setShowSearch(false);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const handlePageChange = useCallback((page: number) => {
    setCurrentPage(page);
    // TODO: scroll to page in PdfPageContainer
  }, []);

  if (error) {
    return (
      <div className="pdf-viewer" style={{ alignItems: "center", justifyContent: "center", display: "flex" }}>
        <div style={{ textAlign: "center", color: "var(--text-tertiary)" }}>
          <p style={{ marginBottom: 8 }}>无法打开此 PDF</p>
          <p style={{ fontSize: 12, opacity: 0.7 }}>{error}</p>
        </div>
      </div>
    );
  }

  if (!metadata) {
    return (
      <div className="pdf-viewer" style={{ alignItems: "center", justifyContent: "center", display: "flex" }}>
        <span style={{ color: "var(--text-quaternary)" }}>加载中...</span>
      </div>
    );
  }

  return (
    <PdfDocContext.Provider value={docIdRef.current}>
      <div
        className="pdf-viewer"
        ref={containerRef}
        onMouseMove={resetHideTimer}
      >
        <PdfToolbar
          metadata={metadata}
          currentPage={currentPage}
          zoom={zoom}
          showOutline={showOutline}
          visible={toolbarVisible}
          onPageChange={handlePageChange}
          onZoomChange={setZoom}
          onToggleSearch={() => setShowSearch(s => !s)}
          onToggleOutline={() => setShowOutline(s => !s)}
          onToggleAnnotations={() => setShowAnnotationPanel(s => !s)}
        />

        {/* Page container — will be built in Task 10 */}
        <div className="pdf-page-container">
          {Array.from({ length: metadata.page_count }, (_, i) => {
            const [w, h] = metadata.page_dimensions[i];
            const scale = zoom / 100;
            return (
              <div
                key={i}
                className="pdf-page pdf-page-placeholder"
                style={{
                  width: w * scale,
                  height: h * scale,
                }}
              >
                {i + 1}
              </div>
            );
          })}
        </div>
      </div>
    </PdfDocContext.Provider>
  );
}
```

- [ ] **Step 4: Commit**

```bash
git add src/components/pdf-viewer/
git commit -m "feat(pdf): add PdfViewer shell with toolbar and CSS"
```

---

## Task 10: Integrate PdfViewer into ActiveNoteContent

**Files:**

- Modify: `src/components/app/ActiveNoteContent.tsx`
- Modify: `src/hooks/useActiveNoteContent.ts`

- [ ] **Step 1: Add lazy import for PdfViewer in ActiveNoteContent.tsx**

At the top of `ActiveNoteContent.tsx`, add alongside other lazy imports:

```typescript
const PdfViewer = lazy(() => import("../pdf-viewer/PdfViewer"));
```

- [ ] **Step 2: Replace the PDF case in the switch statement**

In the `switch (activeCategory)` block in `ActiveNoteContent.tsx`, change the `"pdf"` case from:

```typescript
case "pdf":
  return <MediaViewer category="pdf" note={activeNote} binaryPreviewUrl={binaryPreviewUrl} />;
```

to:

```typescript
case "pdf":
  return <PdfViewer note={activeNote} />;
```

Note: `vaultPath` will be threaded through later when annotation support is wired up. For now the viewer opens PDFs without annotations.

- [ ] **Step 3: Update useActiveNoteContent.ts — skip binary preview for PDF**

In `useActiveNoteContent.ts`, in the `loadActiveNoteContent` function, the current code loads binary preview for PDFs. Since the new PdfViewer handles its own loading via Rust, change the `if (category === "image" || category === "pdf")` block to only do binary preview for images:

```typescript
if (category === "image") {
  setNoteContent("");
  setLiveContent("");
  await loadBinaryPreview(activeNote);
  return;
}

if (category === "pdf") {
  setNoteContent("");
  // PDF viewer handles its own loading — still extract text for AI indexing
  try {
    const indexed = await invoke<string>("read_note_indexed_content", {
      noteId: activeNote.id,
    });
    if (!cancelled) {
      setLiveContent(indexed);
    }
  } catch {
    if (!cancelled) {
      setLiveContent("");
    }
  }
  return;
}
```

- [ ] **Step 4: Verify the app loads and opens a PDF with the new viewer**

Run: `npm run dev` (in the root directory)

Expected: Opening a PDF shows the new viewer with placeholder pages, toolbar visible at top. No rendering of actual page content yet (that comes in Task 11).

- [ ] **Step 5: Commit**

```bash
git add src/components/app/ActiveNoteContent.tsx src/hooks/useActiveNoteContent.ts
git commit -m "feat(pdf): integrate PdfViewer into ActiveNoteContent routing"
```

---

## Task 11: PdfPage Component — Rendered Page Display

**Files:**

- Create: `src/components/pdf-viewer/PdfPage.tsx`
- Modify: `src/components/pdf-viewer/PdfViewer.tsx`

- [ ] **Step 1: Create PdfPage component**

Create `src/components/pdf-viewer/PdfPage.tsx`:

```tsx
import { useState, useEffect, useRef, memo } from "react";
import { usePdfRenderer } from "../../hooks/usePdfRenderer";

interface PdfPageProps {
  pageIndex: number;
  widthPts: number;
  heightPts: number;
  zoom: number; // percentage
  isVisible: boolean;
}

const PdfPage = memo(function PdfPage({
  pageIndex,
  widthPts,
  heightPts,
  zoom,
  isVisible,
}: PdfPageProps) {
  const { renderPage } = usePdfRenderer();
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const mountedRef = useRef(true);

  const scale = (zoom / 100) * window.devicePixelRatio;
  const displayWidth = widthPts * (zoom / 100);
  const displayHeight = heightPts * (zoom / 100);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!isVisible) return;

    let cancelled = false;
    setLoading(true);

    renderPage(pageIndex, scale)
      .then(result => {
        if (!cancelled && mountedRef.current) {
          setImageUrl(result.asset_url);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled && mountedRef.current) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [pageIndex, scale, isVisible, renderPage]);

  return (
    <div
      className="pdf-page"
      style={{ width: displayWidth, height: displayHeight }}
      data-page={pageIndex}
    >
      {imageUrl ? (
        <img
          className="pdf-page-canvas"
          src={imageUrl}
          width={displayWidth}
          height={displayHeight}
          alt={`Page ${pageIndex + 1}`}
          draggable={false}
        />
      ) : (
        <div
          className="pdf-page-placeholder"
          style={{ width: displayWidth, height: displayHeight }}
        >
          {loading ? "..." : pageIndex + 1}
        </div>
      )}
    </div>
  );
});

export default PdfPage;
```

- [ ] **Step 2: Update PdfViewer to use PdfPage with visibility detection**

In `src/components/pdf-viewer/PdfViewer.tsx`, replace the page container section with:

```tsx
import PdfPage from "./PdfPage";

// Inside the component, add visibility tracking:
const [visiblePages, setVisiblePages] = useState<Set<number>>(new Set());
const pageRefs = useRef<Map<number, HTMLDivElement>>(new Map());

// IntersectionObserver for virtual scrolling
useEffect(() => {
  if (!metadata) return;

  const observer = new IntersectionObserver(
    entries => {
      setVisiblePages(prev => {
        const next = new Set(prev);
        for (const entry of entries) {
          const page = Number(entry.target.getAttribute("data-page-wrapper"));
          if (entry.isIntersecting) {
            next.add(page);
          } else {
            next.delete(page);
          }
        }
        return next;
      });
    },
    {
      root: containerRef.current,
      rootMargin: "200% 0px", // Pre-render ±2 viewport heights
    },
  );

  pageRefs.current.forEach(el => observer.observe(el));

  return () => observer.disconnect();
}, [metadata]);

// Replace the placeholder page container with:
<div className="pdf-page-container" ref={containerRef}>
  {Array.from({ length: metadata.page_count }, (_, i) => {
    const [w, h] = metadata.page_dimensions[i];
    const isVisible = visiblePages.has(i);
    return (
      <div
        key={i}
        data-page-wrapper={i}
        ref={el => {
          if (el) pageRefs.current.set(i, el);
          else pageRefs.current.delete(i);
        }}
      >
        <PdfPage
          pageIndex={i}
          widthPts={w}
          heightPts={h}
          zoom={zoom}
          isVisible={isVisible}
        />
      </div>
    );
  })}
</div>
```

- [ ] **Step 3: Verify rendered pages display**

Run: `npm run dev`

Expected: Opening a PDF shows actual rendered page images. Scrolling through pages renders them on-demand. Toolbar zoom controls resize pages.

- [ ] **Step 4: Commit**

```bash
git add src/components/pdf-viewer/PdfPage.tsx src/components/pdf-viewer/PdfViewer.tsx
git commit -m "feat(pdf): add PdfPage with on-demand rendering and virtual scrolling"
```

---

## Task 12: PdfTextLayer — Text Selection

**Files:**

- Create: `src/components/pdf-viewer/PdfTextLayer.tsx`
- Modify: `src/components/pdf-viewer/PdfPage.tsx`

- [ ] **Step 1: Create PdfTextLayer component**

Create `src/components/pdf-viewer/PdfTextLayer.tsx`:

```tsx
import { useState, useEffect, memo } from "react";
import { usePdfRenderer } from "../../hooks/usePdfRenderer";
import type { PageTextData } from "../../types/pdf";

interface PdfTextLayerProps {
  pageIndex: number;
  isVisible: boolean;
  displayWidth: number;
  displayHeight: number;
}

const PdfTextLayer = memo(function PdfTextLayer({
  pageIndex,
  isVisible,
  displayWidth,
  displayHeight,
}: PdfTextLayerProps) {
  const { getPageText } = usePdfRenderer();
  const [textData, setTextData] = useState<PageTextData | null>(null);

  useEffect(() => {
    if (!isVisible) return;

    let cancelled = false;
    getPageText(pageIndex)
      .then(data => {
        if (!cancelled) setTextData(data);
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [pageIndex, isVisible, getPageText]);

  if (!textData) return null;

  return (
    <div className="pdf-text-layer">
      {textData.words.map((word, i) => (
        <span
          key={i}
          style={{
            left: `${word.rect.x * 100}%`,
            top: `${word.rect.y * 100}%`,
            width: `${word.rect.w * 100}%`,
            height: `${word.rect.h * 100}%`,
            fontSize: `${word.rect.h * displayHeight * 0.9}px`,
          }}
        >
          {word.word}
        </span>
      ))}
    </div>
  );
});

export default PdfTextLayer;
```

- [ ] **Step 2: Add PdfTextLayer to PdfPage**

In `PdfPage.tsx`, import and render the text layer on top of the image:

```tsx
import PdfTextLayer from "./PdfTextLayer";

// Inside the component's return, after the <img> or placeholder:
{imageUrl && (
  <PdfTextLayer
    pageIndex={pageIndex}
    isVisible={isVisible}
    displayWidth={displayWidth}
    displayHeight={displayHeight}
  />
)}
```

- [ ] **Step 3: Verify text selection works**

Run: `npm run dev`

Expected: Can select text in the PDF by clicking and dragging. Selected text is highlightable and copyable via Ctrl+C.

- [ ] **Step 4: Commit**

```bash
git add src/components/pdf-viewer/PdfTextLayer.tsx src/components/pdf-viewer/PdfPage.tsx
git commit -m "feat(pdf): add text selection layer with word-level positioning"
```

---

## Task 13: PdfAnnotationLayer — Highlights + Selection Toolbar

**Files:**

- Create: `src/components/pdf-viewer/PdfAnnotationLayer.tsx`
- Create: `src/components/pdf-viewer/PdfSelectionToolbar.tsx`
- Modify: `src/components/pdf-viewer/PdfPage.tsx`
- Modify: `src/components/pdf-viewer/PdfViewer.tsx`

- [ ] **Step 1: Create PdfSelectionToolbar**

Create `src/components/pdf-viewer/PdfSelectionToolbar.tsx`:

```tsx
import { HIGHLIGHT_COLORS } from "../../types/pdf";
import type { AnnotationColor } from "../../types/pdf";

interface PdfSelectionToolbarProps {
  x: number;
  y: number;
  onHighlight: (color: AnnotationColor) => void;
  onAddNote: () => void;
  onCopy: () => void;
}

const COLORS: AnnotationColor[] = ["yellow", "red", "green", "blue", "purple"];

const COLOR_SOLID: Record<AnnotationColor, string> = {
  yellow: "#FFD000",
  red: "#FF453A",
  green: "#32D74B",
  blue: "#0A84FF",
  purple: "#BF5AF2",
};

export default function PdfSelectionToolbar({
  x,
  y,
  onHighlight,
  onAddNote,
  onCopy,
}: PdfSelectionToolbarProps) {
  return (
    <div
      className="pdf-selection-toolbar"
      style={{ left: x, top: y - 40 }}
    >
      {COLORS.map(color => (
        <button
          key={color}
          className="pdf-color-btn"
          style={{ background: COLOR_SOLID[color] }}
          onClick={() => onHighlight(color)}
          title={color}
        />
      ))}
      <div className="pdf-toolbar-separator" />
      <button className="pdf-toolbar-btn" onClick={onAddNote} title="批注">
        📝
      </button>
      <button className="pdf-toolbar-btn" onClick={onCopy} title="复制">
        📋
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Create PdfAnnotationLayer**

Create `src/components/pdf-viewer/PdfAnnotationLayer.tsx`:

```tsx
import { memo } from "react";
import { HIGHLIGHT_COLORS } from "../../types/pdf";
import type { PdfAnnotation } from "../../types/pdf";

interface PdfAnnotationLayerProps {
  annotations: PdfAnnotation[];
  pageIndex: number;
  onAnnotationClick?: (annotation: PdfAnnotation) => void;
}

const PdfAnnotationLayer = memo(function PdfAnnotationLayer({
  annotations,
  pageIndex,
  onAnnotationClick,
}: PdfAnnotationLayerProps) {
  const pageAnnotations = annotations.filter(a => a.pageNumber === pageIndex);

  return (
    <div className="pdf-annotation-layer">
      {pageAnnotations.map(ann => {
        if (ann.type === "area" && ann.area) {
          return (
            <div
              key={ann.id}
              className="annotation-highlight"
              style={{
                left: `${ann.area.x * 100}%`,
                top: `${ann.area.y * 100}%`,
                width: `${ann.area.w * 100}%`,
                height: `${ann.area.h * 100}%`,
                background: HIGHLIGHT_COLORS[ann.color],
                border: `1px dashed ${HIGHLIGHT_COLORS[ann.color].replace("0.35", "0.7")}`,
              }}
              onClick={() => onAnnotationClick?.(ann)}
            />
          );
        }

        // Text highlights
        if (ann.textRanges) {
          return ann.textRanges.map((range, ri) =>
            range.rects.map((rect, rj) => (
              <div
                key={`${ann.id}-${ri}-${rj}`}
                className="annotation-highlight"
                style={{
                  left: `${rect.x * 100}%`,
                  top: `${rect.y * 100}%`,
                  width: `${rect.w * 100}%`,
                  height: `${rect.h * 100}%`,
                  background: HIGHLIGHT_COLORS[ann.color],
                }}
                onClick={() => onAnnotationClick?.(ann)}
              />
            )),
          );
        }

        return null;
      })}
    </div>
  );
});

export default PdfAnnotationLayer;
```

- [ ] **Step 3: Wire annotation layer into PdfPage**

In `PdfPage.tsx`, add props for annotations and import the layer:

```tsx
import PdfAnnotationLayer from "./PdfAnnotationLayer";

// Add to PdfPageProps:
annotations: PdfAnnotation[];
onAnnotationClick?: (annotation: PdfAnnotation) => void;

// Inside the return, after PdfTextLayer:
<PdfAnnotationLayer
  annotations={annotations}
  pageIndex={pageIndex}
  onAnnotationClick={onAnnotationClick}
/>
```

- [ ] **Step 4: Pass annotations from PdfViewer down to PdfPage**

In `PdfViewer.tsx`, pass `annotations` and callback to each `PdfPage`:

```tsx
<PdfPage
  pageIndex={i}
  widthPts={w}
  heightPts={h}
  zoom={zoom}
  isVisible={isVisible}
  annotations={annotations}
/>
```

- [ ] **Step 5: Verify annotation highlights render**

Run: `npm run dev`

Expected: If there are saved annotations, they render as colored overlays on the PDF pages.

- [ ] **Step 6: Commit**

```bash
git add src/components/pdf-viewer/PdfAnnotationLayer.tsx src/components/pdf-viewer/PdfSelectionToolbar.tsx src/components/pdf-viewer/PdfPage.tsx src/components/pdf-viewer/PdfViewer.tsx
git commit -m "feat(pdf): add annotation layer with highlight rendering and selection toolbar"
```

---

## Task 14: PdfSearchBar Component

**Files:**

- Create: `src/components/pdf-viewer/PdfSearchBar.tsx`
- Modify: `src/components/pdf-viewer/PdfViewer.tsx`

- [ ] **Step 1: Create PdfSearchBar**

Create `src/components/pdf-viewer/PdfSearchBar.tsx`:

```tsx
import { useState, useCallback, useEffect, useRef } from "react";
import type { SearchMatch } from "../../types/pdf";

interface PdfSearchBarProps {
  onSearch: (query: string) => Promise<SearchMatch[]>;
  onNavigate: (page: number) => void;
  onClose: () => void;
}

export default function PdfSearchBar({
  onSearch,
  onNavigate,
  onClose,
}: PdfSearchBarProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchMatch[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [totalMatches, setTotalMatches] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const doSearch = useCallback(
    async (q: string) => {
      if (!q.trim()) {
        setResults([]);
        setTotalMatches(0);
        setCurrentIndex(0);
        return;
      }
      const matches = await onSearch(q);
      setResults(matches);
      setTotalMatches(matches.reduce((sum, m) => sum + m.rects.length, 0));
      setCurrentIndex(0);
      if (matches.length > 0) {
        onNavigate(matches[0].page);
      }
    },
    [onSearch, onNavigate],
  );

  const handleInput = useCallback(
    (value: string) => {
      setQuery(value);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => doSearch(value), 300);
    },
    [doSearch],
  );

  const navigateNext = useCallback(() => {
    if (results.length === 0) return;
    const next = (currentIndex + 1) % results.length;
    setCurrentIndex(next);
    onNavigate(results[next].page);
  }, [results, currentIndex, onNavigate]);

  const navigatePrev = useCallback(() => {
    if (results.length === 0) return;
    const prev = (currentIndex - 1 + results.length) % results.length;
    setCurrentIndex(prev);
    onNavigate(results[prev].page);
  }, [results, currentIndex, onNavigate]);

  return (
    <div className="pdf-search-bar">
      <input
        ref={inputRef}
        className="pdf-search-input"
        placeholder="搜索..."
        value={query}
        onChange={e => handleInput(e.target.value)}
        onKeyDown={e => {
          if (e.key === "Enter") {
            e.shiftKey ? navigatePrev() : navigateNext();
          }
          if (e.key === "Escape") onClose();
        }}
      />
      <span className="pdf-toolbar-text">
        {totalMatches > 0
          ? `${currentIndex + 1} / ${results.length} 页`
          : query
            ? "无结果"
            : ""}
      </span>
      <button className="pdf-toolbar-btn" onClick={navigatePrev} title="上一个">
        ▲
      </button>
      <button className="pdf-toolbar-btn" onClick={navigateNext} title="下一个">
        ▼
      </button>
      <button className="pdf-toolbar-btn" onClick={onClose} title="关闭">
        ✕
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Wire PdfSearchBar into PdfViewer**

In `PdfViewer.tsx`, import and conditionally render:

```tsx
import PdfSearchBar from "./PdfSearchBar";

// Inside the return, after PdfToolbar:
{showSearch && (
  <PdfSearchBar
    onSearch={searchPdf}
    onNavigate={handlePageChange}
    onClose={() => setShowSearch(false)}
  />
)}
```

Add `searchPdf` from the hook destructuring:

```tsx
const { openPdf, closePdf, loadAnnotations, searchPdf } = usePdfRenderer();
```

- [ ] **Step 3: Verify search works**

Run: `npm run dev`

Expected: Ctrl+F opens search bar, typing a query shows match count, Enter navigates between pages with matches.

- [ ] **Step 4: Commit**

```bash
git add src/components/pdf-viewer/PdfSearchBar.tsx src/components/pdf-viewer/PdfViewer.tsx
git commit -m "feat(pdf): add search bar with navigation"
```

---

## Task 15: PdfAnnotationPanel — Side Panel

**Files:**

- Create: `src/components/pdf-viewer/PdfAnnotationPanel.tsx`
- Modify: `src/components/pdf-viewer/PdfViewer.tsx`

- [ ] **Step 1: Create PdfAnnotationPanel**

Create `src/components/pdf-viewer/PdfAnnotationPanel.tsx`:

```tsx
import type { PdfAnnotation } from "../../types/pdf";

const COLOR_DOTS: Record<string, string> = {
  yellow: "#FFD000",
  red: "#FF453A",
  green: "#32D74B",
  blue: "#0A84FF",
  purple: "#BF5AF2",
};

interface PdfAnnotationPanelProps {
  annotations: PdfAnnotation[];
  onNavigate: (page: number) => void;
  onClose: () => void;
}

export default function PdfAnnotationPanel({
  annotations,
  onNavigate,
  onClose,
}: PdfAnnotationPanelProps) {
  // Group by page
  const grouped = new Map<number, PdfAnnotation[]>();
  for (const ann of annotations) {
    const list = grouped.get(ann.pageNumber) ?? [];
    list.push(ann);
    grouped.set(ann.pageNumber, list);
  }

  const sortedPages = [...grouped.keys()].sort((a, b) => a - b);

  return (
    <div className="pdf-annotation-panel">
      <div className="pdf-annotation-panel-header">
        <span>批注 ({annotations.length})</span>
        <button
          className="pdf-toolbar-btn"
          onClick={onClose}
          style={{ float: "right", marginTop: -4 }}
        >
          ✕
        </button>
      </div>
      {sortedPages.map(page => (
        <div key={page}>
          <div
            style={{
              padding: "6px 16px",
              fontSize: 11,
              color: "var(--text-quaternary)",
              fontWeight: 600,
            }}
          >
            第 {page + 1} 页
          </div>
          {grouped.get(page)!.map(ann => (
            <div
              key={ann.id}
              className="pdf-annotation-item"
              onClick={() => onNavigate(ann.pageNumber)}
            >
              <span
                className="pdf-annotation-item-color"
                style={{ background: COLOR_DOTS[ann.color] }}
              />
              <span style={{ fontSize: 13, color: "var(--text-secondary)" }}>
                {ann.type === "highlight" ? "高亮" : ann.type === "note" ? "批注" : "区域"}
              </span>
              {ann.selectedText && (
                <div className="pdf-annotation-item-text">
                  "{ann.selectedText.slice(0, 80)}"
                </div>
              )}
              {ann.content && (
                <div className="pdf-annotation-item-text" style={{ fontStyle: "italic" }}>
                  {ann.content.slice(0, 60)}
                </div>
              )}
            </div>
          ))}
        </div>
      ))}
      {annotations.length === 0 && (
        <div style={{ padding: 24, textAlign: "center", color: "var(--text-quaternary)", fontSize: 13 }}>
          暂无批注
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Wire into PdfViewer**

In `PdfViewer.tsx`, import and conditionally render:

```tsx
import PdfAnnotationPanel from "./PdfAnnotationPanel";

// Inside the return, at the end (before closing </div>):
{showAnnotationPanel && (
  <PdfAnnotationPanel
    annotations={annotations}
    onNavigate={handlePageChange}
    onClose={() => setShowAnnotationPanel(false)}
  />
)}
```

- [ ] **Step 3: Commit**

```bash
git add src/components/pdf-viewer/PdfAnnotationPanel.tsx src/components/pdf-viewer/PdfViewer.tsx
git commit -m "feat(pdf): add annotation panel with grouped list"
```

---

## Task 16: PdfOutlinePanel — Table of Contents

**Files:**

- Create: `src/components/pdf-viewer/PdfOutlinePanel.tsx`
- Modify: `src/components/pdf-viewer/PdfViewer.tsx`

- [ ] **Step 1: Create PdfOutlinePanel**

Create `src/components/pdf-viewer/PdfOutlinePanel.tsx`:

```tsx
import type { OutlineEntry } from "../../types/pdf";

interface PdfOutlinePanelProps {
  outline: OutlineEntry[];
  onNavigate: (page: number) => void;
  onClose: () => void;
}

function OutlineItem({
  entry,
  depth,
  onNavigate,
}: {
  entry: OutlineEntry;
  depth: number;
  onNavigate: (page: number) => void;
}) {
  return (
    <>
      <div
        className="pdf-outline-item"
        style={{ paddingLeft: 12 + depth * 16 }}
        onClick={() => onNavigate(entry.page)}
      >
        {entry.title}
      </div>
      {entry.children.map((child, i) => (
        <OutlineItem
          key={i}
          entry={child}
          depth={depth + 1}
          onNavigate={onNavigate}
        />
      ))}
    </>
  );
}

export default function PdfOutlinePanel({
  outline,
  onNavigate,
  onClose,
}: PdfOutlinePanelProps) {
  if (outline.length === 0) {
    return (
      <div className="pdf-outline-panel">
        <div style={{ padding: 16, color: "var(--text-quaternary)", fontSize: 13 }}>
          此 PDF 没有目录
        </div>
      </div>
    );
  }

  return (
    <div className="pdf-outline-panel">
      {outline.map((entry, i) => (
        <OutlineItem
          key={i}
          entry={entry}
          depth={0}
          onNavigate={page => {
            onNavigate(page);
            onClose();
          }}
        />
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Wire into PdfViewer**

In `PdfViewer.tsx`:

```tsx
import PdfOutlinePanel from "./PdfOutlinePanel";

// Inside the return, after the search bar:
{showOutline && metadata.outline.length > 0 && (
  <PdfOutlinePanel
    outline={metadata.outline}
    onNavigate={handlePageChange}
    onClose={() => setShowOutline(false)}
  />
)}
```

- [ ] **Step 3: Commit**

```bash
git add src/components/pdf-viewer/PdfOutlinePanel.tsx src/components/pdf-viewer/PdfViewer.tsx
git commit -m "feat(pdf): add outline/TOC panel"
```

---

## Task 17: Ctrl+Scroll Zoom + Smooth Zoom Transitions

**Files:**

- Modify: `src/components/pdf-viewer/PdfViewer.tsx`

- [ ] **Step 1: Add Ctrl+scroll zoom handler**

In `PdfViewer.tsx`, add a wheel event handler:

```tsx
const handleWheel = useCallback(
  (e: WheelEvent) => {
    if (!e.ctrlKey) return;
    e.preventDefault();
    const delta = e.deltaY > 0 ? -10 : 10;
    setZoom(z => Math.min(400, Math.max(25, z + delta)));
  },
  [],
);

useEffect(() => {
  const el = containerRef.current;
  if (!el) return;
  el.addEventListener("wheel", handleWheel, { passive: false });
  return () => el.removeEventListener("wheel", handleWheel);
}, [handleWheel]);
```

- [ ] **Step 2: Add keyboard zoom shortcuts**

Extend the existing keyboard handler in PdfViewer:

```tsx
if (e.ctrlKey && (e.key === "=" || e.key === "+")) {
  e.preventDefault();
  setZoom(z => Math.min(400, z + 25));
}
if (e.ctrlKey && e.key === "-") {
  e.preventDefault();
  setZoom(z => Math.max(25, z - 25));
}
if (e.ctrlKey && e.key === "0") {
  e.preventDefault();
  setZoom(100);
}
if (e.ctrlKey && e.key === "g") {
  e.preventDefault();
  // Focus page input in toolbar — TODO: implement via ref
}
```

- [ ] **Step 3: Add Space/Shift+Space page scroll**

```tsx
if (e.key === " " && !e.ctrlKey) {
  e.preventDefault();
  const container = containerRef.current;
  if (container) {
    const scrollAmount = e.shiftKey ? -container.clientHeight * 0.8 : container.clientHeight * 0.8;
    container.scrollBy({ top: scrollAmount, behavior: "smooth" });
  }
}
```

- [ ] **Step 4: Verify zoom and scroll shortcuts**

Run: `npm run dev`

Expected: Ctrl+scroll zooms, Ctrl+=/- zooms, Ctrl+0 resets, Space scrolls down, Shift+Space scrolls up.

- [ ] **Step 5: Commit**

```bash
git add src/components/pdf-viewer/PdfViewer.tsx
git commit -m "feat(pdf): add zoom controls and keyboard shortcuts"
```

---

## Task 18: Annotation Creation Flow — Highlight on Text Selection

**Files:**

- Modify: `src/components/pdf-viewer/PdfViewer.tsx`
- Modify: `src/components/pdf-viewer/PdfPage.tsx`
- Modify: `src/components/pdf-viewer/PdfTextLayer.tsx`

- [ ] **Step 1: Add selection state to PdfViewer**

In `PdfViewer.tsx`, add state for the selection toolbar:

```tsx
const [selectionToolbar, setSelectionToolbar] = useState<{
  x: number;
  y: number;
  pageIndex: number;
  selectedText: string;
  textRanges: TextRange[];
} | null>(null);
```

- [ ] **Step 2: Add text selection handler in PdfTextLayer**

In `PdfTextLayer.tsx`, add an `onTextSelected` prop and handle `mouseup`:

```tsx
interface PdfTextLayerProps {
  // ... existing props
  onTextSelected?: (data: {
    pageIndex: number;
    selectedText: string;
    textRanges: TextRange[];
    clientX: number;
    clientY: number;
  }) => void;
}

// In the component:
const handleMouseUp = useCallback(() => {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || !textData) return;

  const text = selection.toString().trim();
  if (!text) return;

  // Get selection rects relative to the text layer
  const range = selection.getRangeAt(0);
  const rects = Array.from(range.getClientRects());
  const layerEl = /* ref to text layer div */;
  const layerRect = layerEl.getBoundingClientRect();

  const normRects = rects.map(r => ({
    x: (r.left - layerRect.left) / layerRect.width,
    y: (r.top - layerRect.top) / layerRect.height,
    w: r.width / layerRect.width,
    h: r.height / layerRect.height,
  }));

  const lastRect = rects[rects.length - 1];

  onTextSelected?.({
    pageIndex,
    selectedText: text,
    textRanges: [{
      startOffset: 0, // TODO: compute from textData
      endOffset: text.length,
      rects: normRects,
    }],
    clientX: lastRect.right,
    clientY: lastRect.top,
  });
}, [textData, pageIndex, onTextSelected]);
```

- [ ] **Step 3: Show PdfSelectionToolbar on text selection**

In `PdfViewer.tsx`, render the selection toolbar and handle annotation creation:

```tsx
import PdfSelectionToolbar from "./PdfSelectionToolbar";
import { v4 as uuid } from "crypto"; // or use a simple ID generator

// Use a ref to always have the latest annotations for saving
const annotationsRef = useRef(annotations);
annotationsRef.current = annotations;

const handleCreateHighlight = useCallback(
  (color: AnnotationColor) => {
    if (!selectionToolbar) return;

    const newAnnotation: PdfAnnotation = {
      id: crypto.randomUUID(),
      pageNumber: selectionToolbar.pageIndex,
      type: "highlight",
      color,
      textRanges: selectionToolbar.textRanges,
      selectedText: selectionToolbar.selectedText,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    setAnnotations(prev => {
      const updated = [...prev, newAnnotation];
      // Save using latest state via callback, avoiding stale closure
      if (vaultPath) {
        saveAnnotations(vaultPath, note.path, updated).catch(() => {});
      }
      return updated;
    });
    setSelectionToolbar(null);
    window.getSelection()?.removeAllRanges();
  },
  [selectionToolbar, vaultPath, note.path, saveAnnotations],
);

// In the return:
{selectionToolbar && (
  <PdfSelectionToolbar
    x={selectionToolbar.x}
    y={selectionToolbar.y}
    onHighlight={handleCreateHighlight}
    onAddNote={() => { /* TODO: open note editor */ }}
    onCopy={() => {
      navigator.clipboard.writeText(selectionToolbar.selectedText);
      setSelectionToolbar(null);
    }}
  />
)}
```

- [ ] **Step 4: Verify highlight creation**

Run: `npm run dev`

Expected: Select text → color toolbar appears → click a color → text is highlighted with that color → highlight persists on re-open.

- [ ] **Step 5: Commit**

```bash
git add src/components/pdf-viewer/
git commit -m "feat(pdf): add annotation creation flow with text selection"
```

---

## Task 19: Reading Position Memory

**Files:**

- Modify: `src/components/pdf-viewer/PdfViewer.tsx`

- [ ] **Step 1: Save reading position to localStorage**

In `PdfViewer.tsx`, use a simple localStorage approach (SQLite integration can come later):

```tsx
const positionKey = `pdf-position-${note.id}`;

// Restore on mount
useEffect(() => {
  const saved = localStorage.getItem(positionKey);
  if (saved) {
    try {
      const { page, zoom: savedZoom } = JSON.parse(saved);
      setCurrentPage(page);
      setZoom(savedZoom);
    } catch {}
  }
}, [positionKey]);

// Save on scroll (debounced)
const savePositionRef = useRef<ReturnType<typeof setTimeout>>();
const handleScroll = useCallback(() => {
  if (savePositionRef.current) clearTimeout(savePositionRef.current);
  savePositionRef.current = setTimeout(() => {
    localStorage.setItem(positionKey, JSON.stringify({ page: currentPage, zoom }));
  }, 1000);
}, [positionKey, currentPage, zoom]);
```

- [ ] **Step 2: Track current page from scroll position**

Add scroll handler to the page container to detect which page is most visible:

```tsx
// Inside the scroll handler on pdf-page-container:
const updateCurrentPage = useCallback(() => {
  const container = containerRef.current;
  if (!container || !metadata) return;

  const scrollTop = container.scrollTop;
  const containerHeight = container.clientHeight;
  const center = scrollTop + containerHeight / 2;

  // Find which page wrapper contains the center point
  let accumulated = 0;
  for (let i = 0; i < metadata.page_count; i++) {
    const [, h] = metadata.page_dimensions[i];
    const pageHeight = h * (zoom / 100) + 8; // 8px gap
    if (accumulated + pageHeight > center) {
      setCurrentPage(i);
      break;
    }
    accumulated += pageHeight;
  }
}, [metadata, zoom]);
```

- [ ] **Step 3: Commit**

```bash
git add src/components/pdf-viewer/PdfViewer.tsx
git commit -m "feat(pdf): add reading position memory with localStorage"
```

---

## Task 20: Final Integration & Polish

**Files:**

- Modify: `src/components/pdf-viewer/PdfViewer.tsx`
- Modify: `src/components/pdf-viewer/pdf-viewer.css`

- [ ] **Step 1: Add scroll-to-page function**

Implement `handlePageChange` to actually scroll to the target page:

```tsx
const handlePageChange = useCallback(
  (page: number) => {
    setCurrentPage(page);
    const wrapper = pageRefs.current.get(page);
    if (wrapper) {
      wrapper.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  },
  [],
);
```

- [ ] **Step 2: Add Ctrl+scroll zoom around cursor position**

Enhance the zoom handler to maintain scroll position relative to cursor:

```tsx
const handleWheel = useCallback(
  (e: WheelEvent) => {
    if (!e.ctrlKey) return;
    e.preventDefault();

    const container = containerRef.current;
    if (!container) return;

    const scrollBefore = container.scrollTop;
    const scrollFraction = scrollBefore / (container.scrollHeight - container.clientHeight || 1);

    const delta = e.deltaY > 0 ? -10 : 10;
    setZoom(z => {
      const newZoom = Math.min(400, Math.max(25, z + delta));
      // Restore scroll fraction after zoom
      requestAnimationFrame(() => {
        const newScrollMax = container.scrollHeight - container.clientHeight;
        container.scrollTop = scrollFraction * newScrollMax;
      });
      return newZoom;
    });
  },
  [],
);
```

- [ ] **Step 3: Add click-outside to dismiss selection toolbar**

```tsx
useEffect(() => {
  if (!selectionToolbar) return;
  const handler = (e: MouseEvent) => {
    const target = e.target as HTMLElement;
    if (!target.closest(".pdf-selection-toolbar")) {
      setSelectionToolbar(null);
    }
  };
  document.addEventListener("mousedown", handler);
  return () => document.removeEventListener("mousedown", handler);
}, [selectionToolbar]);
```

- [ ] **Step 4: Run full app and test end-to-end**

Run: `npm run dev`

Test checklist:
1. Open a PDF → pages render with actual content
2. Scroll → pages load on demand, toolbar shows correct page number
3. Ctrl+scroll → zoom works smoothly
4. Ctrl+F → search works, Enter navigates between matches
5. Select text → color toolbar appears → click color → highlight persists
6. Close and reopen PDF → reading position restored
7. Click toolbar ☰ → outline panel shows (if PDF has bookmarks)
8. Click toolbar 📝 → annotation panel shows
9. All keyboard shortcuts work (Space, Ctrl+=, Ctrl+-, Ctrl+0, Esc)

- [ ] **Step 5: Commit**

```bash
git add src/components/pdf-viewer/
git commit -m "feat(pdf): polish integration, zoom behavior, and interaction fixes"
```

---

## Task Summary

| Task | Description | Rust | Frontend |
|------|-------------|------|----------|
| 1 | Dependencies & PDFium binary | ✓ | |
| 2 | PDF engine core (open/close) | ✓ | |
| 3 | Page rendering to WebP + cache | ✓ | |
| 4 | Text extraction with coordinates | ✓ | |
| 5 | Full-text search | ✓ | |
| 6 | Annotation persistence | ✓ | |
| 7 | TypeScript types | | ✓ |
| 8 | usePdfRenderer hook | | ✓ |
| 9 | PdfViewer shell + PdfToolbar | | ✓ |
| 10 | Integration into ActiveNoteContent | | ✓ |
| 11 | PdfPage with rendering | | ✓ |
| 12 | PdfTextLayer | | ✓ |
| 13 | PdfAnnotationLayer + SelectionToolbar | | ✓ |
| 14 | PdfSearchBar | | ✓ |
| 15 | PdfAnnotationPanel | | ✓ |
| 16 | PdfOutlinePanel | | ✓ |
| 17 | Zoom + keyboard shortcuts | | ✓ |
| 18 | Annotation creation flow | | ✓ |
| 19 | Reading position memory | | ✓ |
| 20 | Final integration & polish | | ✓ |
