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
- **Infinite Canvas (.canvas)** — Organize knowledge on a 2D canvas with local JSON persistence
- **Narrative Timeline (.timeline)** — Vertical timeline with alternating event cards, drag-to-reorder, and free-form era/date text
- **AI Timeline Analysis** — Detect temporal paradoxes, logical gaps, and character-setting conflicts with structured suggestions
- **AI Ponder for Nodes** — Expand a topic into 3-5 related child nodes with labeled relations
- **File Tree & Tag Tree** — Dual-view vault browsing with nested folders and hierarchical tags
- **Enhanced File Operations** — Context menu, drag-and-drop move, delete, rename, and inline rename by double-click
- **Knowledge Graph** — Global relationship graph visualization based on bidirectional links
- **Semantic Search** — Embedding-powered semantic note retrieval
- **Semantic Resonance** — Real-time related note suggestions while you write
- **AI Q&A** — RAG-based chat grounded in your vault content, with streaming output
- **Spectroscopy Viewer (.csv / .jdx)** — Natively parse UV-Vis, FTIR, NMR instrument exports with WebGL rendering, multi-trace overlay, scroll zoom/pan, and automatic NMR x-axis reversal
- **Media Preview** — Built-in image and PDF preview; images support zoom and pan
- **Theme System** — Light/Dark theme switching with consistent styling across settings and core views
- **TRUTH_SYSTEM Dashboard** — Level progress, attribute radar, and EXP panel (accessible from both startup and status bar)
- **Resizable Layout** — Left and right sidebars are resizable with consistent visual language
- **Fully Local Data** — SQLite storage, all your data stays on your machine

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Tauri 2 |
| Frontend | React 19 + TypeScript + Tailwind CSS 4 |
| Editor | TipTap 3 + KaTeX |
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

## `.timeline` File Schema

```json
{
  "events": [
    {
      "id": "evt-1",
      "date": "U.C.0079",
      "title": "Event title",
      "description": "Event description",
      "linkedNoteId": "world/chapter-1.md"
    }
  ]
}
```

- `date` is free-form text (supports fictional eras like `Crisis Era 205`).
- `.timeline` is treated as structured JSON (same as `.canvas`) and is excluded from embedding vectorization.

## Spectroscopy Data Support

Open instrument-exported spectral data files directly in the app:

| Format | Description |
|--------|-------------|
| `.csv` | Comma/tab-separated spectral data (UTF-8 and UTF-16 LE supported) |
| `.jdx` | JCAMP-DX standard format (universal chemistry interchange format) |

- Automatically detects multi-column data (e.g. multiple scans) and renders each as a separate trace
- NMR data is auto-detected with reversed x-axis (chemical shift from high to low field)
- Spectral files are excluded from database content indexing and embedding vectorization to avoid token waste on massive float arrays

## Project Structure

```
src/                    # React frontend
├── assets/             # Static assets (Logo / icons)
├── components/         # UI components
│   ├── app/            # App-level composition (TitleBar / Viewport / Modals / StatusBar / VaultManager)
│   ├── canvas/         # Canvas views and node interactions
│   ├── editor/         # Editor-facing UI components
│   ├── global-graph/   # Global knowledge graph view
│   ├── media-viewer/   # Image/PDF/spectroscopy preview components
│   ├── search/         # Search results and semantic retrieval UI
│   └── sidebar/        # File tree, tag tree, and side tools
├── editor/             # TipTap editor extensions
│   └── extensions/     # WikiLink / Tag / Math
├── hooks/              # React hooks
│   ├── useVaultSession.ts      # Vault session (open/scan/read/write)
│   ├── useRuntimeSettings.ts   # Settings load/save logic
│   ├── useTruthSystem.ts       # TRUTH_SYSTEM dashboard state and interactions
│   └── ...                     # Other performance and interaction hooks
├── models/             # Frontend domain models
├── types/              # Split type definitions
├── utils/              # Utilities (parsing/formatting/shared algorithms)
└── types.ts            # Legacy-compatible type entry

src-tauri/src/          # Rust backend
├── commands/           # Modular Tauri command handlers
│   ├── cmd_vault.rs    # Vault lifecycle and file operation commands
│   ├── cmd_tree.rs     # File tree/tag tree build and query commands
│   ├── cmd_search.rs   # Search / FTS / semantic retrieval commands
│   ├── cmd_ai.rs       # AI chat and reasoning commands
│   ├── cmd_compute.rs  # Timeline parsing, TRUTH diff and compute commands
│   └── cmd_media.rs    # Media and spectroscopy parsing commands
├── commands.rs         # Command registration entry
├── db.rs               # SQLite database management
├── db/                 # DB submodules
│   ├── schema.rs       # Schema definitions and migrations
│   ├── notes.rs        # Note read/write operations
│   ├── embeddings.rs   # Vector index and embedding storage
│   ├── relations.rs    # Bidirectional link relation maintenance
│   ├── parsing.rs      # Tag/link extraction and parsing
│   ├── graph.rs        # Graph queries
│   ├── lifecycle.rs    # Initialization/cleanup/maintenance flows
│   └── common.rs       # Shared DB utilities
├── shared/             # Shared helpers across command and service modules
├── services/           # Domain service layer
├── ai.rs               # AI API calls (Embedding + Chat + Ponder + Timeline Analyze)
├── models.rs           # Data models
└── lib.rs              # App entry point
```

## Architecture Evolution (Recent)

- **Lean app container**: `App.tsx` has been refactored into an orchestration layer instead of mixing state, business logic, and rendering
- **Frontend responsibility split**: introduced `components/app/` (TitleBar, Manager View, Editor Viewport, Modals, StatusBar) to reduce single-file complexity
- **Session logic extraction**: vault open/scan, note loading, binary preview, and save flows are centralized in `useVaultSession`
- **Cross-view consistency**: theme-token system now covers both light/dark modes consistently across Settings, Sidebar, and TRUTH_SYSTEM dashboard
- **Modular Rust commands**: command handlers moved from monolithic `commands.rs` into `commands/` submodules for easier maintenance and testing
- **Shared + service layers**: `shared/` and `services/` host reusable helpers and domain logic to reduce duplication in command handlers

## License

[MIT](LICENSE)
