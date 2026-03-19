import { lazy, Suspense, useState, useEffect, useRef, useCallback, useMemo, useTransition } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { GraphData, GraphNode, NoteInfo } from "../../types";
import { useT } from "../../i18n";
import "./global-graph-modal.css";
const GlobalGraphCanvas = lazy(() => import("./GlobalGraphCanvas"));

interface GlobalGraphModalProps {
  open: boolean;
  onClose: () => void;
  /** 双击真实节点后跳转到该笔记 */
  onNavigate: (note: NoteInfo) => void;
  /** 当前所有笔记列表，用于双击时查找完整 NoteInfo */
  notes: NoteInfo[];
}

/** 运行时节点类型（force-graph 会注入 x/y 坐标） */
interface RuntimeNode extends GraphNode {
  x?: number;
  y?: number;
}

export default function GlobalGraphModal({ open, onClose, onNavigate, notes }: GlobalGraphModalProps) {
  const t = useT();
  const [graphData, setGraphData] = useState<GraphData | null>(null);
  const [loading, startLoadTransition] = useTransition();
  const [hoveredNode, setHoveredNode] = useState<RuntimeNode | null>(null);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
  const containerRef = useRef<HTMLDivElement>(null);

  // 加载图谱数据
  useEffect(() => {
    if (!open) return;
    startLoadTransition(async () => {
      try {
        const data = await invoke<GraphData>("get_graph_data");
        setGraphData(data);
      } catch (e) {
        console.error(t("common.graphLoadFailed"), e);
      }
    });
  }, [open]);

  // ResizeObserver 自适应尺寸
  useEffect(() => {
    if (!open || !containerRef.current) return;
    const el = containerRef.current;
    const ro = new ResizeObserver(entries => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        setDimensions({ width, height });
      }
    });
    ro.observe(el);
    // 初始尺寸
    setDimensions({ width: el.clientWidth, height: el.clientHeight });
    return () => ro.disconnect();
  }, [open]);

  // 构建邻居索引：nodeId → Set<neighborId>
  const neighborMap = useMemo(() => {
    if (!graphData) return new Map<string, Set<string>>();
    const map = new Map<string, Set<string>>();
    for (const link of graphData.links) {
      if (!map.has(link.source)) map.set(link.source, new Set());
      if (!map.has(link.target)) map.set(link.target, new Set());
      map.get(link.source)!.add(link.target);
      map.get(link.target)!.add(link.source);
    }
    return map;
  }, [graphData]);

  // 构建连线索引：用于高亮判断
  const linkSet = useMemo(() => {
    if (!graphData) return new Set<string>();
    const s = new Set<string>();
    for (const link of graphData.links) {
      s.add(`${link.source}->${link.target}`);
      s.add(`${link.target}->${link.source}`);
    }
    return s;
  }, [graphData]);

  // 双击节点 → 导航
  const handleNodeClick = useCallback((node: RuntimeNode) => {
    if (node.ghost) return;
    const noteInfo = notes.find(n => n.id === node.id);
    if (noteInfo) {
      onNavigate(noteInfo);
      onClose();
    }
  }, [notes, onNavigate, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={onClose}>
      {/* Backdrop */}
      <div className="absolute inset-0 global-graph-backdrop" />

      {/* Modal container */}
      <div
        className="animate-fade-in relative w-[calc(100%-48px)] h-[calc(100%-48px)] max-w-[1400px] rounded-2xl overflow-hidden global-graph-modal"
        onClick={e => e.stopPropagation()}
      >

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 global-graph-header">
          <div className="flex items-center gap-2.5">
            <svg className="w-4 h-4 global-graph-accent-icon"
              viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="5" r="2" /><circle cx="5" cy="19" r="2" /><circle cx="19" cy="19" r="2" />
              <line x1="12" y1="7" x2="5" y2="17" /><line x1="12" y1="7" x2="19" y2="17" />
            </svg>
            <span className="text-[13px] font-medium global-graph-title">
              {t("graph.title")}
            </span>
            {graphData && (
              <span className="text-[11px] ml-2 global-graph-muted">
                {t("graph.stats", { nodes: graphData.nodes.length, links: graphData.links.length })}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-3 mr-4 text-[11px] global-graph-muted">
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full global-graph-legend-dot-note" />
                {t("graph.note")}
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full global-graph-legend-dot-ghost" />
                {t("graph.ghost")}
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-4 h-[1.5px] rounded-full" style={{ background: "rgba(10, 132, 255, 0.6)" }} />
                {t("graph.link")}
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-4 h-[1.5px] rounded-full" style={{ background: "rgba(48, 209, 88, 0.6)" }} />
                {t("graph.tag")}
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-4 h-[1.5px] rounded-full" style={{ background: "rgba(175, 130, 255, 0.6)" }} />
                {t("graph.similar")}
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-4 h-[1.5px] rounded-full" style={{ background: "rgba(255, 255, 255, 0.25)" }} />
                {t("graph.folder")}
              </span>
            </div>
            <button
              type="button"
              onClick={onClose}
              title={t("graph.close")}
              aria-label={t("graph.close")}
              className="w-7 h-7 rounded-lg flex items-center justify-center transition-colors cursor-pointer global-graph-close">
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5">
                <line x1="1" y1="1" x2="9" y2="9" /><line x1="9" y1="1" x2="1" y2="9" />
              </svg>
            </button>
          </div>
        </div>

        {/* Graph canvas area */}
        <div ref={containerRef} className="w-full global-graph-canvas">
          {loading && (
            <div className="flex items-center justify-center h-full gap-3">
              <div className="w-5 h-5 rounded-full border-2 animate-spin global-graph-loading-spinner" />
              <span className="text-[13px] global-graph-tertiary">{t("graph.loading")}</span>
            </div>
          )}

          {!loading && graphData && graphData.nodes.length === 0 && (
            <div className="flex items-center justify-center h-full">
              <p className="text-[13px] global-graph-muted">{t("graph.empty")}</p>
            </div>
          )}

          {!loading && graphData && graphData.nodes.length > 0 && dimensions.width > 0 && (
            <Suspense fallback={<div className="h-full w-full bg-[rgba(255,255,255,0.01)]" />}>
              <GlobalGraphCanvas
                graphData={graphData}
                width={dimensions.width}
                height={dimensions.height}
                hoveredNode={hoveredNode}
                neighborMap={neighborMap}
                linkSet={linkSet}
                onNodeClick={handleNodeClick}
                onNodeHover={setHoveredNode}
              />
            </Suspense>
          )}
        </div>

        {/* Bottom hint */}
        <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex items-center gap-4 text-[11px] px-3 py-1.5 rounded-lg global-graph-bottom-hint">
          <span>{t("graph.scrollZoom")}</span>
          <span>{t("graph.dragPan")}</span>
          <span>{t("graph.clickNode")}</span>
        </div>
      </div>
    </div>
  );
}
