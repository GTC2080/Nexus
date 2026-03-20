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
- **自动化学术排版发刊（.paper）** — 拖拽组装多个 Markdown 节点，一键调用 Pandoc + XeLaTeX 生成并预览发刊级 PDF，支持模板/CSL/BibTeX 参数
- **原生 2D 分子绘图板 (.mol)** — 基于 Ketcher 的专业化学结构编辑器，支持绘制分子骨架、官能团与反应式，实时序列化为 Molfile 格式落盘。绝对极简暗色主题（#0A0A0A 背景 + 电光蓝高亮），Markdown 内支持 `/chemdraw` 快捷命令内联插入 SMILES 分子式
- **自动学习时间轴** — 后台自动记录用户打开的文件和活跃学习时长（键盘/鼠标活动检测，5 分钟空闲自动暂停），数据存入 SQLite，Activity Bar 一键查看学习热力图、文件夹排行和每日记录
- **文件树 & 标签树** — 双视图浏览知识库，支持嵌套文件夹和层级标签
- **文件管理增强** — 支持右键菜单、拖拽移动、删除、重命名（含双击内联重命名）
- **知识图谱** — Obsidian 风格全局关系图谱，自动扫描四种关联：`[[双向链接]]`（蓝）、标签共现（绿）、文件名相似度（紫）、同文件夹（白），力导向布局自然聚类
- **语义搜索** — 通过 Embedding 向量实现语义级笔记检索
- **语义共鸣** — 编辑时实时推荐语义相关的笔记
- **AI 问答** — 基于知识库内容的 RAG 对话，支持流式输出
- **化学专注模式** — 当前版本聚焦化学学科，界面与功能围绕分子结构、对称性与波谱工作流设计
- **3D 分子结构查看器（.pdb / .xyz / .cif）** — 原生 WebGL 渲染蛋白质、晶体及小分子结构，自动选择 ball+stick 或 cartoon 表现形式，暗黑融合主题
- **分子对称性分析（Symmetry）** — 分子文件支持「结构 / 对称性」切换，Rust 后端高性能计算点群、旋转轴、镜面与反演中心，前端按返回几何数据零计算渲染
- **无机纳米晶格解析器（Crystal Lattice）** — `.cif` 文件支持「结构 / 对称性 / 晶格」三视图切换。Rust 后端解析 CIF 晶胞参数、对称操作与分数坐标，生成超晶胞（最高 5×5×5）。内置密勒指数切割器，输入 (h, k, l) 实时计算并渲染半透明晶面。所有坐标转换与倒格矢计算由 Rust 完成，前端零计算。暗黑背景 + 极细晶胞线框 + 电光蓝切割面
- **高分子聚合动力学沙盘（Polymer Kinetics）** — 化学模式下可在 Markdown 视图打开参数滑块沙盘，Rust 后端以矩方法 + RK4 数值积分实时返回转化率、`Mn`、`PDI` 曲线
- **波谱可视化（.csv / .jdx）** — 原生解析 UV-Vis、FTIR、NMR 等仪器导出数据，WebGL 高性能渲染，支持多曲线叠加、滚轮缩放与平移，NMR 自动反转 x 轴
- **媒体预览** — 支持图片与 PDF 预览，图片支持缩放与拖拽平移
- **首次启动引导** — macOS 风格的分步向导，首次运行时引导用户设置语言、主题、字体和学科方向，支持实时主题预览，可在设置中重新触发
- **多语言支持（i18n）** — 内置中文/英文双语界面，所有 UI 文本通过翻译字典驱动，设置或引导中一键切换语言全局生效
- **主题系统** — 支持浅色/深色主题切换，设置界面与主要视图统一适配
- **TRUTH_SYSTEM 看板** — 化学技能树看板，支持等级进度、属性雷达与 EXP 展示（启动页与底栏均可打开）
- **可调布局** — 左右侧栏支持拖拽调宽，视觉风格统一
- **数据完全本地** — SQLite 存储，所有数据留在你的硬盘上

## 更新日志

### v1.0.6 · 2026-03-20

#### 全量性能优化（15 项）

**P0 — 数据安全**
- **保存队列重写** — `useNotePersistence` 从单值 `pendingRef` 改为 `Map<filePath, SaveRequest>`，消除多文件快速切换时的丢数据风险；同一文件连续修改只落盘最后版本
- **保存测试补齐** — 新增 5 个测试用例：多文件并发保存、交错保存、flushPendingSave 等待所有文件完成、部分失败不阻塞其他文件

