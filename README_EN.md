<p align="center">
  English | <a href="README.md">简体中文</a>
</p>

<p align="center">
  <img src=".logo/Logo.png" width="120" alt="Nexus Logo" />
</p>

<h1 align="center">Nexus</h1>

<p align="center">
  A local-first intelligent knowledge management tool with an Obsidian-like experience and built-in AI capabilities.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Tauri-2.x-blue?logo=tauri" alt="Tauri 2" />
  <img src="https://img.shields.io/badge/React-19-61dafb?logo=react" alt="React 19" />
  <img src="https://img.shields.io/badge/Rust-2021-orange?logo=rust" alt="Rust" />
  <img src="https://img.shields.io/badge/license-MIT-green" alt="MIT License" />
</p>

---

## Features

- **Local Markdown Editing** — WYSIWYG editor powered by TipTap with `[[wikilinks]]`, `#tags`, and LaTeX math
- **Native 2D Chemical Editor (.mol)** — Professional chemical structure editor powered by Ketcher, supporting molecular skeleton drawing, functional groups, and reactions with real-time Molfile serialization. Absolute minimalism dark theme (#0A0A0A background + electric blue accents). Supports `/chemdraw` slash command in Markdown for inline SMILES molecule insertion. Activity Bar dropdown supports both "New Molecule File" and "Insert into Note" modes
- **Auto Study Timeline** — Automatically tracks which files you open and how long you actively study (keyboard/mouse activity detection, 5-min idle timeout), stored in SQLite; view heatmap, folder ranking, and daily records from the Activity Bar
- **File Tree & Tag Tree** — Dual-view vault browsing with nested folders and hierarchical tags
- **Enhanced File Operations** — Context menu, drag-and-drop move, delete, rename, and inline rename by double-click
- **Knowledge Graph** — Obsidian-style force-directed graph with four automatic relation types: `[[wikilinks]]` (blue), tag co-occurrence (green), filename similarity (purple), and same-folder proximity (white); cross-folder notes connect via Jaccard token similarity
- **Semantic Search** — Embedding-powered semantic note retrieval
- **Semantic Resonance** — Real-time related note suggestions while you write
- **AI Q&A** — RAG-based chat grounded in your vault content, with streaming output
- **Chemistry-Focused Mode** — The current release is focused on chemistry workflows, with UI and features centered on molecular structures, symmetry, and spectroscopy
- **3D Molecular Viewer (.pdb / .xyz / .cif)** — Native WebGL rendering of proteins, crystals, and small molecules with automatic ball+stick or cartoon style selection and dark-fusion theme
- **Molecular Symmetry Analysis** — Molecular files support a "Structure / Symmetry" switch; a high-performance Rust engine computes point group, rotation axes, mirror planes, and inversion center, while the frontend renders from precomputed geometry
- **Crystal Lattice Analyzer** — `.cif` files support a "Structure / Symmetry / Lattice" three-view switch. The Rust backend parses CIF cell parameters, symmetry operations, and fractional coordinates to generate supercells (up to 5×5×5). Built-in Miller index slicer computes and renders a translucent crystal plane in real-time. All coordinate transforms and reciprocal-lattice math run in Rust; the frontend does zero computation. Dark background + ultra-thin cell wireframe + electric-blue slicing plane
- **Polymer Kinetics Simulator** — In chemistry mode, a Markdown-level sandbox provides slider-driven kinetics control; the Rust backend solves moment equations with RK4 and streams `conversion`, `Mn`, and `PDI` curves
- **Spectroscopy Viewer (.csv / .jdx)** — Natively parse UV-Vis, FTIR, NMR instrument exports with WebGL rendering, multi-trace overlay, scroll zoom/pan, and automatic NMR x-axis reversal
- **Media Preview** — Built-in image and PDF preview; images support zoom and pan
- **Onboarding Wizard** — A macOS-style step-by-step wizard on first launch that guides users through language, theme, font, and discipline setup with live theme preview; can be re-triggered from Settings
- **Multi-language Support (i18n)** — Built-in Chinese/English UI, all text driven by translation dictionaries; switch language instantly from Settings or onboarding
- **Theme System** — Light/Dark theme switching with consistent styling across settings and core views
- **TRUTH_SYSTEM Dashboard** — Chemistry skill-tree dashboard with level progress, attribute radar, and EXP panel (accessible from both startup and status bar)
- **Resizable Layout** — Left and right sidebars are resizable with consistent visual language
- **Fully Local Data** — SQLite storage, all your data stays on your machine

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Tauri 2 |
| Frontend | React 19 + TypeScript + Tailwind CSS 4 |
| Editor | TipTap 3 + KaTeX + 3Dmol.js + Ketcher |
| Backend | Rust + SQLite (rusqlite) |
| AI | OpenAI-compatible API (Chat + Embedding) |
| Build | Vite 6 |

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) >= 18
- [Rust](https://rustup.rs/) >= 1.77
- [Tauri 2 CLI prerequisites](https://v2.tauri.app/start/prerequisites/)

### Install & Run

```bash
# Clone the repository
git clone https://github.com/GTC2080/Nexus.git
cd Nexus

# Install frontend dependencies
npm install

# Start in development mode (compiles Rust + starts frontend)
npx tauri dev

# Build for production
npx tauri build
```

## AI Configuration

Open Settings (⌘,) from the bottom-left corner of the app and fill in:

- **Chat Model** — API Key, Base URL, model name (default: `gpt-4o-mini`)
- **Embedding Model** — Optional; leave empty to reuse Chat config (default: `text-embedding-3-small`)

Any OpenAI-compatible API endpoint is supported.

## Spectroscopy Data Support

Open instrument-exported spectral data files directly in the app:

| Format | Description |
|--------|-------------|
| `.csv` | Comma/tab-separated spectral data (UTF-8 and UTF-16 LE supported) |
| `.jdx` | JCAMP-DX standard format (universal chemistry interchange format) |

- Automatically detects multi-column data (e.g. multiple scans) and renders each as a separate trace
- NMR data is auto-detected with reversed x-axis (chemical shift from high to low field)
- Spectral files are excluded from database content indexing and embedding vectorization to avoid token waste on massive float arrays

## 3D Molecular Structure Support

The app is currently chemistry-focused, and you can directly open the following 3D structure files:

| Format | Description |
|--------|-------------|
| `.pdb` | Protein Data Bank — protein and small-molecule structures |
| `.xyz` | XYZ coordinate format (common in computational chemistry) |
| `.cif` | Crystallographic Information File |

- Small molecules (≤ 500 atoms) default to ball+stick rendering; proteins automatically switch to cartoon mode
- Dark-fusion background with Jmol standard atom coloring
- `.cif` files provide a three-view mode: "Structure / Symmetry / Lattice" with supercell expansion (1-5×) and Miller index slicer; non-CIF molecular files retain the "Structure / Symmetry" dual view
- Symmetry view shows point-group HUD, rotation axes, and mirror planes (individually togglable)
- Symmetry computation runs in Rust and supports PDB / XYZ / CIF; CIF cell parameters are accepted in both "same-line value" and "next-line value" styles
- Molecular files are excluded from database content indexing and embedding vectorization to prevent massive coordinate data from polluting semantic search

## Polymer Kinetics Sandbox

In chemistry mode, click `POLYMER KINETICS` in the Markdown editor to open a full-screen dark simulator:

- Left panel controls: `[M]0`, `[I]0`, `[CTA]0`, `kd`, `kp`, `kt`, `ktr`, `timeMax`, `steps`
- Frontend IPC is debounced (`150ms`) to avoid request congestion during slider drags
- Rust backend tracks radical/monomer states and 0/1/2 moments, returning `time / conversion / Mn / PDI`
- Two live Plotly charts:
  - `Conversion vs Time`
  - `Mn / PDI vs Conversion` (`PDI` on right y-axis)
- Initial divide-by-zero is guarded: before chain formation, `Mn = 0` and `PDI = 1.0`

## Project Structure

```
src/                    # React frontend
├── assets/             # Static assets (Logo / icons)
├── components/         # UI components
│   ├── app/            # Workspace shell, runtime, viewport, LaunchSplash, and modals
│   ├── ai/             # AI assistant sub-components (ChatBubble / AIContextPanel)
│   ├── KineticsSimulator.tsx  # Polymer kinetics sandbox (chemistry mode)
│   ├── CrystalViewer3D.tsx   # Crystal lattice 3D renderer (supercell + Miller plane slicer, chemistry mode)
│   ├── AIAssistantSidebar.tsx # AI assistant sidebar (thin orchestrator, logic in hooks)
│   ├── MarkdownEditor.tsx     # Main Markdown editor (thin orchestrator, extensions in hook)
│   ├── onboarding/     # First-run onboarding wizard
│   ├── study-timeline/ # Auto study timeline panel (heatmap/stats/daily records)
│   ├── chem-editor/    # Ketcher chemical editor components
│   ├── editor/         # Editor-facing UI components
│   ├── global-graph/   # Global knowledge graph view
│   ├── markdown-editor/ # Markdown editor menus, BubbleMenuBar, context actions, and helpers
│   ├── media-viewer/   # Image/PDF/spectroscopy preview components
│   ├── publish-studio/ # Assembly workspace for paper and note publishing flows
│   ├── search/         # Search results and semantic retrieval UI
│   ├── settings/       # Settings panels (split into 4 independent panels + shared components)
│   └── sidebar/        # File tree, tag tree, and side tools
├── i18n/               # Internationalization (i18n)
│   ├── zh-CN.ts        # Chinese translation dictionary
│   ├── en.ts           # English translation dictionary
│   ├── context.tsx     # LanguageProvider / useT / useLanguage
│   └── types.ts        # Language type definitions
├── editor/             # TipTap editor extensions
│   └── extensions/     # WikiLink / Tag / Math / ChemDraw
├── hooks/              # React hooks
│   ├── useVaultSession.ts           # Session orchestrator composed from indexing, content, persistence, and preview hooks
│   ├── useVaultIndex.ts             # Vault scanning, reindexing, and active-note reconciliation
│   ├── useActiveNoteContent.ts      # Active note content, preview loading, and discipline-specific state
│   ├── useAIChatStream.ts           # AI chat streaming logic (message history / streaming render / IPC channel)
│   ├── useMarkdownEditorExtensions.ts # TipTap extension configuration (memoized)
│   ├── useSettingsModal.ts          # Settings modal state management and operation logic
│   ├── useFileTreeDragDrop.ts       # File tree drag-and-drop logic
│   ├── useInlineRename.ts           # Inline rename logic
│   ├── useSidebarTags.ts            # Tag panel loading and filtering logic
│   ├── useSemanticResonance.ts      # Semantic resonance context building, caching, and adaptive debounce
│   ├── useNotePersistence.ts        # Save dedupe, queued writes, and explicit flush control
│   ├── useStudyTracker.ts           # Auto study timing hook (activity detection + Tauri IPC)
│   ├── useRuntimeSettings.ts        # Settings load/save logic
│   ├── useTruthSystem.ts            # TRUTH_SYSTEM dashboard state and interactions
│   └── ...                          # Other performance and interaction hooks
├── models/             # Frontend domain models
├── types/              # Split type definitions
├── *.test.ts           # Vitest unit-test entry points (types, settings, semantic resonance, etc.)
├── utils/              # Utilities (parsing/formatting/shared algorithms)
└── types.ts            # Legacy-compatible type entry

src-tauri/src/          # Rust backend
├── commands/           # Modular Tauri command handlers
│   ├── cmd_vault.rs    # Vault lifecycle and file operation commands
│   ├── cmd_tree.rs     # File tree/tag tree build and query commands
│   ├── cmd_search.rs   # Search / FTS / semantic retrieval commands
│   ├── cmd_ai.rs       # AI chat and reasoning commands
│   ├── cmd_study.rs    # Study timeline recording and statistics commands
│   ├── cmd_compute.rs  # TRUTH diff and compute commands
│   ├── cmd_media.rs    # Media and spectroscopy parsing commands
│   ├── cmd_symmetry.rs # Molecular symmetry analysis commands (point group / axes / planes)
│   └── cmd_crystal.rs  # Crystal lattice parsing and Miller plane commands (CIF → supercell → slicing plane)
├── commands.rs         # Command registration entry
├── crystal/            # Crystal lattice engine
│   ├── mod.rs          # Public interface (parse_and_build_lattice / calculate_miller_plane)
│   ├── types.rs        # Lattice data protocol (LatticeData / UnitCellBox / AtomNode / MillerPlaneData)
│   ├── parse.rs        # Full CIF parser (cell params / fractional coords / symmetry operations)
│   ├── supercell.rs    # Symmetry expansion + HashSet O(1) dedup + supercell generation
│   └── miller.rs       # Miller indices → reciprocal-lattice normal + d-spacing + visualization vertices
├── kinetics.rs         # Polymer kinetics solver (Method of Moments + RK4)
├── db.rs               # SQLite database management
├── db/                 # DB submodules
│   ├── schema.rs       # Schema definitions and migrations
│   ├── notes.rs        # Note read/write operations
│   ├── embeddings.rs   # Vector index and embedding storage
│   ├── relations.rs    # Bidirectional link relation maintenance
│   ├── parsing.rs      # Tag/link extraction and parsing
│   ├── graph.rs        # Graph queries (wikilink + tag co-occurrence + folder proximity)
│   ├── study.rs        # Study module entry (submodules: session / stats / truth)
│   ├── study/          # Study module subdir
│   │   ├── session.rs  # Session CRUD (start / tick / end)
│   │   ├── stats.rs    # Statistics aggregation queries (heatmap / daily / ranking)
│   │   └── truth.rs    # TruthState experience-level derivation
│   ├── lifecycle.rs    # Initialization/cleanup/maintenance flows
│   └── common.rs       # Shared DB utilities
├── shared/             # Shared helpers across command and service modules
├── services/           # Domain service layer
├── symmetry/           # Symmetry engine modules (parse/geometry/search/classify/render)
├── ai/                 # AI module (split by responsibility)
│   ├── mod.rs          # AiConfig definition and unified re-exports
│   ├── embedding.rs    # Embedding requests, LRU cache, and concurrency control
│   ├── chat.rs         # Streaming RAG chat and Ponder node generation
│   └── similarity.rs   # Cosine similarity computation
├── error.rs            # Typed error handling (AppError / AppResult)
├── models.rs           # Data models
└── lib.rs              # App entry point
```

## Architecture Evolution (Recent)

- **Crystal engine & extreme performance (v1.0.5)**: new Rust `crystal/` module (CIF parsing + symmetry expansion + supercell generation + Miller plane calculation), frontend `CrystalViewer3D` with zero-compute rendering. All file I/O commands migrated to `async fn` + `spawn_blocking` (9 commands). Graph similarity optimized from O(n²) to inverted index, supercell dedup from O(n³) to O(n) HashSet, new partial index on `embedding` column
- **Extreme performance optimization (v1.0.4)**:
  - Rust `scan_vault` restructured from per-file locking to batch timestamp pre-read + single-transaction writes, reducing Mutex overhead by ~99%
  - `rebuild_vector_index` changed from sequential to 4-way concurrent streaming with batched DB writes
  - High-frequency frontend components fully `React.memo`-ized; graph callbacks extracted to stable references
  - Global CSS `transition-all` replaced with precise property transitions across 10+ components
  - Launch splash screen replaces blank loading page with branded Logo + breathing glow + progress bar animation
- **Component splitting & hook extraction (v1.0.4)**: six 300-510 line "god components" split by single-responsibility principle, producing 11 new files (6 hooks + 5 sub-components) where each file does one thing
- **Lean app container**: `App.tsx` has been refactored into an orchestration layer instead of mixing state, business logic, and rendering
- **Frontend responsibility split**: `components/app/` now separates workspace shell, runtime, editor viewport, and `ActiveNoteContent` to keep render dispatch manageable
- **Layered session logic**: `useVaultSession` now orchestrates dedicated hooks for indexing, active content, binary previews, and queued persistence
- **Safer persistence flow**: added save fingerprint dedupe, queued disk writes, and explicit flush steps to reduce redundant writes and note-switch risk
- **Semantic + AI performance work**: semantic resonance now uses context extraction, caching, and adaptive debounce; the AI sidebar separates historical and streaming message rendering
- **Testing baseline added**: introduced `Vitest + jsdom` to cover types, settings, and semantic recommendation logic with foundational unit tests
- **Cross-view consistency**: theme-token system now covers both light/dark modes consistently across Settings, Sidebar, and TRUTH_SYSTEM dashboard
- **Modular Rust commands**: command handlers moved from monolithic `commands.rs` into `commands/` submodules for easier maintenance and testing
- **AI module split**: `ai.rs` refactored into `ai/` submodules (embedding / chat / similarity) for better maintainability
- **Shared + service layers**: `shared/` and `services/` host reusable helpers and domain logic to reduce duplication in command handlers
- **Multi-language system**: lightweight React Context–based i18n in `i18n/`; `useT()` hook drives translation switching across the component tree with parameter interpolation
- **Typed error handling**: Rust-side `AppError` enum via `thiserror` replaces all `Result<T, String>`, with serializable error types forwarded to the frontend
- **React Compiler**: integrated babel-plugin-react-compiler for automatic memoization, eliminating manual `useMemo`/`useCallback` maintenance
- **Global Error Boundary**: `ErrorBoundary` wraps all Suspense zones so a single module crash cannot take down the entire app
- **Expanded test coverage**: test suite grew from 13 to 38 cases, covering core hooks (persistence, debounce, file actions) and ErrorBoundary
- **Chemical editor**: replaced @xyflow/react generic canvas with Ketcher professional molecule editor (.mol format), CSS penetration for absolute-minimalism dark theme, /chemdraw slash command for inline molecule insertion in Markdown

## License

[MIT](LICENSE)
