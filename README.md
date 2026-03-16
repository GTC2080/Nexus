<p align="center">
  <a href="README_EN.md">English</a> | 简体中文
</p>

<p align="center">
  <img src=".logo/Logo.png" width="120" alt="Nexus Logo" />
</p>

<h1 align="center">Nexus · 星枢</h1>

<p align="center">
  本地优先的智能知识管理工具，类 Obsidian 体验，内置 AI 能力。
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Tauri-2.x-blue?logo=tauri" alt="Tauri 2" />
  <img src="https://img.shields.io/badge/React-19-61dafb?logo=react" alt="React 19" />
  <img src="https://img.shields.io/badge/Rust-2021-orange?logo=rust" alt="Rust" />
  <img src="https://img.shields.io/badge/license-MIT-green" alt="MIT License" />
</p>

---

## 特性

- **本地 Markdown 编辑** — 基于 TipTap 的所见即所得编辑器，支持 `[[双向链接]]`、`#标签`、LaTeX 数学公式
- **无限空间画布（.canvas）** — 在二维画布中组织节点与连线，支持本地 JSON 持久化
- **AI 节点思索（AI Ponder）** — 以当前主题为中心自动扩展 3-5 个关联子节点并生成关系边
- **文件树 & 标签树** — 双视图浏览知识库，支持嵌套文件夹和层级标签
- **文件管理增强** — 支持右键菜单、拖拽移动、删除、重命名（含双击内联重命名）
- **知识图谱** — 基于双向链接的全局关系图谱可视化
- **语义搜索** — 通过 Embedding 向量实现语义级笔记检索
- **语义共鸣** — 编辑时实时推荐语义相关的笔记
- **AI 问答** — 基于知识库内容的 RAG 对话，支持流式输出
- **媒体预览** — 支持图片与 PDF 预览，图片支持缩放与拖拽平移
- **可调布局** — 左右侧栏支持拖拽调宽，深色圆润视觉统一
- **数据完全本地** — SQLite 存储，所有数据留在你的硬盘上

## 技术栈

| 层级 | 技术 |
|------|------|
| 框架 | Tauri 2 |
| 前端 | React 19 + TypeScript + Tailwind CSS 4 |
| 编辑器 | TipTap 3 + KaTeX |
| 后端 | Rust + SQLite (rusqlite) |
| AI | OpenAI 兼容 API (Chat + Embedding) |
| 构建 | Vite 6 |

## 快速开始

### 环境要求

- [Node.js](https://nodejs.org/) >= 18
- [Rust](https://rustup.rs/) >= 1.77
- [Tauri 2 CLI 前置依赖](https://v2.tauri.app/start/prerequisites/)

### 安装 & 运行

```bash
# 克隆仓库
git clone https://github.com/GTC2080/Nexus.git
cd Nexus

# 安装前端依赖
npm install

# 开发模式启动（自动编译 Rust + 启动前端）
npx tauri dev

# 构建生产包
npx tauri build
```

## AI 配置

在应用内点击左下角「设置」(⌘,)，填入：

- **Chat 模型** — API Key、Base URL、模型名称（默认 `gpt-4o-mini`）
- **Embedding 模型** — 可选，留空则复用 Chat 配置（默认 `text-embedding-3-small`）

支持任何 OpenAI 兼容的 API 端点。

## 项目结构

```
src/                    # React 前端
├── components/         # UI 组件
│   └── sidebar/        # 侧边栏子模块
├── editor/             # TipTap 编辑器扩展
│   └── extensions/     # WikiLink / Tag / Math
├── hooks/              # React Hooks
└── types.ts            # 类型定义

src-tauri/src/          # Rust 后端
├── commands.rs         # Tauri 命令（文件扫描、画布/文件操作、搜索、图谱等）
├── db.rs               # SQLite 数据库管理
├── ai.rs               # AI API 调用（Embedding + Chat + Ponder）
├── models.rs           # 数据模型
└── lib.rs              # 应用入口
```

## License

[MIT](LICENSE)
