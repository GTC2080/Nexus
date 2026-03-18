/** 笔记元数据，与后端 Rust NoteInfo 结构体一一对应 */
export interface NoteInfo {
  id: string;
  name: string;
  path: string;
  created_at: number;
  updated_at: number;
  file_extension: string;
}

/** 文件类型分类 */
export type FileCategory =
  | "markdown"
  | "image"
  | "pdf"
  | "canvas"
  | "timeline"
  | "paper"
  | "spectroscopy"
  | "molecular"
  | "code";

const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "svg", "webp", "bmp", "ico"]);
const PDF_EXTENSIONS = new Set(["pdf"]);
const MARKDOWN_EXTENSIONS = new Set(["md"]);
const CANVAS_EXTENSIONS = new Set(["canvas"]);
const TIMELINE_EXTENSIONS = new Set(["timeline"]);
const PAPER_EXTENSIONS = new Set(["paper"]);
const SPECTROSCOPY_EXTENSIONS = new Set(["csv", "jdx"]);
const MOLECULAR_EXTENSIONS = new Set(["pdb", "xyz", "cif"]);

export function getFileCategory(ext: string): FileCategory {
  const lower = ext.toLowerCase();
  if (MARKDOWN_EXTENSIONS.has(lower)) return "markdown";
  if (IMAGE_EXTENSIONS.has(lower)) return "image";
  if (PDF_EXTENSIONS.has(lower)) return "pdf";
  if (CANVAS_EXTENSIONS.has(lower)) return "canvas";
  if (TIMELINE_EXTENSIONS.has(lower)) return "timeline";
  if (PAPER_EXTENSIONS.has(lower)) return "paper";
  if (SPECTROSCOPY_EXTENSIONS.has(lower)) return "spectroscopy";
  if (MOLECULAR_EXTENSIONS.has(lower)) return "molecular";
  return "code";
}

/** 标签聚合信息 */
export interface TagInfo {
  name: string;
  count: number;
}

/** 图谱节点 */
export interface GraphNode {
  id: string;
  name: string;
  ghost: boolean;
}

/** 图谱连线 */
export interface GraphLink {
  source: string;
  target: string;
}

/** 全局关系图谱数据 */
export interface GraphData {
  nodes: GraphNode[];
  links: GraphLink[];
}

export interface CanvasNodeData {
  title: string;
  content: string;
  [key: string]: unknown;
}

export interface CanvasData {
  nodes: Array<{
    id: string;
    type?: string;
    position: { x: number; y: number };
    data: CanvasNodeData;
  }>;
  edges: Array<{
    id: string;
    source: string;
    target: string;
    label?: string;
    animated?: boolean;
  }>;
}

export interface TimelineEvent {
  id: string;
  // 学习日期，保持自由文本以兼容非标准时间表达
  date: string;
  // 学习主题，例如“有机化学-亲电取代”
  title: string;
  // 学习摘要/实验笔记
  description: string;
  // 学习时长（分钟）
  durationMinutes: number;
  // 本次学习覆盖的文件夹路径（相对知识库）
  folders: string[];
  // 历史兼容：可选关联单篇笔记
  linkedNoteId?: string;
}

export interface TimelineData {
  events: TimelineEvent[];
}

export interface FileTreeNode {
  name: string;
  fullName: string;
  relativePath: string;
  isFolder: boolean;
  note?: NoteInfo;
  children: FileTreeNode[];
  fileCount: number;
}

export interface SpectrumSeries {
  y: number[];
  label: string;
}

export interface SpectrumData {
  x: number[];
  series: SpectrumSeries[];
  x_label: string;
  title: string;
  is_nmr: boolean;
}

export interface MolecularPreviewMeta {
  atom_count: number;
  preview_atom_count: number;
  truncated: boolean;
}
