# Immersive PDF Reader — Phase 1 Design Spec

> **Date:** 2026-03-20
> **Scope:** Immersive PDF reader + text highlight/annotation (Phase 1)
> **Future phases:** Freehand drawing, stamps, signatures, form filling

---

## 1. Problem Statement

The current PDF reader uses the browser's native `<object>` tag to embed PDFs. This results in:

- No custom UI — toolbar, scrollbar, zoom controls are all browser-native and don't match the app's design language
- No annotation capabilities
- No control over rendering performance or behavior
- A non-immersive experience that breaks the visual flow of the app

## 2. Goals

- Replace the native PDF embed with a fully custom, immersive PDF reader
- Achieve extreme performance through Rust-driven rendering (multi-threaded, cached, pre-fetched)
- Provide text highlighting (5 colors) and text annotations (Markdown-capable)
- Store annotations in app-side JSON files, with export-to-PDF capability
- Match the app's glassmorphism/dark theme design language
- Support continuous scroll, zoom, search, and keyboard shortcuts

## 3. Architecture — Rust Hybrid Rendering

### 3.1 Design Principle

All heavy computation runs in Rust. The frontend is a thin display + interaction layer.

### 3.2 Responsibility Split

| Responsibility | Layer | Details |
|---|---|---|
| PDF parsing | **Rust** | Open file, parse structure, extract metadata (page count, dimensions, outline/bookmarks) |
| Page rendering | **Rust** (thread pool) | Render pages to bitmaps, multi-threaded |
| Text coordinate extraction | **Rust** | Extract per-word bounding boxes for text selection layer |
| Thumbnail generation | **Rust** | Low-resolution page previews for navigation |
| Full-text search | **Rust** | Cross-page search, return match positions (page + rects) |
| Annotation persistence | **Rust** | Read/write annotation JSON files |
| Export annotations to PDF | **Rust** | Merge annotations into PDF annotation layer via PDFium `FPDFAnnot_*` APIs |
| Render cache | **Rust** | LRU memory cache + optional disk cache for rendered pages |
| Page display | **Frontend** | Receive bitmaps via asset protocol, Canvas blitting (no PDF parsing in JS) |
| Text selection layer | **Frontend** | Transparent text divs positioned using Rust-provided coordinates |
| Annotation editing layer | **Frontend** | SVG overlay for highlight/annotation creation and interaction |
| UI controls | **Frontend** | Toolbar, panels, shortcuts, animations |

### 3.3 Rust PDF Engine — Decision: PDFium via `pdfium-render`

**Chosen engine:** PDFium (`pdfium-render` crate) + bundled PDFium DLL (~25MB).

**Why PDFium over alternatives:**