**P1 — 大库性能**
- **增量文件监听** — Rust 新增 `scan_changed_entries` / `index_changed_entries` / `remove_deleted_entries` 三个命令，watcher 事件不再触发全库扫描，改为按路径列表增量 merge
- **向量检索内存缓存** — 新增 `VectorCacheState`，首次查询后将所有 embedding 常驻内存；查询改用 `BinaryHeap` top-k 替代全量排序，语义搜索、相关笔记、AI RAG 四处调用站全部受益
- **文件树变更检测修正** — `notesKey` 从 `length:first:last` 近似判定改为 FNV-1a 内容指纹（覆盖所有 id + updated_at），中间项变化不再漏更新

**P2 — 交互流畅度**
- **PDF 渲染链路瘦身** — 渲染结果不再生成 base64 data URL，前端统一走 `convertFileSrc()` 文件协议；移除 `base64` crate 依赖
- **PDF 预取并发限制** — 预取相邻页面加 `Semaphore(2)` 上限，满时跳过而非排队，避免过期任务挤占渲染线程
- **面板拖拽零渲染** — `useResizable` 拖拽期间用 `requestAnimationFrame` 节流 + CSS 变量直写，鼠标释放后才回写 React state，拖拽全程不触发 React 重渲染
- **Ketcher 汉化优化** — `WeakSet` 标记已翻译节点替代反复 DOM 扫描；MutationObserver 回调改为 `requestAnimationFrame` 帧级合并；前缀匹配按长度降序预排序

**P3 — 长期基建**
- **图谱缓存修正** — 图谱是否重新拉取从 `notes.length` 改为 FNV-1a 内容指纹；布局缓存版本号加入节点 ID 信息，链接变化不再复用旧布局
- **性能基线工具** — `perf.ts` 增强：指标历史记录（最近 20 次）、`getSummary()` 统计摘要（avg/min/max/p90）、`printBaseline()` 控制台格式化输出、`window.__perf` 全局访问
- **构建产物分析** — 接入 `rollup-plugin-visualizer`，`ANALYZE=true npm run build` 生成交互式 bundle 可视化报告

#### 架构改进
- **watcher 模块拆分** — `watcher.rs` 拆为 `watcher/mod.rs`（状态管理）、`watcher/filter.rs`（路径过滤）、`watcher/handler.rs`（事件回调）
- **向量缓存模块** — 新增 `ai/vector_cache.rs`，内存缓存 + top-k BinaryHeap 查询，支持 upsert / remove / clear 生命周期管理

### v1.0.5 · 2026-03-20

#### 新功能：无机纳米晶格解析器

- **Rust 晶格引擎** — 新增 `crystal/` 模块（parse / supercell / miller / types），完整解析 CIF 晶胞参数、对称操作（`_symmetry_equiv_pos_as_xyz`）与分数坐标，支持超晶胞扩展（最高 5×5×5，50K 原子上限保护）
- **密勒指数切割器** — 输入 (h, k, l) 实时计算倒格矢法向量与面间距，渲染半透明电光蓝切割面
- **CrystalViewer3D 前端** — 3Dmol.js 暗黑渲染器，CPK 原子着色 + 极细灰色晶胞线框 + 超晶胞/密勒面控制台
- **三视图切换** — CIF 文件在分子查看器中新增「晶格」标签页（结构 / 对称性 / 晶格）

#### 极致性能优化

- **超晶胞去重 O(n³) → O(n)** — 对称操作展开从 `Vec::iter().any()` 线性扫描改为 `HashSet<grid_key>` 哈希去重
- **文件操作全面异步化** — `cmd_vault_entries` 全部 4 个命令 + `cmd_media` 全部 5 个命令迁移至 `async fn` + `spawn_blocking`，彻底消除文件 I/O 阻塞 Tauri 主线程
- **图谱相似度 O(n²) → 倒排索引** — 文件名相似度从全量双循环改为 token 倒排索引 + 候选对计数，1000 笔记从 ~500K 对比降至仅比较共享 token 的节点对
- **零拷贝 UTF-8 转换** — `read_note` 消除 `bytes.clone()`，失败时从 error 直接取 bytes 引用
- **embedding 列部分索引** — 新增 `idx_notes_has_embedding` WHERE 索引，语义搜索避免全表扫描
- **文件树 key 优化** — `notesKey` 从 `notes.map(id).join("\n")` 改为 `length:first:last` 轻量哈希

