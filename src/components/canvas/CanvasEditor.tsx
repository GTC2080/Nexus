import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  addEdge,
  useReactFlow,
  type Connection,
  type Edge,
  type Node,
  type ReactFlowInstance,
  type Viewport,
  useEdgesState,
  useNodesState,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useDebounce } from "../../hooks/useDebounce";
import type { CanvasNodeData } from "../../types";
import MarkdownNode from "./MarkdownNode";
import {
  EMPTY_CANVAS,
  normalizeNodes,
  parseCanvasContent,
  type MarkdownFlowNode,
} from "./canvasUtils";
import CanvasContextMenu, {
  clampCanvasMenuPosition,
  type CanvasContextMenuState,
} from "./CanvasContextMenu";
import { useCanvasPonder } from "../../hooks/useCanvasPonder";

interface CanvasEditorProps {
  initialContent: string;
  onSave: (content: string) => void;
}

type CanvasMenuPayload =
  | { kind: "pane"; flowX: number; flowY: number }
  | { kind: "node"; nodeId: string };

export default function CanvasEditor({ initialContent, onSave }: CanvasEditorProps) {
  const shellRef = useRef<HTMLDivElement | null>(null);
  const flowRef = useRef<ReactFlowInstance<MarkdownFlowNode, Edge> | null>(null);
  const contextMenuRef = useRef<HTMLDivElement | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<CanvasContextMenuState | null>(null);
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
  const { onPonder, ponderingNodeId, clearPonderingNode } = useCanvasPonder({
    nodes,
    setNodes,
    setEdges,
    onToast: setToast,
  });

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
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    const handlePointerDownCapture = (e: Event) => {
      const menuEl = contextMenuRef.current;
      if (!menuEl) {
        close();
        return;
      }
      if (!menuEl.contains(e.target as globalThis.Node)) {
        close();
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("pointerdown", handlePointerDownCapture, true);
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDownCapture, true);
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("resize", close);
    };
  }, [contextMenu]);

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

  const addNodeAt = useCallback((x: number, y: number, title = "New Node") => {
    const nextNode: MarkdownFlowNode = {
      id: crypto.randomUUID(),
      type: "markdownNode",
      position: { x, y },
      data: {
        title,
        content: "",
        onChange: () => undefined,
        onPonder: () => undefined,
        isPondering: false,
      },
    };
    setNodes(prev => [...prev, nextNode]);
  }, [setNodes]);

  const addNodeAtCenter = useCallback(() => {
    const instance = flowRef.current;
    const shell = shellRef.current;
    if (!instance || !shell) {
      addNodeAt(0, 0);
      return;
    }
    const rect = shell.getBoundingClientRect();
    const center = instance.screenToFlowPosition({
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
    });
    addNodeAt(center.x - 110, center.y - 70);
  }, [addNodeAt]);

  const handlePaneClick = useCallback((event: ReactMouseEvent) => {
    setContextMenu(null);
    if (event.detail === 1) {
      setSelectedNodeId(null);
      return;
    }
    if (event.detail < 2) return;
    const instance = flowRef.current;
    if (!instance) return;
    const point = instance.screenToFlowPosition({ x: event.clientX, y: event.clientY });
    addNodeAt(point.x - 110, point.y - 70);
  }, [addNodeAt]);

  const openContextMenu = useCallback((clientX: number, clientY: number, payload: CanvasMenuPayload) => {
    const shell = shellRef.current;
    if (!shell) return;
    const rect = shell.getBoundingClientRect();
    const { x, y } = clampCanvasMenuPosition(clientX, clientY, rect);
    if (payload.kind === "pane") {
      setContextMenu({ kind: "pane", x, y, flowX: payload.flowX, flowY: payload.flowY });
    } else {
      setContextMenu({ kind: "node", x, y, nodeId: payload.nodeId });
    }
  }, []);

  const handlePaneContextMenu = useCallback((event: globalThis.MouseEvent | ReactMouseEvent) => {
    event.preventDefault();
    const instance = flowRef.current;
    if (!instance) return;
    const flowPoint = instance.screenToFlowPosition({ x: event.clientX, y: event.clientY });
    setSelectedNodeId(null);
    openContextMenu(event.clientX, event.clientY, {
      kind: "pane",
      flowX: flowPoint.x,
      flowY: flowPoint.y,
    });
  }, [openContextMenu]);

  const handleNodeContextMenu = useCallback((event: globalThis.MouseEvent | ReactMouseEvent, node: MarkdownFlowNode) => {
    event.preventDefault();
    setSelectedNodeId(node.id);
    openContextMenu(event.clientX, event.clientY, {
      kind: "node",
      nodeId: node.id,
    });
  }, [openContextMenu]);

  const ponderSelectedNode = useCallback(() => {
    if (!selectedNodeId) {
      setToast("请先选择一个节点再执行 AI Ponder");
      return;
    }
    const selected = nodes.find(node => node.id === selectedNodeId);
    if (!selected) {
      setToast("未找到选中的节点");
      return;
    }
    void onPonder(selected.id, selected.data.title.trim(), selected.data.content.trim());
  }, [nodes, onPonder, selectedNodeId]);

  const deleteNodeAndConnections = useCallback((nodeId: string) => {
    setNodes(prev => prev.filter(node => node.id !== nodeId));
    setEdges(prev => prev.filter(edge => edge.source !== nodeId && edge.target !== nodeId));
    if (selectedNodeId === nodeId) {
      setSelectedNodeId(null);
    }
    if (ponderingNodeId === nodeId) {
      clearPonderingNode();
    }
  }, [clearPonderingNode, ponderingNodeId, selectedNodeId, setEdges, setNodes]);

  const mappedNodes = useMemo(
    () =>
      nodes.map(node => ({
        ...node,
        data: {
          ...node.data,
          onChange: updateNodeData,
          onPonder,
          isPondering: node.id === ponderingNodeId,
          isSelected: node.id === selectedNodeId,
        },
      })),
    [nodes, onPonder, ponderingNodeId, selectedNodeId, updateNodeData]
  );

  const nodeTypes = useMemo(() => ({ markdownNode: MarkdownNode }), []);
  const handleViewportChange = useCallback((viewport: Viewport) => {
    setZoomPercent(Math.round(viewport.zoom * 100));
  }, []);

  return (
    <div ref={shellRef} className="flex-1 relative canvas-shell">
      <ReactFlow<MarkdownFlowNode, Edge>
        nodes={mappedNodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onPaneClick={handlePaneClick}
        onPaneContextMenu={handlePaneContextMenu}
        onNodeClick={(_, node) => setSelectedNodeId(node.id)}
        onNodeContextMenu={handleNodeContextMenu}
        nodeTypes={nodeTypes}
        fitView
        proOptions={{ hideAttribution: true }}
        onMove={(_, viewport) => handleViewportChange(viewport)}
        onInit={instance => {
          flowRef.current = instance;
          setZoomPercent(Math.round(instance.getViewport().zoom * 100));
        }}
      >
        <Background variant={BackgroundVariant.Dots} color="#212121" gap={26} size={1.2} />
        <CanvasControls
          zoomPercent={zoomPercent}
          onAddNode={addNodeAtCenter}
          onPonderSelected={ponderSelectedNode}
          hasSelection={Boolean(selectedNodeId)}
          pondering={Boolean(ponderingNodeId)}
        />
      </ReactFlow>
      {nodes.length === 0 && (
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none">
          <div className="px-4 py-3 rounded-lg border border-white/10 bg-black/55 text-white/75 text-[12px] backdrop-blur-md text-center">
            <p>双击空白区域创建节点</p>
            <p className="mt-1 text-white/45">选中节点后点击 AI Ponder 进行拓扑扩展</p>
            <button
              type="button"
              className="mt-2 pointer-events-auto px-3 py-1 rounded-md border border-white/15 hover:bg-white/10 transition-colors"
              onClick={addNodeAtCenter}
            >
              创建第一个节点
            </button>
          </div>
        </div>
      )}
      {toast && (
        <div className="absolute right-4 bottom-4 px-3 py-2 text-[12px] rounded-md border border-white/15 bg-black/75 text-white/85 backdrop-blur-md">
          {toast}
        </div>
      )}
      <CanvasContextMenu
        menuRef={contextMenuRef}
        menu={contextMenu}
        shellRect={shellRef.current?.getBoundingClientRect() ?? null}
        nodes={nodes}
        flowRef={flowRef}
        onAddNodeAt={addNodeAt}
        onAddNodeAtCenter={addNodeAtCenter}
        onPonderNode={(nodeId: string) => {
          const current = nodes.find(node => node.id === nodeId);
          if (!current) return;
          void onPonder(current.id, current.data.title.trim(), current.data.content.trim());
        }}
        onDeleteNode={deleteNodeAndConnections}
        onClose={() => setContextMenu(null)}
      />
    </div>
  );
}