| Engine | Rendering | License | Rust Ecosystem | Verdict |
|---|---|---|---|---|
| **PDFium** | Excellent (Chrome's engine) | BSD | `pdfium-render` crate, actively maintained | **Selected** |
| MuPDF | Fastest | AGPL (requires source distribution) | `mupdf` crate requires C toolchain, fragile Windows build | Rejected: AGPL risk + build complexity |
| Poppler | Good | GPL | No mature Rust bindings | Rejected: poor Rust support |
| `pdf-rs` | N/A (parsing only) | MIT | Pure Rust | Rejected: no rendering capability |

**Build & distribution:**

- PDFium binary (`pdfium.dll` on Windows, ~25MB) bundled alongside the Tauri app binary via `tauri.conf.json` resources
- `pdfium-render` crate links dynamically at runtime via `Pdfium::bind_to_library()`
- CI: download pre-built PDFium from pdfium-binaries releases during build
- No C/C++ toolchain required at build time

**Annotation export:** Use the same PDFium engine for writing annotations back to PDF (PDFium supports `FPDFAnnot_*` APIs), avoiding a second PDF library.

**Consolidation with existing `pdf-extract` crate:** The codebase currently uses `pdf-extract = "0.7"` for AI text indexing. Once PDFium is integrated, text extraction should migrate to PDFium as well, removing the `pdf-extract` dependency.

### 3.4 IPC Bitmap Transfer — Decision: Tauri Asset Protocol

**Problem:** Tauri's `invoke` serializes `Vec<u8>` as JSON number arrays. A single PDF page at 150 DPI (~1240x1754 RGBA) is ~8.7MB raw, which becomes ~25-35MB of JSON. This is unacceptable.

**Solution:** Use Tauri's **asset protocol** to serve rendered bitmaps as files from a temp directory.

**Flow:**

1. Rust renders page to bitmap → compresses to WebP (~200-500KB per page) → writes to temp directory
2. Returns the asset protocol URL string (e.g., `asset://localhost/tmp/pdf-cache/page-5-150dpi.webp`)
3. Frontend loads via `<img src={assetUrl}>` or `fetch()` + Canvas `drawImage()`
4. Zero JSON serialization overhead for bitmap data

**Why this approach:**

- Avoids IPC serialization entirely for the heaviest payload
- WebP compression reduces ~8.7MB raw → ~200-500KB per page
- Browser image decoder is hardware-accelerated
- Tauri asset protocol is available in Tauri 2.x (requires adding asset protocol scope to `tauri.conf.json` security config)
- Text coordinates (small JSON payloads, ~5-20KB per page) still use regular `invoke`

**Temp directory management:**

- Location: `{app_data_dir}/pdf-render-cache/`
- Rust manages cleanup: LRU eviction when cache exceeds configurable limit (default 200MB)
- On PDF close: delete all cached pages for that document
- On app exit: clear entire cache directory

### 3.5 Data Flow

```text
User opens PDF
    ↓
Rust: parse PDF → return { pageCount, pageDimensions[], outline }
    ↓
Frontend: create virtual scroll container with placeholder divs sized to actual page dimensions
    ↓
User scrolls to page N
    ↓
Frontend: request render(pageN, zoomLevel, devicePixelRatio)
    ↓
Rust (dynamic thread pool via rayon):
  ├── Render page N → WebP → write to cache dir (highest priority)
  ├── Pre-render pages N±1, N±2, N±3 (prefetch, lower priority)
  └── Extract text coordinates for page N → return via invoke
    ↓
Rust: return { assetUrl, textBlocks } to frontend
    ↓
Frontend:
  ├── <img> or Canvas: load assetUrl → display (no PDF parsing)
  ├── Text layer: position transparent spans using word bounding boxes
  └── Annotation layer: load page annotations → render SVG overlay
```

## 4. UI/UX Design

### 4.1 Floating Toolbar

```text
┌─────────────────────────────────────────────────────┐
│  ☰  │  −  +  │ 132% ▾ │  🔍  │  ◀ 32 / 65 ▶  │  ⋯  │
│ TOC │  Zoom   │ Preset │Search│  Page nav       │ More│
└─────────────────────────────────────────────────────┘
```

- Glassmorphism style: `backdrop-filter: blur(18px)`, semi-transparent background matching app theme
- Auto-hide: fade out after 3s of mouse inactivity in the reading area; slide in when mouse moves to top
- Zoom presets dropdown: Fit Width / Fit Page / 50% / 75% / 100% / 125% / 150% / 200%
- `Ctrl+scroll` for zoom

**More menu (⋯):**

- Rotate page (CW/CCW)
- Print
- Open in external application

**Deferred to Phase 2+:** Dual page mode and single-page mode toggle (architecturally non-trivial, requires page alignment logic).

### 4.2 Immersion Design Elements

- **Borderless rendering:** 8px gap between pages, no heavy borders or shadows
- **Theme-matched background:** Dark/light background matching app theme, not gray
- **Smooth scrolling:** `scroll-behavior: smooth`, zoom transitions with CSS animation
- **Fullscreen mode:** `F11` or double-click toolbar — hides sidebar and tab bar, only PDF content + fade-in toolbar remain
- **Reading position memory:** Restores last page number and zoom level when reopening the same PDF. Stored in the vault's SQLite database (already available) keyed by file path hash.

### 4.3 TOC / Outline Sidebar

- Triggered by the ☰ button in toolbar
- Appears as a **left overlay panel** inside the PDF viewer (does not share space with the annotation panel on the right)
- Renders the PDF's bookmark/outline tree as a collapsible list
- Click an entry to scroll to that page
- Auto-closes when an entry is clicked (can be pinned open)

### 4.4 Search Bar

Triggered by `Ctrl+F`, appears below toolbar:

```text
┌──────────────────────────────────────────┐
│  🔍 [search input...] │ 3 / 17 │ ▲ ▼ │ ✕ │
└──────────────────────────────────────────┘
```

- Search executed in Rust backend (fast, threaded)
- Returns `[{ page, rects[] }]` for all matches
- Frontend highlights matches with colored rectangles on the annotation layer
- Up/Down arrows navigate between matches, scrolling to the relevant page

## 5. Annotation System

### 5.1 Annotation Types (Phase 1)

| Type | Interaction | Visual |
|---|---|---|
| **Text highlight** | Select text → color picker popup | Semi-transparent colored background, 5 colors (yellow/red/green/blue/purple) |
| **Text note** | Select text → click "Add note" | Highlight + small icon in margin, click to expand note content |
| **Area note** | Drag to select rectangle → add note | Dashed rectangle + note icon |

### 5.2 Text Selection Mechanics

**Coordinate system:** All coordinates use **normalized 0-1 values** relative to the page's PDF-unit dimensions (same as the `area` field). This makes coordinates zoom-independent and resolution-independent.

**Rust provides per-page text data:**

```typescript
interface PdfTextBlock {
  text: string;               // The full page text
  words: Array<{
    word: string;
    charIndex: number;        // Start index in `text`
    rect: { x: number; y: number; w: number; h: number }; // Normalized 0-1
  }>;
}
```

**Selection state machine:**

1. **mousedown** on text layer → record start position, find nearest word
2. **mousemove** (dragging) → extend selection word-by-word, highlight selected words with temporary blue overlay
3. **mouseup** → finalize selection:
   - Calculate `textRanges` from selected words (merge adjacent rects on same line)
   - Store `selectedText` from word strings
   - Show floating action bar above selection end point
4. **Click outside** or `Esc` → dismiss action bar, clear temporary selection

**Cross-page selection:** Not supported in Phase 1. Selection is confined to a single page. If the user drags across a page boundary, the selection stops at the page edge. (Cross-page selection adds significant complexity with virtual scrolling and can be added in a later phase.)

**Converting selection to annotation `textRanges`:**

- `startOffset` / `endOffset` are **character indices into the page's full text string** (from `PdfTextBlock.text`)
- `rects` are the union of selected word rects, merged by line (adjacent words on the same Y coordinate merge into one wider rect)

### 5.3 Annotation Data Structure

```typescript
interface PdfAnnotation {
  id: string;
  pageNumber: number;
  type: "highlight" | "note" | "area";
  color: "yellow" | "red" | "green" | "blue" | "purple";
  // Text highlight: position info of selected text
  textRanges?: Array<{
    startOffset: number;      // Character index in page's full text
    endOffset: number;        // Character index in page's full text
    rects: Array<{ x: number; y: number; w: number; h: number }>; // Normalized 0-1
  }>;
  // Area note: rectangle coordinates (normalized 0-1 relative to page)
  area?: { x: number; y: number; w: number; h: number };
  // Note content (Markdown)
  content?: string;
  selectedText?: string;
  createdAt: string;
  updatedAt: string;
}
```

### 5.4 Annotation Interaction Flow

```text
Select text in PDF
    ↓
Floating action bar appears above selection:
┌──────────────────────────────────┐
│  🟡 🔴 🟢 🔵 🟣  │  📝 Note  │  📋 Copy  │
└──────────────────────────────────┘
    ↓
Click color → immediate highlight, no confirmation needed
Click Note → highlight + note editor popup (supports Markdown)
```

### 5.5 Storage

**Annotation files:**

- Stored in vault metadata directory: `{vault_root}/.nexus/pdf-annotations/{file-path-hash}.json`
- This avoids polluting the user's file tree, avoids read-only directory issues, and prevents the vault scanner from indexing annotation files
- If vault has no `.nexus` directory, create it (similar pattern to `.obsidian`)

**Annotation file format:**

```json
{
  "pdfPath": "relative/path/to/file.pdf",
  "pdfHash": "sha256-of-first-1KB-for-identity-check",
  "annotations": [ /* PdfAnnotation[] */ ]
}
```

**File identity:** `pdfHash` uses SHA-256 of (first 1KB + last 1KB + file size as bytes) to detect if the PDF has been replaced. This sampling approach avoids hashing large files while being robust against PDFs with identical headers. If mismatch on open, warn user that annotations may be misaligned.

**Export to PDF:** Rust uses PDFium's `FPDFAnnot_*` APIs to write standard PDF markup annotations (PDF 1.7 Section 12.5) with proper appearance streams. Exported annotations are viewable in Acrobat, Foxit, etc.

**Annotation panel:** Collapsible right-side panel, annotations grouped by page number, click to jump.

## 6. Performance Optimization

### 6.1 Render Pipeline

Use a **dynamic thread pool** (`rayon` or `tokio::spawn_blocking`) with a **priority queue**, not fixed worker assignments.

**Priority levels:**

1. **Critical:** Current viewport pages (must render ASAP)
2. **High:** Adjacent pages N±1 (likely to scroll into view)
3. **Medium:** Prefetch pages N±2, N±3
4. **Low:** Thumbnail generation

The pool uses `tokio::spawn_blocking` (already in the project's dependency tree) with a priority queue managed by a dedicated scheduler task. This is consistent with the codebase's existing parallelism patterns (see `cmd_media.rs`, `cmd_ai.rs`).

### 6.2 Strategies

- **On-demand + prefetch:** Render viewport pages, pre-render ±3 pages, placeholders for the rest (gray rect with page number)
- **Multi-resolution:** During fast scroll, show upscaled thumbnail first; replace with full-resolution bitmap when scrolling stops
- **Zoom optimization:** During zoom gesture, use CSS `transform: scale()` on current bitmap (instant response); after zoom ends, debounce (200ms) and request Rust re-render at correct resolution
- **Memory cap:** LRU cache, max ~20 pages of high-res bitmaps in memory + 200MB disk cache; evict farthest pages when exceeded

### 6.3 Search Performance

- On PDF open: Rust extracts all page text and builds search index in background thread
- Search queries sent to Rust, results returned as `[{ page, rects[] }]`
- Non-blocking: search runs on background thread, does not block rendering

## 7. Error Handling

| Scenario | Behavior |
|---|---|
| Encrypted / password-protected PDF | Show password prompt dialog. If cancelled, show "This PDF is encrypted" message with "Open in external app" button. |
| Malformed / corrupted PDF | Show error message: "Unable to render this PDF" with the PDFium error detail. Offer "Open in external app" fallback. |
| Single page render failure | Show placeholder for that page with error icon. Other pages continue rendering normally. |
| Annotation file write failure | Show toast notification: "Could not save annotations — check disk space/permissions". Retry on next edit. Keep annotations in memory. |
| PDFium DLL not found | Show error on first PDF open: "PDF engine not found. Please reinstall the application." Log path details. |
| PDF export failure (read-only / locked file) | Show toast: "Could not export annotations — PDF file is read-only or locked." Offer "Save as copy" alternative. |

Rust-side: all PDFium calls wrapped in `catch_unwind` (C library may panic). New error variants added to `AppError` enum: `PdfEngineError`, `PdfRenderError`, `PdfAnnotationError`.

## 7.1 PDF Document Lifecycle (Rust State Management)

PDFium document handles are managed via Tauri's state system:

```rust
// Shared state registered with Tauri app
pub struct PdfState {
    documents: Arc<Mutex<HashMap<String, PdfDocument>>>,
    render_cache: Arc<RenderCache>,
}
```

- **Open:** `open_pdf(path)` → load via PDFium → store in `documents` map keyed by a generated `doc_id` → return `doc_id` + metadata to frontend
- **Render/query:** All subsequent commands take `doc_id` to look up the loaded document
- **Close:** `close_pdf(doc_id)` → remove from map → drop PDFium handle → clear render cache for that document
- **Concurrency:** `Mutex` ensures safe access; rendering spawns `spawn_blocking` tasks that clone the `Arc` references. PDFium operations on the same document are serialized; different documents can render in parallel.

## 8. Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `Ctrl+F` | Search |
| `Ctrl+G` | Go to page |
| `Ctrl+=` / `Ctrl+-` | Zoom in / out |
| `Ctrl+0` | Reset zoom |
| `Ctrl+scroll` | Zoom |
| `Space` / `Shift+Space` | Page down / up |
| `F11` | Toggle fullscreen |
| `Esc` | Exit fullscreen / close search |

## 9. Component Structure

```text
PdfViewer (top-level container)
├── PdfToolbar
│   ├── TOC button (opens outline overlay)
│   ├── Zoom controls (−/+/preset dropdown)
│   ├── Search button
│   ├── Page navigation (prev/next/input/total)
│   └── More menu
│
├── PdfSearchBar (conditional, Ctrl+F)
│   └── Input + prev/next + match count + close
│
├── PdfOutlinePanel (left overlay, conditional)
│   └── Collapsible bookmark tree
│
├── PdfPageContainer (scroll container, continuous scroll)
│   └── PdfPage × N (virtualized, on-demand render)
│       ├── Canvas/img layer (bitmap from Rust via asset protocol)
│       ├── Text layer (transparent spans, Rust-provided coordinates)
│       └── Annotation layer (SVG overlay)
│
└── PdfAnnotationPanel (collapsible right panel)
    └── Annotation list (grouped by page, click to jump)
```

## 10. Migration Path

### Existing PDF rendering paths

The app has two PDF rendering paths:

1. **MediaViewer path** (`MediaViewer.tsx`): Opens PDFs from the file tree via `<object>` tag with blob URL — this is the primary path being replaced
2. **PdfViewer path** (`PdfViewer.tsx`): Renders compiled PDF output from LaTeX compilation, receives in-memory `Uint8Array` — this is a secondary path

**Phase 1 scope:** Replace path #1 (MediaViewer) only. The new `PdfViewer` accepts a file path and delegates to Rust.

**Path #2 migration:** The existing `PdfViewer.tsx` for compiled PDFs can be updated later to write the `Uint8Array` to a temp file and open it in the new reader.

## 11. Future Phases

- **Phase 2:** Freehand drawing / pen tool, shape annotations (rectangle, ellipse, arrow), dual page mode
- **Phase 3:** Stamps, signatures, form filling
- **Phase 4:** Collaborative annotations (multi-user, sync)

## 12. Files to Create/Modify

### New files (Frontend)

- `src/components/pdf-viewer/PdfViewer.tsx` — Top-level container
- `src/components/pdf-viewer/PdfToolbar.tsx` — Floating toolbar
- `src/components/pdf-viewer/PdfSearchBar.tsx` — Search bar
- `src/components/pdf-viewer/PdfOutlinePanel.tsx` — TOC/outline overlay
- `src/components/pdf-viewer/PdfPageContainer.tsx` — Virtual scroll container
- `src/components/pdf-viewer/PdfPage.tsx` — Single page (canvas + text + annotation layers)
- `src/components/pdf-viewer/PdfAnnotationLayer.tsx` — SVG annotation overlay
- `src/components/pdf-viewer/PdfAnnotationPanel.tsx` — Right-side annotation list
- `src/components/pdf-viewer/PdfTextLayer.tsx` — Transparent text selection layer
- `src/components/pdf-viewer/pdf-viewer.css` — Styles
- `src/hooks/usePdfRenderer.ts` — Hook for Rust IPC (render, search, annotations)
- `src/types/pdf.ts` — TypeScript types for PDF data structures

### New files (Backend / Rust)

- `src-tauri/src/commands/cmd_pdf.rs` — Tauri commands for PDF operations
- `src-tauri/src/pdf/mod.rs` — PDF engine module
- `src-tauri/src/pdf/renderer.rs` — Page rendering (PDFium wrapper)
- `src-tauri/src/pdf/text.rs` — Text extraction with word coordinates
- `src-tauri/src/pdf/search.rs` — Full-text search with position data
- `src-tauri/src/pdf/annotations.rs` — Annotation CRUD + PDF export
- `src-tauri/src/pdf/cache.rs` — Render cache (LRU, memory + disk)
- `src-tauri/src/pdf/thumbnails.rs` — Thumbnail generation

### Modified files

- `src/components/media-viewer/MediaViewer.tsx` — Route PDF category to new `PdfViewer` instead of `<object>` tag
- `src-tauri/src/commands.rs` — Register new PDF commands
- `src-tauri/src/error.rs` — Add `PdfEngineError`, `PdfRenderError`, `PdfAnnotationError` variants
- `src-tauri/Cargo.toml` — Add `pdfium-render`, `webp` (for WebP encoding) dependencies; remove `pdf-extract` after migration
- `tauri.conf.json` — Bundle `pdfium.dll` in resources; add asset protocol security scope for render cache directory