#### 代码质量

- **提取 `useContextMenuDismiss` hook** — Sidebar 与 VaultManagerView 中 ~42 行重复事件监听逻辑合并为共享 hook
- **FileTreeContextMenu 数据驱动** — 12 个重复按钮替换为 `MenuItem` 组件 + 配置数组循环，删除冗余 hover 处理器
- **VaultManagerView 卡片数组化** — 4 个相同结构的 action card 改为 `.map()` 渲染

### v1.0.4 · 2026-03-19

#### 计算迁移 — 前端重计算下沉到 Rust

- 语义上下文提取（`buildSemanticContext` + `hashText`）→ Rust `get_related_notes_raw`，前端零计算直传原始内容
- 标签树构建（JS `buildTagTree` O(n*m)）→ Rust `get_tag_tree` 直接返回嵌套树
- 图谱邻接索引（3 个 `useMemo`）→ Rust `get_enriched_graph_data` 预计算邻接表 + 链接对
- 热力图网格（JS 182 格日期计算）→ Rust `get_heatmap_cells` 预计算 26×7 网格
- 化学计量计算 → Rust `recalculate_stoichiometry` 命令就绪
- 数据库归一化 → Rust `normalize_database` 命令就绪

#### 架构级性能优化

- **修复双重 `scan_vault`** — 启动时 vault 扫描从 2 次降为 1 次
- **事件驱动替代轮询** — Truth System 从 30s 轮询改为监听 `study-tick` 事件，IPC 调用量 -80%
- **全局笔记缓存** — `NoteContentCacheProvider` LRU 20 条，切换笔记省去重复磁盘读
- **乐观删除** — 删除操作 UI 立即响应，失败自动回滚
- **批量 SQL** — 文件夹删除从 N×4 条 SQL → 4 条批量 DELETE
- **复合索引** — `note_links(target_name, source_id)` 加速反向链接查询
- **FTS 延迟填充** — 仅首次创建时填充全文索引，避免每次打开 vault 阻塞
- **内存分配优化** — `Vec::with_capacity`、`String::with_capacity` 减少 ~30% 堆分配

#### 渲染性能优化

- **CSS hover 替代 DOM 操作** — 6 个组件的 `style.background` 直接操作改为 CSS `:hover` 类，消除 layout thrashing
- **组件 memo** — `WorkspaceShell`、`EditorViewport` 加 `React.memo` 防止不必要 re-render
- **文件树 memoize** — `notes` 引用稳定化，避免 `build_file_tree` 无效重建
- **Study tracker 错误处理** — fire-and-forget invoke 补充 `.catch()`，防止静默丢失数据

#### 用户体验

- **零延迟启动画面** — 纯 HTML/CSS 内联 splash（logo + 呼吸光晕 + 进度条），窗口打开即渲染，React 挂载后淡出
- **Ketcher 暗色主题修复** — 分子画板 SVG 原子标签/化学键颜色适配深色背景
- **窗口居中** — 启动时窗口自动定位到屏幕正中央
- **设置面板重构** — 活动栏功能开关独立为"功能"tab，与常规设置分离

#### 代码架构重构

- `AIAssistantSidebar`（510→216 行）：拆分为 `useAIChatStream` hook + `ChatBubble` + `AIContextPanel`
- `SettingsPanels`（380→28 行）：拆分为 5 个独立面板文件 + 共享组件
- `MarkdownEditor`（359→223 行）：提取 `useMarkdownEditorExtensions` hook + `BubbleMenuBar`
- `SettingsModal`（315→152 行）：提取 `useSettingsModal` hook
- `FileTree`（339→264 行）：提取 `useFileTreeDragDrop` + `useInlineRename` hooks
- `Sidebar`（307→267 行）：提取 `useSidebarTags` hook

### v1.0.3 · 2026-03-19

