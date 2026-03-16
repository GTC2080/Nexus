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
export type FileCategory = "markdown" | "image" | "code";

const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "svg", "webp", "bmp", "ico"]);
const MARKDOWN_EXTENSIONS = new Set(["md"]);

export function getFileCategory(ext: string): FileCategory {
  const lower = ext.toLowerCase();
  if (MARKDOWN_EXTENSIONS.has(lower)) return "markdown";
  if (IMAGE_EXTENSIONS.has(lower)) return "image";
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
