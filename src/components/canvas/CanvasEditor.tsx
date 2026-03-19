import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  addEdge,
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
import CanvasControls from "./CanvasControls";
import {
  createMarkdownCanvasNode,
  createMoleculeCanvasNode,
  serializeCanvas,
} from "./canvasNodeFactory";
import { useCanvasPonder } from "../../hooks/useCanvasPonder";
import { useCanvasRetrosynthesis } from "../../hooks/useCanvasRetrosynthesis";
import type { DisciplineProfile } from "../settings/settingsTypes";
import { useT } from "../../i18n";

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
  const t = useT();
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
      setToast(t("canvas.corruptJson"));
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
    onSave(serializeCanvas(nextNodes, nextEdges));
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
    const nextNode = createMarkdownCanvasNode({ x, y, chemistryMode, title });
    setNodes(prev => [...prev, nextNode]);
  }, [chemistryMode, setNodes]);

  const addMoleculeNodeAt = useCallback((x: number, y: number, smiles = "") => {
    const nextNode = createMoleculeCanvasNode({ x, y, chemistryMode, smiles });
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
      setToast(t("canvas.selectNodeFirst"));
      return;
    }
    const selected = nodes.find(node => node.id === selectedNodeId);
    if (!selected) {
      setToast(t("canvas.nodeNotFound"));
      return;
    }
    if (selected.type !== "markdownNode") {
      setToast(t("canvas.ponderTextOnly"));
      return;
    }
    void onPonder(selected.id, selected.data.title.trim(), selected.data.content.trim());
  }, [nodes, onPonder, selectedNodeId]);

  const retrosynthesizeNode = useCallback((nodeId: string, depth = 2) => {
    const selected = nodes.find(node => node.id === nodeId);
    if (!selected || selected.type !== "moleculeNode") {
      setToast(t("canvas.selectMoleculeNode"));
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
        <Background variant={BackgroundVariant.Dots} color="var(--text-quinary)" gap={26} size={1.2} />
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
          <div className="px-4 py-3 rounded-lg border border-[var(--glass-border)] bg-[var(--glass-bg)] text-[var(--text-secondary)] text-[12px] backdrop-blur-md text-center">
            <p>{t("canvas.dblClickToCreate")}</p>
            <p className="mt-1 text-[var(--text-quaternary)]">{t("canvas.ponderHint")}</p>
            <button
              type="button"
              className="mt-2 pointer-events-auto px-3 py-1 rounded-md border border-[var(--glass-border)] hover:bg-[var(--sidebar-hover)] transition-colors"
              onClick={addNodeAtCenter}
            >
              {t("canvas.createFirst")}
            </button>
          </div>
        </div>
      )}
      {toast && (
        <div className="absolute right-4 bottom-4 px-3 py-2 text-[12px] rounded-md border border-[var(--glass-border)] bg-[var(--glass-bg-elevated)] text-[var(--text-secondary)] backdrop-blur-md">
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