- **化学绘图板替代画布** — 移除通用 React Flow 画布（@xyflow/react），引入 Ketcher 专业分子编辑器，支持 .mol 文件类型，绝对极简暗色主题覆盖，Markdown 内 /chemdraw 快捷命令
- **Activity Bar 分子绘图下拉菜单** — 化学绘图按钮升级为下拉菜单，支持「新建分子文件」和「插入到笔记」两种模式，后者仅在编辑 Markdown 时可用
- **多语言支持（i18n）**：新增完整英文界面，通过 `LanguageProvider` + `useT()` 翻译系统驱动，覆盖 40+ 组件 300+ 条翻译条目，设置或引导中一键切换
- **Rust 类型化错误处理**：新增 `AppError` 枚举（thiserror），替换全部 `Result<T, String>`，覆盖 10 个命令模块 + 9 个数据库模块
- **Rust 锁优化**：合并 `ask_vault` 和 `rebuild_vector_index` 中的多次重复加锁为单次作用域锁
- **React Compiler**：集成 `babel-plugin-react-compiler`，自动优化组件 memoization
- **React Error Boundary**：新增全局错误边界组件，包裹 4 个 Suspense 区域，防止单点崩溃拖垮全局
- **useTransition 优化**：Sidebar、GlobalGraphModal、useVaultSession 改用 `useTransition` 管理异步状态
- **测试覆盖扩充**：新增 ErrorBoundary、useDebounce、useVaultEntryActions、useNotePersistence 共 25 个测试（总计 38 个）

### v1.0.2 · 2026-03-19

- 知识图谱增强：Obsidian 风格力导向图谱，自动扫描四种关联——`[[双向链接]]`（蓝）、标签共现（绿）、文件名相似度（紫）、同文件夹（白），跨文件夹笔记通过文件名词元 Jaccard 相似度自动关联
- 学习模块重构：`db/study.rs` 拆分为 `study/session.rs`（CRUD）、`study/stats.rs`（统计查询）、`study/truth.rs`（Truth 推导）三个子模块，消除重复代码
- 新增自动学习时间轴：后台自动记录活跃学习时长与文件访问，Activity Bar 一键查看热力图、文件夹排行和每日记录
- 新增首次启动引导向导：macOS 风格分步设置语言、主题、字体和学科方向
- 修复 Markdown 编辑器语法不渲染问题（tiptap-markdown 兼容性修复）
- 新增 Markdown 表格支持（TipTap Table 扩展）
- 右键菜单子菜单交互优化，修复鼠标移向子菜单时消失的问题
- 移除旧 .timeline 手动时间轴功能，统一为自动记录

### v1.0.1 · 2026-03-18

- 新增 `.paper` 发布工作台：支持拖拽章节组装、异步编译、PDF 实时预览
- 新增 Rust 编译管线命令：后端静默检测 Pandoc/XeLaTeX 环境并返回友好错误日志
- 首屏体积优化（第三轮）：将工作区运行时拆为懒加载模块，降低启动入口 JS 负载

## 技术栈

| 层级 | 技术 |
|------|------|
| 框架 | Tauri 2 |
| 前端 | React 19 + TypeScript + Tailwind CSS 4 |
| 编辑器 | TipTap 3 + KaTeX + 3Dmol.js + Ketcher |
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

## 波谱数据支持

支持直接打开科学仪器导出的光谱/波谱数据文件：

| 格式 | 说明 |
|------|------|
| `.csv` | 逗号/制表符分隔的波谱数据（支持 UTF-8 和 UTF-16 LE 编码） |
| `.jdx` | JCAMP-DX 标准格式（化学界通用交换格式） |

- 自动识别多列数据（如多次扫描），每列渲染为独立曲线
- NMR 数据自动检测并反转 x 轴（化学位移从高场到低场）
- 波谱文件不参与数据库内容索引和 Embedding 向量化，避免海量浮点数造成 Token 浪费

## 3D 分子结构支持

应用当前为化学专注模式，可直接打开以下三维结构文件：

| 格式 | 说明 |
|------|------|
| `.pdb` | Protein Data Bank 蛋白质/小分子结构 |
| `.xyz` | XYZ 坐标系格式（计算化学常用） |
| `.cif` | Crystallographic Information File 晶体学数据 |

