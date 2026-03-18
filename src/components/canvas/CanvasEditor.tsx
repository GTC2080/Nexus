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
  useEdgesState,
  useNodesState,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useDebounce } from "../../hooks/useDebounce";
import type { CanvasNodeData } from "../../types";
import MarkdownNode from "./MarkdownNode";
import MoleculeNode from "../nodes/MoleculeNode";
import {
  EMPTY_CANVAS,
  normalizeNodes,
  parseCanvasContent,
  type CanvasFlowNode,
} from "./canvasUtils";
import CanvasContextMenu, {
  clampCanvasMenuPosition,
  type CanvasContextMenuState,
} from "./CanvasContextMenu";
import { useCanvasPonder } from "../../hooks/useCanvasPonder";
import { useCanvasRetrosynthesis } from "../../hooks/useCanvasRetrosynthesis";
import type { DisciplineProfile } from "../settings/settingsTypes";

interface CanvasEditorProps {
  initialContent: string;
  onSave: (content: string) => void;
  activeDiscipline?: DisciplineProfile;
}

type CanvasMenuPayload =
  | { kind: "pane"; flowX: number; flowY: number }
  | { kind: "node"; nodeId: string };

export default function CanvasEditor({
  initialContent,
  onSave,
  activeDiscipline = "chemistry",
}: CanvasEditorProps) {
  const chemistryMode = activeDiscipline === "chemistry";
  const shellRef = useRef<HTMLDivElement | null>(null);
  const flowRef = useRef<ReactFlowInstance<CanvasFlowNode, Edge> | null>(null);
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

  const [nodes, setNodes, onNodesChange] = useNodesState<CanvasFlowNode>(
    normalizeNodes(initialData.nodes as Node<CanvasNodeData>[], chemistryMode)
  );
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(initialData.edges as Edge[]);
  const { onPonder, ponderingNodeId, clearPonderingNode } = useCanvasPonder({
    nodes,
    setNodes,
    setEdges,
    onToast: setToast,
  });
  const { onRetrosynthesize, retrosynthesizingNodeId, clearRetrosynthesisNode } = useCanvasRetrosynthesis({
    chemistryMode,
    nodes,
    setNodes,
    setEdges,
    onToast: setToast,
  });

  useEffect(() => {
    try {
      const next = parseCanvasContent(initialContent);
      setNodes(normalizeNodes(next.nodes as Node<CanvasNodeData>[], chemistryMode));
      setEdges(next.edges as Edge[]);
    } catch {
      setToast("画布 JSON 已损坏，已回退为空画布");
      setNodes([]);
      setEdges([]);
    }
  }, [chemistryMode, initialContent, setEdges, setNodes]);

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

  const debouncedSave = useDebounce((nextNodes: CanvasFlowNode[], nextEdges: Edge[]) => {
    const pureNodes = nextNodes.map(({ data, ...node }) => ({
      ...node,
      data: {
        title: data.title,
        content: data.content,
        ...(typeof data.smiles === "string" ? { smiles: data.smiles } : {}),
        ...(typeof data.retroId === "string" ? { retroId: data.retroId } : {}),
      },
    }));
    onSave(JSON.stringify({ nodes: pureNodes, edges: nextEdges }, null, 2));
  }, 900);

  useEffect(() => {
    debouncedSave(nodes, edges);
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
    const nextNode: CanvasFlowNode = {
      id: crypto.randomUUID(),
      type: "markdownNode",
      position: { x, y },
      data: {
        title,
        content: "",
        onChange: () => undefined,
        onPonder: () => undefined,
        onRetrosynthesize: () => undefined,
        isPondering: false,
        isRetrosynthesizing: false,
        chemistryMode,
      },
    };
    setNodes(prev => [...prev, nextNode]);
  }, [chemistryMode, setNodes]);

  const addMoleculeNodeAt = useCallback((x: number, y: number, smiles = "") => {
    const nextNode: CanvasFlowNode = {
      id: crypto.randomUUID(),
      type: "moleculeNode",
      position: { x, y },
      data: {
        title: "Target Molecule",
        content: "",
        smiles,
        onChange: () => undefined,
        onPonder: () => undefined,
        onRetrosynthesize: () => undefined,
        isPondering: false,
        isRetrosynthesizing: false,
        chemistryMode,
      },
    };
    setNodes(prev => [...prev, nextNode]);
  }, [chemistryMode, setNodes]);

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

  const addMoleculeNodeAtCenter = useCallback(() => {
    const instance = flowRef.current;
    const shell = shellRef.current;
    if (!instance || !shell) {
      addMoleculeNodeAt(-110, -70);
      return;
    }
    const rect = shell.getBoundingClientRect();
    const center = instance.screenToFlowPosition({
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
    });
    addMoleculeNodeAt(center.x - 160, center.y - 90);
  }, [addMoleculeNodeAt]);

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

  const handleNodeContextMenu = useCallback((event: globalThis.MouseEvent | ReactMouseEvent, node: CanvasFlowNode) => {
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
    if (selected.type !== "markdownNode") {
      setToast("AI Ponder 仅适用于文本节点");
      return;
    }
    void onPonder(selected.id, selected.data.title.trim(), selected.data.content.trim());
  }, [nodes, onPonder, selectedNodeId]);

  const retrosynthesizeNode = useCallback((nodeId: string, depth = 2) => {
    const selected = nodes.find(node => node.id === nodeId);
    if (!selected || selected.type !== "moleculeNode") {
      setToast("请先选择分子节点");
      return;
    }
    const smiles = typeof selected.data.smiles === "string" ? selected.data.smiles : "";
    void onRetrosynthesize(selected.id, smiles.trim(), depth);
  }, [nodes, onRetrosynthesize]);

  const deleteNodeAndConnections = useCallback((nodeId: string) => {
    setNodes(prev => prev.filter(node => node.id !== nodeId));
    setEdges(prev => prev.filter(edge => edge.source !== nodeId && edge.target !== nodeId));
    if (selectedNodeId === nodeId) {
      setSelectedNodeId(null);
    }
    if (ponderingNodeId === nodeId) {
      clearPonderingNode();
    }
    if (retrosynthesizingNodeId === nodeId) {
      clearRetrosynthesisNode();
    }
  }, [
    clearPonderingNode,
    clearRetrosynthesisNode,
    ponderingNodeId,
    retrosynthesizingNodeId,
    selectedNodeId,
    setEdges,
    setNodes,
  ]);

  const selectedNode = useMemo(
    () => (selectedNodeId ? nodes.find(node => node.id === selectedNodeId) ?? null : null),
    [nodes, selectedNodeId]
  );

  const mappedNodes = useMemo(
    () =>
      nodes.map(node => ({
        ...node,
        data: {
          ...node.data,
          onChange: updateNodeData,
          onPonder,
          onRetrosynthesize,
          isPondering: node.id === ponderingNodeId,
          isRetrosynthesizing: node.id === retrosynthesizingNodeId,
          chemistryMode,
        },
      })),
    [
      chemistryMode,
      nodes,
      onPonder,
      onRetrosynthesize,
      ponderingNodeId,
      retrosynthesizingNodeId,
      updateNodeData,
    ]
  );

  const nodeTypes = useMemo(
    () => ({
      markdownNode: MarkdownNode,
      moleculeNode: MoleculeNode,
    }),
    []
  );
  const handleViewportChange = useCallback((zoom: number) => {
    setZoomPercent(Math.round(zoom * 100));
  }, []);

  return (
    <div ref={shellRef} className="flex-1 relative canvas-shell">
      <ReactFlow<CanvasFlowNode, Edge>
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
        onMoveEnd={(_, viewport) => handleViewportChange(viewport.zoom)}
        onInit={instance => {
          flowRef.current = instance;
          handleViewportChange(instance.getViewport().zoom);
        }}
      >
        <Background variant={BackgroundVariant.Dots} color="#212121" gap={26} size={1.2} />
        <CanvasControls
          zoomPercent={zoomPercent}
          onAddNode={addNodeAtCenter}
          onAddMoleculeNode={addMoleculeNodeAtCenter}
          onPonderSelected={ponderSelectedNode}
          onRetroSelected={() => {
            if (!selectedNodeId) return;
            retrosynthesizeNode(selectedNodeId, 2);
          }}
          hasPonderSelection={selectedNode?.type === "markdownNode"}
          hasRetroSelection={selectedNode?.type === "moleculeNode"}
          pondering={Boolean(ponderingNodeId)}
          retrosynthesizing={Boolean(retrosynthesizingNodeId)}
          chemistryMode={chemistryMode}
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
        chemistryMode={chemistryMode}
        nodes={nodes}
        flowRef={flowRef}
        onAddNodeAt={addNodeAt}
        onAddMoleculeNodeAt={addMoleculeNodeAt}
        onAddNodeAtCenter={addNodeAtCenter}
        onPonderNode={(nodeId: string) => {
          const current = nodes.find(node => node.id === nodeId);
          if (!current) return;
          if (current.type === "markdownNode") {
            void onPonder(current.id, current.data.title.trim(), current.data.content.trim());
          }
        }}
        onRetrosynthesizeNode={retrosynthesizeNode}
        onDeleteNode={deleteNodeAndConnections}
        onClose={() => setContextMenu(null)}
      />
    </div>
  );
}

