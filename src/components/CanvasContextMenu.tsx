import type { RefObject } from "react";
import type { ReactFlowInstance, Edge } from "@xyflow/react";
import type { MarkdownFlowNode } from "./canvasUtils";

const CANVAS_MENU_WIDTH = 188;
const CANVAS_MENU_MAX_HEIGHT = 220;

export type CanvasContextMenuState =
  | { kind: "pane"; x: number; y: number; flowX: number; flowY: number }
  | { kind: "node"; x: number; y: number; nodeId: string };

interface CanvasContextMenuProps {
  menuRef: RefObject<HTMLDivElement | null>;
  menu: CanvasContextMenuState | null;
  shellRect: DOMRect | null;
  nodes: MarkdownFlowNode[];
  flowRef: RefObject<ReactFlowInstance<MarkdownFlowNode, Edge> | null>;
  onAddNodeAt: (x: number, y: number) => void;
  onAddNodeAtCenter: () => void;
  onPonderNode: (nodeId: string) => void;
  onDeleteNode: (nodeId: string) => void;
  onClose: () => void;
}

export function clampCanvasMenuPosition(clientX: number, clientY: number, rect: DOMRect) {
  const localX = clientX - rect.left;
  const localY = clientY - rect.top;
  return {
    x: Math.max(8, Math.min(localX, rect.width - CANVAS_MENU_WIDTH - 8)),
    y: Math.max(8, Math.min(localY, rect.height - CANVAS_MENU_MAX_HEIGHT - 8)),
  };
}

export default function CanvasContextMenu({
  menuRef,
  menu,
  nodes,
  flowRef,
  onAddNodeAt,
  onAddNodeAtCenter,
  onPonderNode,
  onDeleteNode,
  onClose,
}: CanvasContextMenuProps) {
  if (!menu) return null;

  return (
    <div
      ref={menuRef}
      className="absolute z-50 w-[188px] rounded-lg p-1 border border-white/10 bg-black/90 backdrop-blur-md shadow-[0_14px_38px_rgba(0,0,0,0.45)]"
      style={{ left: `${menu.x}px`, top: `${menu.y}px` }}
    >
      {menu.kind === "pane" ? (
        <>
          <button
            type="button"
            className="canvas-menu-item"
            onClick={() => {
              onAddNodeAt(menu.flowX - 110, menu.flowY - 70);
              onClose();
            }}
          >
            在此新建节点
          </button>
          <button
            type="button"
            className="canvas-menu-item"
            onClick={() => {
              onAddNodeAtCenter();
              onClose();
            }}
          >
            在中心新建节点
          </button>
          <div className="my-1 h-px bg-white/10" />
          <button
            type="button"
            className="canvas-menu-item"
            onClick={() => {
              flowRef.current?.fitView({ duration: 260, padding: 0.18 });
              onClose();
            }}
          >
            适配画布
          </button>
          <button
            type="button"
            className="canvas-menu-item"
            onClick={() => {
              flowRef.current?.setViewport({ x: 0, y: 0, zoom: 1 }, { duration: 220 });
              onClose();
            }}
          >
            重置视图
          </button>
        </>
      ) : (
        <>
          <button
            type="button"
            className="canvas-menu-item"
            onClick={() => {
              if (nodes.some(node => node.id === menu.nodeId)) {
                onPonderNode(menu.nodeId);
              }
              onClose();
            }}
          >
            AI 思索扩展
          </button>
          <button
            type="button"
            className="canvas-menu-item text-red-300 hover:text-red-200"
            onClick={() => {
              onDeleteNode(menu.nodeId);
              onClose();
            }}
          >
            删除节点
          </button>
        </>
      )}
    </div>
  );
}