- 小分子（≤500 原子）默认 ball+stick 渲染，蛋白质自动切换 cartoon 模式
- 深色融合背景，Jmol 科学标准原子配色
- `.cif` 文件支持「结构 / 对称性 / 晶格」三视图：晶格视图提供超晶胞扩展控制（1-5×）与密勒指数切割器，非 CIF 文件保持「结构 / 对称性」双视图
- 在对称性视图中显示点群 HUD、旋转轴与镜像平面（可独立开关）
- 对称性计算由 Rust 引擎完成：支持 PDB / XYZ / CIF 输入，CIF 晶胞参数支持“标签同一行”与“值在下一行”两种写法
- 分子文件不参与数据库内容索引和 Embedding 向量化，防止海量坐标数据污染语义检索

## 高分子动力学沙盘

化学模式下，在 Markdown 编辑视图点击 `POLYMER KINETICS` 按钮可打开全屏暗色沙盘：

- 左侧通过滑块和数值输入调节参数：`[M]0`、`[I]0`、`[CTA]0`、`kd`、`kp`、`kt`、`ktr`、`timeMax`、`steps`
- 前端使用 `150ms` 防抖触发 IPC，避免滑块拖动造成调用拥塞
- Rust 后端追踪自由基、单体与 0/1/2 阶矩，返回 `time / conversion / Mn / PDI`
- 图表区显示两张实时曲线：
  - `Conversion vs Time`
  - `Mn / PDI vs Conversion`（`PDI` 使用右侧 y 轴）
- 初始阶段自动阻断除零异常：链尚未形成时强制 `Mn = 0`、`PDI = 1.0`

## 项目结构

