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
- **宏大叙事时间轴（.timeline）** — 垂直时间轴交替排布事件节点，支持拖拽排序与自由纪元文本日期
- **时间轴 AI 推演** — 一键分析时间悖论、逻辑断层和人物设定冲突，并给出结构化修正建议
- **AI 节点思索（AI Ponder）** — 以当前主题为中心自动扩展 3-5 个关联子节点并生成关系边
- **文件树 & 标签树** — 双视图浏览知识库，支持嵌套文件夹和层级标签
- **文件管理增强** — 支持右键菜单、拖拽移动、删除、重命名（含双击内联重命名）
- **知识图谱** — 基于双向链接的全局关系图谱可视化
- **语义搜索** — 通过 Embedding 向量实现语义级笔记检索
- **语义共鸣** — 编辑时实时推荐语义相关的笔记
- **AI 问答** — 基于知识库内容的 RAG 对话，支持流式输出
- **波谱可视化（.csv / .jdx）** — 原生解析 UV-Vis、FTIR、NMR 等仪器导出数据，WebGL 高性能渲染，支持多曲线叠加、滚轮缩放与平移，NMR 自动反转 x 轴
- **媒体预览** — 支持图片与 PDF 预览，图片支持缩放与拖拽平移
- **主题系统** — 支持浅色/深色主题切换，设置界面与主要视图统一适配
- **TRUTH_SYSTEM 看板** — 支持等级进度、属性雷达与 EXP 展示（启动页与底栏均可打开）
- **可调布局** — 左右侧栏支持拖拽调宽，视觉风格统一
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

## `.timeline` 文件格式

```json
{
  "events": [
    {
      "id": "evt-1",
      "date": "U.C.0079",
      "title": "事件标题",
      "description": "事件描述",
      "linkedNoteId": "world/chapter-1.md"
    }
  ]
}
```

- `date` 是自由文本，支持虚构纪元（如 `Crisis Era 205`）。
- `.timeline` 与 `.canvas` 一样属于结构化文件，不参与 Embedding 向量化。

## 波谱数据支持

支持直接打开科学仪器导出的光谱/波谱数据文件：

| 格式 | 说明 |
|------|------|
| `.csv` | 逗号/制表符分隔的波谱数据（支持 UTF-8 和 UTF-16 LE 编码） |
| `.jdx` | JCAMP-DX 标准格式（化学界通用交换格式） |

- 自动识别多列数据（如多次扫描），每列渲染为独立曲线
- NMR 数据自动检测并反转 x 轴（化学位移从高场到低场）
- 波谱文件不参与数据库内容索引和 Embedding 向量化，避免海量浮点数造成 Token 浪费

## 项目结构

```
src/                    # React 前端
├── assets/             # 静态资源（Logo / 图标）
├── components/         # UI 组件
│   ├── app/            # 顶层编排组件（TitleBar / Viewport / Modals / StatusBar / VaultManager）
│   ├── canvas/         # 画布视图与节点交互
│   ├── editor/         # 编辑器相关界面组件
│   ├── global-graph/   # 全局知识图谱视图
│   ├── media-viewer/   # 图片/PDF/波谱预览组件
│   ├── search/         # 搜索结果与语义检索 UI
│   └── sidebar/        # 侧边栏文件树/标签树/工具入口
├── editor/             # TipTap 编辑器扩展
│   └── extensions/     # WikiLink / Tag / Math
├── hooks/              # React Hooks
│   ├── useVaultSession.ts      # 知识库会话（打开/扫描/读写）
│   ├── useRuntimeSettings.ts   # 设置读取与保存
│   ├── useTruthSystem.ts       # TRUTH_SYSTEM 看板数据与交互
│   └── ...                     # 其余性能与交互 hooks
├── models/             # 前端领域模型
├── types/              # 拆分类型定义
├── utils/              # 工具函数（解析/格式化/通用算法）
└── types.ts            # 历史兼容类型入口

src-tauri/src/          # Rust 后端
├── commands/           # Tauri 命令分模块
│   ├── cmd_vault.rs    # 知识库生命周期与文件操作命令
│   ├── cmd_tree.rs     # 文件树/标签树构建与查询命令
│   ├── cmd_search.rs   # 搜索/FTS/语义检索命令
│   ├── cmd_ai.rs       # AI 问答与推理命令
│   ├── cmd_compute.rs  # Timeline 解析、TRUTH diff 等计算命令
│   └── cmd_media.rs    # 媒体与波谱解析命令
├── commands.rs         # 命令注册入口
├── db.rs               # SQLite 数据库管理
├── db/                 # 数据库子模块
│   ├── schema.rs       # 表结构与迁移
│   ├── notes.rs        # 笔记读写
│   ├── embeddings.rs   # 向量索引与 Embedding 存储
│   ├── relations.rs    # 双链关系维护
│   ├── parsing.rs      # 标签/链接提取与解析
│   ├── graph.rs        # 图谱查询
│   ├── lifecycle.rs    # 初始化/清理/维护流程
│   └── common.rs       # DB 公共工具
├── shared/             # 公共 helper 与跨模块共享逻辑
├── services/           # 领域服务层
├── ai.rs               # AI API 调用（Embedding + Chat + Ponder + Timeline Analyze）
├── models.rs           # 数据模型
└── lib.rs              # 应用入口
```

## 架构演进（近期）

- **前端 App 容器瘦身**：`App.tsx` 已从“状态 + 业务 + 渲染”混合体拆分为编排层，核心逻辑下沉到 hooks 与 app-level 组件
- **前端职责拆分**：新增 `components/app/`（标题栏、启动页、编辑视口、模态管理、状态栏），降低单文件复杂度
- **会话逻辑下沉**：Vault 打开/扫描、笔记读取、二进制预览、保存等行为集中在 `useVaultSession`
- **跨界面一致性**：主题变量体系覆盖浅色/深色，TRUTH_SYSTEM、设置页、侧边栏等模块统一适配
- **Rust 命令模块化**：`commands.rs` 从集中式文件拆分到 `commands/` 子模块，便于按领域维护与测试
- **共享与服务层**：`shared/` 与 `services/` 承担公共能力与领域逻辑，降低命令层重复代码

## License

[MIT](LICENSE)