function CanvasControls({
  zoomPercent,
  onAddNode,
  onAddMoleculeNode,
  onPonderSelected,
  onRetroSelected,
  hasPonderSelection,
  hasRetroSelection,
  pondering,
  retrosynthesizing,
  chemistryMode,
}: {
  zoomPercent: number;
  onAddNode: () => void;
  onAddMoleculeNode: () => void;
  onPonderSelected: () => void;
  onRetroSelected: () => void;
  hasPonderSelection: boolean;
  hasRetroSelection: boolean;
  pondering: boolean;
  retrosynthesizing: boolean;
  chemistryMode: boolean;
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
      {chemistryMode && (
        <button type="button" onClick={onAddMoleculeNode} aria-label="新建分子节点" title="新建分子节点">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
            <circle cx="7" cy="12" r="2.3" />
            <circle cx="17" cy="7" r="2.3" />
            <circle cx="17" cy="17" r="2.3" />
            <line x1="9" y1="12" x2="14.5" y2="8" />
            <line x1="9" y1="12" x2="14.5" y2="16" />
          </svg>
        </button>
      )}
      <button
        type="button"
        onClick={onPonderSelected}
        aria-label="AI 扩展"
        title={hasPonderSelection ? "AI Ponder 扩展选中节点" : "请先选中文本节点"}
        disabled={!hasPonderSelection || pondering}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
          <path d="M12 3l1.8 4.2L18 9l-4.2 1.8L12 15l-1.8-4.2L6 9l4.2-1.8L12 3z" />
          <path d="M5 16l.8 1.9L8 19l-2.2.9L5 22l-.8-2.1L2 19l2.2-1.1L5 16z" />
          <path d="M19 14l.5 1.1L21 16l-1.5.6L19 18l-.5-1.4L17 16l1.5-.9L19 14z" />
        </svg>
      </button>
      {chemistryMode && (
        <button
          type="button"
          onClick={onRetroSelected}
          aria-label="逆合成扩展"
          title={hasRetroSelection ? "对选中分子执行逆合成" : "请先选中分子节点"}
          disabled={!hasRetroSelection || retrosynthesizing}
        >
          <span className="text-[11px] font-mono">↤R</span>
        </button>
      )}
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