```
src/                    # React 前端
├── assets/             # 静态资源（Logo / 图标）
├── components/         # UI 组件
│   ├── app/            # 工作区壳层与视口编排（Shell / Runtime / Viewport / LaunchSplash / Modals）
│   ├── ai/             # AI 助手子组件（ChatBubble / AIContextPanel）
│   ├── KineticsSimulator.tsx  # 高分子动力学沙盘（化学模式）
│   ├── CrystalViewer3D.tsx   # 晶格 3D 渲染器（超晶胞 + 密勒面切割，化学模式）
│   ├── AIAssistantSidebar.tsx # AI 助手侧边栏（编排层，逻辑下沉到 hooks）
│   ├── MarkdownEditor.tsx     # 主 Markdown 编辑器（编排层，扩展配置下沉到 hook）
│   ├── onboarding/     # 首次启动引导向导
│   ├── study-timeline/ # 自动学习时间轴面板（热力图/统计/每日记录）
│   ├── chem-editor/    # Ketcher 化学绘图板组件
│   ├── editor/         # 编辑器相关界面组件
│   ├── global-graph/   # 全局知识图谱视图
│   ├── markdown-editor/ # Markdown 编辑器菜单、BubbleMenuBar、上下文操作与辅助工具
│   ├── media-viewer/   # 图片/PDF/波谱预览组件
│   ├── publish-studio/ # 论文/笔记装配与发布工作台
│   ├── search/         # 搜索结果与语义检索 UI
│   ├── settings/       # 设置面板（按职责拆分为 5 个独立面板：常规/功能/编辑器/AI/知识库 + 共享组件）
│   └── sidebar/        # 侧边栏文件树/标签树/工具入口
├── i18n/               # 国际化（i18n）
│   ├── zh-CN.ts        # 中文翻译字典
│   ├── en.ts           # 英文翻译字典
│   ├── context.tsx     # LanguageProvider / useT / useLanguage
│   └── types.ts        # 语言类型定义
├── editor/             # TipTap 编辑器扩展
│   └── extensions/     # WikiLink / Tag / Math / ChemDraw
├── hooks/              # React Hooks
│   ├── useVaultSession.ts           # 会话编排入口（组合索引、内容、保存与预览 hooks）
│   ├── useVaultIndex.ts             # 知识库扫描、重建索引与活动文件校正
│   ├── useActiveNoteContent.ts      # 当前笔记内容、预览与学科视图状态
│   ├── useAIChatStream.ts           # AI 聊天流式逻辑（消息历史/流式渲染/IPC 通道）
│   ├── useMarkdownEditorExtensions.ts # TipTap 扩展配置（memoized）
│   ├── useSettingsModal.ts          # 设置弹窗状态管理与操作逻辑
│   ├── useFileTreeDragDrop.ts       # 文件树拖拽逻辑
│   ├── useInlineRename.ts           # 行内重命名逻辑
│   ├── useSidebarTags.ts            # 标签面板加载与筛选逻辑
│   ├── useSemanticResonance.ts      # 语义共鸣上下文提取、缓存与自适应防抖
│   ├── useNotePersistence.ts        # 保存去重、排队写盘与 flush 控制
│   ├── useStudyTracker.ts           # 自动学习计时 Hook（活跃检测 + Tauri IPC）
│   ├── useRuntimeSettings.ts        # 设置读取与保存
│   ├── useTruthSystem.ts            # TRUTH_SYSTEM 看板数据与交互
│   └── ...                          # 其余性能与交互 hooks
├── models/             # 前端领域模型
├── types/              # 拆分类型定义
├── *.test.ts           # Vitest 单元测试入口（类型、设置、语义推荐等）
├── utils/              # 工具函数（解析/格式化/通用算法）
└── types.ts            # 历史兼容类型入口

src-tauri/src/          # Rust 后端
├── commands/           # Tauri 命令分模块
│   ├── cmd_vault.rs    # 知识库生命周期与文件操作命令
│   ├── cmd_tree.rs     # 文件树/标签树构建与查询命令
│   ├── cmd_search.rs   # 搜索/FTS/语义检索命令
│   ├── cmd_ai.rs       # AI 问答与推理命令
│   ├── cmd_study.rs    # 学习时间轴记录与统计命令
│   ├── cmd_compute.rs  # TRUTH diff 等计算命令
│   ├── cmd_media.rs    # 媒体与波谱解析命令
│   ├── cmd_symmetry.rs # 分子对称性分析命令（点群/轴/镜面）
│   └── cmd_crystal.rs  # 晶格解析与密勒面计算命令（CIF → 超晶胞 → 切割面）
├── commands.rs         # 命令注册入口
├── crystal/            # 晶格引擎模块
│   ├── mod.rs          # 公开接口（parse_and_build_lattice / calculate_miller_plane）
│   ├── types.rs        # 晶格数据协议（LatticeData / UnitCellBox / AtomNode / MillerPlaneData）
│   ├── parse.rs        # CIF 全量解析（晶胞参数 / 分数坐标 / 对称操作）
│   ├── supercell.rs    # 对称操作展开 + HashSet O(1) 去重 + 超晶胞扩展
│   └── miller.rs       # 密勒指数 → 倒格矢法向量 + 面间距 + 可视化顶点
├── kinetics.rs         # 高分子动力学求解器（矩方法 + RK4）
├── db.rs               # SQLite 数据库管理
├── db/                 # 数据库子模块
│   ├── schema.rs       # 表结构与迁移
│   ├── notes.rs        # 笔记读写
│   ├── embeddings.rs   # 向量索引与 Embedding 存储
│   ├── relations.rs    # 双链关系维护
│   ├── parsing.rs      # 标签/链接提取与解析
│   ├── graph.rs        # 图谱查询（wikilink + 标签共现 + 同文件夹三维关联）
│   ├── study.rs        # 学习模块入口（子模块: session / stats / truth）
│   ├── study/          # 学习模块子目录
│   │   ├── session.rs  # 会话 CRUD（start / tick / end）
│   │   ├── stats.rs    # 统计聚合查询（热力图/每日/排行）
│   │   └── truth.rs    # TruthState 经验等级推导
│   ├── lifecycle.rs    # 初始化/清理/维护流程
│   └── common.rs       # DB 公共工具
├── shared/             # 公共 helper 与跨模块共享逻辑
├── services/           # 领域服务层
├── symmetry/           # 对称性引擎模块（parse/geometry/search/classify/render）
├── watcher/            # 文件系统增量监听模块
│   ├── mod.rs          # WatcherState 生命周期管理（start/stop）
│   ├── filter.rs       # 路径过滤规则（隐藏文件/扩展名白名单/忽略文件夹）
│   └── handler.rs      # 事件回调（分类/去重/IPC 发送）
├── ai/                 # AI 模块（按职责拆分）
│   ├── mod.rs          # AiConfig 定义与统一 re-export
│   ├── embedding.rs    # Embedding 请求、LRU 缓存与并发控制
│   ├── chat.rs         # 流式 RAG 对话与 Ponder 节点生成
│   ├── similarity.rs   # 余弦相似度计算
│   └── vector_cache.rs # 向量内存缓存与 top-k BinaryHeap 查询
├── error.rs            # 类型化错误处理（AppError / AppResult）
├── models.rs           # 数据模型
└── lib.rs              # 应用入口
```

