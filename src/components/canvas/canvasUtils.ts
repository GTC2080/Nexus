import type { Node } from "@xyflow/react";
import type { CanvasData, CanvasNodeData } from "../../types";
import type { MarkdownCanvasNodeData } from "./MarkdownNode";

export interface PonderSuggestion {
  title: string;
  relation: string;
}

export const EMPTY_CANVAS: CanvasData = { nodes: [], edges: [] };

export type MarkdownFlowNode = Node<MarkdownCanvasNodeData, "markdownNode">;

export function parseCanvasContent(raw: string): CanvasData {
  if (!raw.trim()) return EMPTY_CANVAS;
  const parsed = JSON.parse(raw) as Partial<CanvasData>;
  const nodes = Array.isArray(parsed.nodes) ? parsed.nodes : [];
  const edges = Array.isArray(parsed.edges) ? parsed.edges : [];
  return { nodes, edges };
}

export function sanitizePonderPayload(raw: string): PonderSuggestion[] {
  const trimmed = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/```$/, "").trim();
  const parsed = JSON.parse(trimmed);
  if (!Array.isArray(parsed)) {
    throw new Error("AI 返回格式不是数组");
  }

  const valid = parsed
    .filter((item: unknown): item is PonderSuggestion => {
      if (!item || typeof item !== "object") return false;
      const record = item as Record<string, unknown>;
      return typeof record.title === "string" && typeof record.relation === "string";
    })
    .map(item => ({ title: item.title.trim(), relation: item.relation.trim() }))
    .filter(item => item.title.length > 0 && item.relation.length > 0);

  if (valid.length < 1) {
    throw new Error("AI 返回结构无有效节点");
  }
  return valid.slice(0, 5);
}

export function normalizeNodes(nodes: Node<CanvasNodeData>[]): MarkdownFlowNode[] {
  return nodes.map(node => ({
    ...node,
    type: "markdownNode",
    data: {
      title: node.data?.title ?? "",
      content: node.data?.content ?? "",
      onChange: () => undefined,
      onPonder: () => undefined,
      isPondering: false,
    },
  }));
}
