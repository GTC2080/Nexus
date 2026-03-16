import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  addEdge,
  useReactFlow,
  type Connection,
  type Edge,
  type Node,
  type Viewport,
  useEdgesState,
  useNodesState,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useDebounce } from "../hooks/useDebounce";
import type { CanvasData, CanvasNodeData } from "../types";
import MarkdownNode, { type MarkdownCanvasNodeData } from "./MarkdownNode";

interface CanvasEditorProps {
  initialContent: string;
  onSave: (content: string) => void;
}

interface PonderSuggestion {
  title: string;
  relation: string;
}

const EMPTY_CANVAS: CanvasData = { nodes: [], edges: [] };
const STAGGER_DELAY_MS = 120;
type MarkdownFlowNode = Node<MarkdownCanvasNodeData, "markdownNode">;

function parseCanvasContent(raw: string): CanvasData {
  if (!raw.trim()) return EMPTY_CANVAS;
  const parsed = JSON.parse(raw) as Partial<CanvasData>;
  const nodes = Array.isArray(parsed.nodes) ? parsed.nodes : [];
  const edges = Array.isArray(parsed.edges) ? parsed.edges : [];
  return { nodes, edges };
}

function sanitizePonderPayload(raw: string): PonderSuggestion[] {
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

function normalizeNodes(nodes: Node<CanvasNodeData>[]): MarkdownFlowNode[] {
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

export default function CanvasEditor({ initialContent, onSave }: CanvasEditorProps) {
  const timeoutIdsRef = useRef<number[]>([]);
  const [toast, setToast] = useState<string | null>(null);
  const [ponderingNodeId, setPonderingNodeId] = useState<string | null>(null);
  const [zoomPercent, setZoomPercent] = useState(100);

  const initialData = useMemo(() => {
    try {
      return parseCanvasContent(initialContent);
    } catch {
      return EMPTY_CANVAS;
    }
  }, [initialContent]);

  const [nodes, setNodes, onNodesChange] = useNodesState<MarkdownFlowNode>(
    normalizeNodes(initialData.nodes as Node<CanvasNodeData>[])
  );
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialData.edges as Edge[]);

  useEffect(() => {
    try {
      const next = parseCanvasContent(initialContent);
      setNodes(normalizeNodes(next.nodes as Node<CanvasNodeData>[]));
      setEdges(next.edges as Edge[]);
    } catch {
      setToast("画布 JSON 已损坏，已回退为空画布");
      setNodes([]);
      setEdges([]);
    }
  }, [initialContent, setEdges, setNodes]);

  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(null), 2600);
    return () => clearTimeout(id);
  }, [toast]);

  useEffect(() => {
    return () => {
      timeoutIdsRef.current.forEach(id => window.clearTimeout(id));
    };
  }, []);

  const debouncedSave = useDebounce((payload: string) => onSave(payload), 900);

  useEffect(() => {
    const pureNodes = nodes.map(({ data, ...node }) => ({
      ...node,
      data: {
        title: data.title,
        content: data.content,
      },
    }));
    const payload = JSON.stringify({ nodes: pureNodes, edges }, null, 2);
    debouncedSave(payload);
  }, [nodes, edges, debouncedSave]);

  const updateNodeData = useCallback((id: string, patch: Partial<CanvasNodeData>) => {
    setNodes(prev =>
      prev.map(node => (node.id === id ? { ...node, data: { ...node.data, ...patch } } : node))
    );
  }, [setNodes]);

  const onConnect = useCallback((params: Connection) => {
    setEdges(prev => addEdge({ ...params, animated: true }, prev));
  }, [setEdges]);

  const onPonder = useCallback(async (nodeId: string, topic: string, context: string) => {
    if (!topic) {
      setToast("请先填写节点标题再进行思索");
      return;
    }

    const parent = nodes.find(node => node.id === nodeId);
    if (!parent) return;

    setPonderingNodeId(nodeId);
    try {
      const raw = await invoke<string>("ponder_node", { topic, context });
      const suggestions = sanitizePonderPayload(raw);
      const parentWidth = parent.width ?? 220;
      const parentHeight = parent.height ?? 140;
      const parentCenterX = parent.position.x + parentWidth / 2;
      const parentCenterY = parent.position.y + parentHeight / 2;

      suggestions.forEach((item, index) => {
        const timeoutId = window.setTimeout(() => {
          const childId = crypto.randomUUID();
          const nextNode: MarkdownFlowNode = {
            id: childId,
            type: "markdownNode",
            position: {
              x: parentCenterX + 350,
              y: parentCenterY + (index - (suggestions.length - 1) / 2) * 160,
            },
            data: {
              title: item.title,
              content: "",
              onChange: () => undefined,
              onPonder: () => undefined,
              isPondering: false,
            },
          };
          const nextEdge: Edge = {
            id: crypto.randomUUID(),
            source: nodeId,
            target: childId,
            label: item.relation,
            animated: true,
          };
          setNodes(prev => [...prev, nextNode]);
          setEdges(prev => [...prev, nextEdge]);
        }, index * STAGGER_DELAY_MS);
        timeoutIdsRef.current.push(timeoutId);
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      setToast(`Ponder 失败: ${msg}`);
    } finally {
      setPonderingNodeId(null);
    }
  }, [nodes, setEdges, setNodes]);

  const mappedNodes = useMemo(
    () =>
      nodes.map(node => ({
        ...node,
        data: {
          ...node.data,
          onChange: updateNodeData,
          onPonder,
          isPondering: node.id === ponderingNodeId,
        },
      })),
    [nodes, onPonder, ponderingNodeId, updateNodeData]
  );

  const nodeTypes = useMemo(() => ({ markdownNode: MarkdownNode }), []);
  const handleViewportChange = useCallback((viewport: Viewport) => {
    setZoomPercent(Math.round(viewport.zoom * 100));
  }, []);

  return (
    <div className="flex-1 relative canvas-shell">
      <ReactFlow<MarkdownFlowNode, Edge>
        nodes={mappedNodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        nodeTypes={nodeTypes}
        fitView
        proOptions={{ hideAttribution: true }}
        onMove={(_, viewport) => handleViewportChange(viewport)}
      >
        <Background variant={BackgroundVariant.Dots} color="#212121" gap={26} size={1.2} />
        <CanvasControls zoomPercent={zoomPercent} />
      </ReactFlow>
      {toast && (
        <div className="absolute right-4 bottom-4 px-3 py-2 text-[12px] rounded-md border border-white/15 bg-black/75 text-white/85 backdrop-blur-md">
          {toast}
        </div>
      )}
    </div>
  );
}

function CanvasControls({ zoomPercent }: { zoomPercent: number }) {
  const { zoomIn, zoomOut, fitView, setViewport } = useReactFlow();

  const handleReset = useCallback(() => {
    setViewport({ x: 0, y: 0, zoom: 1 }, { duration: 220 });
  }, [setViewport]);

  const handleFit = useCallback(() => {
    fitView({ duration: 260, padding: 0.18 });
  }, [fitView]);

  return (
    <div className="canvas-minimal-controls">
      <button type="button" onClick={() => zoomIn({ duration: 180 })} aria-label="放大" title="放大">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
          <line x1="12" y1="8" x2="12" y2="16" />
          <line x1="8" y1="12" x2="16" y2="12" />
        </svg>
      </button>
      <button type="button" onClick={() => zoomOut({ duration: 180 })} aria-label="缩小" title="缩小">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
          <line x1="8" y1="12" x2="16" y2="12" />
        </svg>
      </button>
      <button type="button" onClick={handleReset} aria-label="重置缩放" title="重置缩放">
        <span>{zoomPercent}%</span>
      </button>
      <button type="button" onClick={handleFit} aria-label="适配视图" title="适配视图">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
          <polyline points="3 9 3 3 9 3" />
          <polyline points="15 3 21 3 21 9" />
          <polyline points="21 15 21 21 15 21" />
          <polyline points="9 21 3 21 3 15" />
        </svg>
      </button>
    </div>
  );
}