## 架构演进（近期）

- **全量性能优化（v1.0.6）**：15 项优化覆盖 P0-P3。保存队列 Map 化消除多文件丢数据；增量监听链路替代全库扫描；向量检索内存缓存 + top-k BinaryHeap；PDF 去 base64 + 预取限流；面板拖拽 CSS var 零渲染；图谱/文件树 FNV-1a 指纹修正；性能基线工具与 bundle 分析流程
- **晶格引擎与极致性能（v1.0.5）**：新增 Rust `crystal/` 模块（CIF 解析 + 对称操作展开 + 超晶胞生成 + 密勒面计算），前端 `CrystalViewer3D` 零计算渲染。全面异步化文件 I/O（9 个命令迁移至 `spawn_blocking`），图谱相似度从 O(n²) 优化至倒排索引，超晶胞去重从 O(n³) 优化至 O(n) HashSet，新增 embedding 列部分索引
- **计算层 Rust 迁移（v1.0.4）**：6 项前端重计算（语义提取、标签树、图谱索引、热力图、化学计量、数据库归一化）下沉到 Rust 后端，新增 7 个 Tauri 命令
- **架构级优化（v1.0.4）**：修复双重 scan_vault、事件驱动替代轮询、全局笔记缓存、乐观 UI、批量 SQL、复合索引、FTS 延迟填充
- **渲染层优化（v1.0.4）**：CSS hover 替代 DOM 操作、关键组件 memo、文件树 memoize
- **组件拆分与 Hook 提取（v1.0.4）**：6 个 300-510 行的”上帝组件”按单一职责拆分，新增 11 个文件（6 个 hooks + 5 个子组件），每个文件只做一件事
- **前端 App 容器瘦身**：`App.tsx` 已从”状态 + 业务 + 渲染”混合体拆分为编排层，核心逻辑下沉到 hooks 与 app-level 组件
- **前端职责拆分**：`components/app/` 继续细化为工作区壳层、运行时、编辑视口与 `ActiveNoteContent`，降低渲染分发复杂度
- **会话逻辑分层**：`useVaultSession` 现在负责编排，扫描、活动内容、二进制预览、保存队列分别下沉到独立 hooks
- **保存链路增强**：新增保存指纹去重、排队写盘与显式 flush，减少频繁写盘和切换文件时的状态风险
- **语义与 AI 性能优化**：语义共鸣改为上下文提取 + 缓存 + 自适应防抖，AI 侧边栏改为历史消息与流式消息分离渲染
- **测试基建补齐**：引入 `Vitest + jsdom`，为类型、设置和语义推荐逻辑提供基础单元测试
- **跨界面一致性**：主题变量体系覆盖浅色/深色，TRUTH_SYSTEM、设置页、侧边栏等模块统一适配
- **Rust 命令模块化**：`commands.rs` 从集中式文件拆分到 `commands/` 子模块，便于按领域维护与测试
- **AI 模块拆分**：`ai.rs` 按职责拆分为 `ai/` 子模块（embedding / chat / similarity），提升可维护性
- **共享与服务层**：`shared/` 与 `services/` 承担公共能力与领域逻辑，降低命令层重复代码
- **多语言系统**：`i18n/` 基于 React Context 的轻量翻译方案，`useT()` hook 驱动全组件树翻译切换，支持参数化插值
- **类型化错误处理**：Rust 侧引入 `thiserror` 定义 `AppError` 枚举，替换全部 `Result<T, String>`，错误类型可序列化传递给前端
- **React Compiler**：集成编译器自动优化，消除手动 `useMemo`/`useCallback` 的维护负担
- **全局错误边界**：`ErrorBoundary` 组件包裹所有 Suspense 区域，确保单一模块崩溃不影响全局
- **测试基建扩充**：测试用例从 13 增至 38，覆盖核心 hooks（持久化、防抖、文件操作）和 ErrorBoundary
- **化学绘图板**：移除 @xyflow/react 通用画布，引入 Ketcher 专业分子编辑器（.mol 格式），CSS 穿透实现绝对极简暗色主题，/chemdraw 斜杠命令支持 Markdown 内联分子插入

## License

[MIT](LICENSE)
