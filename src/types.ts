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
export type FileCategory = "markdown" | "image" | "pdf" | "canvas" | "timeline" | "spectroscopy" | "code";

const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "svg", "webp", "bmp", "ico"]);
const PDF_EXTENSIONS = new Set(["pdf"]);
const MARKDOWN_EXTENSIONS = new Set(["md"]);
const CANVAS_EXTENSIONS = new Set(["canvas"]);
const TIMELINE_EXTENSIONS = new Set(["timeline"]);
const SPECTROSCOPY_EXTENSIONS = new Set(["csv", "jdx"]);

export function getFileCategory(ext: string): FileCategory {
  const lower = ext.toLowerCase();
  if (MARKDOWN_EXTENSIONS.has(lower)) return "markdown";
  if (IMAGE_EXTENSIONS.has(lower)) return "image";
  if (PDF_EXTENSIONS.has(lower)) return "pdf";
  if (CANVAS_EXTENSIONS.has(lower)) return "canvas";
  if (TIMELINE_EXTENSIONS.has(lower)) return "timeline";
  if (SPECTROSCOPY_EXTENSIONS.has(lower)) return "spectroscopy";
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
  // 保持自由文本以支持虚构纪元/非公历时间格式
  date: string;
  title: string;
  description: string;
  linkedNoteId?: string;
}

export interface TimelineData {
  events: TimelineEvent[];
}