function CanvasControls({
  zoomPercent,
  onAddNode,
  onPonderSelected,
  hasSelection,
  pondering,
}: {
  zoomPercent: number;
  onAddNode: () => void;
  onPonderSelected: () => void;
  hasSelection: boolean;
  pondering: boolean;
}) {
  const { zoomIn, zoomOut, fitView, setViewport } = useReactFlow();

  const handleReset = useCallback(() => {
    setViewport({ x: 0, y: 0, zoom: 1 }, { duration: 220 });
  }, [setViewport]);

  const handleFit = useCallback(() => {
    fitView({ duration: 260, padding: 0.18 });
  }, [fitView]);

  return (
    <div className="canvas-minimal-controls">
      <button type="button" onClick={onAddNode} aria-label="新建节点" title="新建节点">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
          <rect x="5" y="5" width="14" height="14" rx="2" />
          <line x1="12" y1="8" x2="12" y2="16" />
          <line x1="8" y1="12" x2="16" y2="12" />
        </svg>
      </button>
      <button
        type="button"
        onClick={onPonderSelected}
        aria-label="AI 扩展"
        title={hasSelection ? "AI Ponder 扩展选中节点" : "请先选中一个节点"}
        disabled={!hasSelection || pondering}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
          <path d="M12 3l1.8 4.2L18 9l-4.2 1.8L12 15l-1.8-4.2L6 9l4.2-1.8L12 3z" />
          <path d="M5 16l.8 1.9L8 19l-2.2.9L5 22l-.8-2.1L2 19l2.2-1.1L5 16z" />
          <path d="M19 14l.5 1.1L21 16l-1.5.6L19 18l-.5-1.4L17 16l1.5-.9L19 14z" />
        </svg>
      </button>
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
