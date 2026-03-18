import { useCallback } from "react";
import { useReactFlow } from "@xyflow/react";

interface CanvasControlsProps {
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
}

export default function CanvasControls({
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
}: CanvasControlsProps) {
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
