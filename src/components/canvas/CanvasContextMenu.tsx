import type { RefObject } from "react";
import type { ReactFlowInstance, Edge } from "@xyflow/react";
import type { CanvasFlowNode } from "./canvasUtils";
import { useT } from "../../i18n";

const CANVAS_MENU_WIDTH = 188;
const CANVAS_MENU_MAX_HEIGHT = 220;

export type CanvasContextMenuState =
  | { kind: "pane"; x: number; y: number; flowX: number; flowY: number }
  | { kind: "node"; x: number; y: number; nodeId: string };

interface CanvasContextMenuProps {
  menuRef: RefObject<HTMLDivElement | null>;
  menu: CanvasContextMenuState | null;
  shellRect: DOMRect | null;
  chemistryMode: boolean;
  nodes: CanvasFlowNode[];
  flowRef: RefObject<ReactFlowInstance<CanvasFlowNode, Edge> | null>;
  onAddNodeAt: (x: number, y: number) => void;
  onAddMoleculeNodeAt: (x: number, y: number) => void;
  onAddNodeAtCenter: () => void;
  onPonderNode: (nodeId: string) => void;
  onRetrosynthesizeNode: (nodeId: string) => void;
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
  chemistryMode,
  nodes,
  flowRef,
  onAddNodeAt,
  onAddMoleculeNodeAt,
  onAddNodeAtCenter,
  onPonderNode,
  onRetrosynthesizeNode,
  onDeleteNode,
  onClose,
}: CanvasContextMenuProps) {
  const t = useT();
  if (!menu) return null;
  const contextNode = menu.kind === "node" ? nodes.find(node => node.id === menu.nodeId) : null;
  const isMoleculeNode = chemistryMode && contextNode?.type === "moleculeNode";

  return (
    <div
      ref={menuRef}
      className="absolute z-50 w-[188px] rounded-lg p-1 border border-[var(--glass-border)] bg-[var(--menu-bg)] backdrop-blur-md shadow-[0_14px_38px_rgba(0,0,0,0.25)]"
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
            {t("canvas.newNode")}
          </button>
          {chemistryMode && (
            <button
              type="button"
              className="canvas-menu-item"
              onClick={() => {
                onAddMoleculeNodeAt(menu.flowX - 170, menu.flowY - 90);
                onClose();
              }}
            >
              {t("canvas.newMoleculeNode")}
            </button>
          )}
          <button
            type="button"
            className="canvas-menu-item"
            onClick={() => {
              onAddNodeAtCenter();
              onClose();
            }}
          >
            {t("canvas.newNodeCenter")}
          </button>
          <div className="my-1 h-px bg-[var(--separator-light)]" />
          <button
            type="button"
            className="canvas-menu-item"
            onClick={() => {
              flowRef.current?.fitView({ duration: 260, padding: 0.18 });
              onClose();
            }}
          >
            {t("canvas.fitView")}
          </button>
          <button
            type="button"
            className="canvas-menu-item"
            onClick={() => {
              flowRef.current?.setViewport({ x: 0, y: 0, zoom: 1 }, { duration: 220 });
              onClose();
            }}
          >
            {t("canvas.resetView")}
          </button>
        </>
      ) : (
        <>
          {isMoleculeNode && (
            <button
              type="button"
              className="canvas-menu-item"
              onClick={() => {
                onRetrosynthesizeNode(menu.nodeId);
                onClose();
              }}
            >
              {t("canvas.retrosynth")}
            </button>
          )}
          {contextNode?.type === "markdownNode" && (
            <button
              type="button"
              className="canvas-menu-item"
              onClick={() => {
                onPonderNode(menu.nodeId);
                onClose();
              }}
            >
              {t("canvas.aiPonder")}
            </button>
          )}
          <button
            type="button"
            className="canvas-menu-item text-red-500 hover:text-red-600"
            onClick={() => {
              onDeleteNode(menu.nodeId);
              onClose();
            }}
          >
            {t("canvas.deleteNode")}
          </button>
        </>
      )}
    </div>
  );
}
