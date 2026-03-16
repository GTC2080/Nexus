import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import ForceGraph2D from "react-force-graph-2d";
import type { GraphData, GraphNode, NoteInfo } from "../../types";
import "./global-graph-modal.css";

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
  const [graphData, setGraphData] = useState<GraphData | null>(null);
  const [loading, setLoading] = useState(false);
  const [hoveredNode, setHoveredNode] = useState<RuntimeNode | null>(null);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
  const containerRef = useRef<HTMLDivElement>(null);
  const fgRef = useRef<any>(null);

  // 加载图谱数据
  useEffect(() => {
    if (!open) return;
    setLoading(true);
    invoke<GraphData>("get_graph_data")
      .then(data => setGraphData(data))
      .catch(e => console.error("加载图谱失败:", e))
      .finally(() => setLoading(false));
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

  // 判断节点是否应该高亮
  const isHighlighted = useCallback((nodeId: string) => {
    if (!hoveredNode) return true; // 无 hover 时全部正常显示
    if (hoveredNode.id === nodeId) return true;
    return neighborMap.get(hoveredNode.id)?.has(nodeId) ?? false;
  }, [hoveredNode, neighborMap]);

  // 判断连线是否应该高亮
  const isLinkHighlighted = useCallback((source: string, target: string) => {
    if (!hoveredNode) return true;
    return (hoveredNode.id === source || hoveredNode.id === target) &&
      linkSet.has(`${source}->${target}`);
  }, [hoveredNode, linkSet]);

  // 双击节点 → 导航
  const handleNodeClick = useCallback((node: RuntimeNode) => {
    if (node.ghost) return;
    const noteInfo = notes.find(n => n.id === node.id);
    if (noteInfo) {
      onNavigate(noteInfo);
      onClose();
    }
  }, [notes, onNavigate, onClose]);

  // 自定义节点渲染
  const paintNode = useCallback((node: RuntimeNode, ctx: CanvasRenderingContext2D, globalScale: number) => {
    const x = node.x ?? 0;
    const y = node.y ?? 0;
    const highlighted = isHighlighted(node.id);
    const opacity = highlighted ? 1 : 0.12;
    const connections = neighborMap.get(node.id)?.size ?? 0;

    // 节点大小：基于连接数，最小 3，最大 8
    const baseSize = Math.min(3 + connections * 0.6, 8);
    const size = hoveredNode?.id === node.id ? baseSize * 1.4 : baseSize;

    // 颜色
    let color: string;
    if (node.ghost) {
      color = `rgba(142, 142, 147, ${opacity * 0.5})`; // Apple gray
    } else if (hoveredNode?.id === node.id) {
      color = `rgba(10, 132, 255, ${opacity})`; // Apple blue - hovered
    } else {
      color = `rgba(10, 132, 255, ${opacity * 0.7})`; // Apple blue - normal
    }

    // 光晕（仅 hover 节点）
    if (hoveredNode?.id === node.id) {
      ctx.beginPath();
      ctx.arc(x, y, size + 4, 0, 2 * Math.PI);
      ctx.fillStyle = "rgba(10, 132, 255, 0.08)";
      ctx.fill();
    }

    // 节点圆
    ctx.beginPath();
    ctx.arc(x, y, size, 0, 2 * Math.PI);
    ctx.fillStyle = color;
    ctx.fill();

    // 标签（缩放足够大或 hover 时显示）
    const showLabel = globalScale > 1.5 || hoveredNode?.id === node.id ||
      (highlighted && hoveredNode !== null);
    if (showLabel) {
      const fontSize = Math.max(10 / globalScale, 2);
      ctx.font = `${fontSize}px -apple-system, BlinkMacSystemFont, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.fillStyle = highlighted
        ? `rgba(255, 255, 255, ${node.ghost ? 0.4 : 0.8})`
        : `rgba(255, 255, 255, 0.1)`;
      ctx.fillText(node.name, x, y + size + 2);
    }
  }, [hoveredNode, isHighlighted, neighborMap]);

  // 节点指针区域
  const paintPointerArea = useCallback((node: RuntimeNode, color: string, ctx: CanvasRenderingContext2D) => {
    const x = node.x ?? 0;
    const y = node.y ?? 0;
    const connections = neighborMap.get(node.id)?.size ?? 0;
    const size = Math.min(3 + connections * 0.6, 8) + 4; // 比视觉大一点，方便点击
    ctx.beginPath();
    ctx.arc(x, y, size, 0, 2 * Math.PI);
    ctx.fillStyle = color;
    ctx.fill();
  }, [neighborMap]);

  // 引擎停止后微调力参数
  const handleEngineStop = useCallback(() => {
    // 引擎稳定后不做额外操作
  }, []);

  // 配置力引擎
  useEffect(() => {
    if (!fgRef.current || !graphData) return;
    const fg = fgRef.current;
    // 调整斥力
    const charge = fg.d3Force("charge");
    if (charge) charge.strength(-80).distanceMax(300);
    // 调整连线弹力
    const link = fg.d3Force("link");
    if (link) link.distance(50);
    // 居中力
    const center = fg.d3Force("center");
    if (center) center.strength(0.05);
  }, [graphData]);

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
              知识图谱
            </span>
            {graphData && (
              <span className="text-[11px] ml-2 global-graph-muted">
                {graphData.nodes.length} 节点 · {graphData.links.length} 连线
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-3 mr-4 text-[11px] global-graph-muted">
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full global-graph-legend-dot-note" />
                笔记
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full global-graph-legend-dot-ghost" />
                未创建
              </span>
            </div>
            <button
              type="button"
              onClick={onClose}
              title="关闭知识图谱"
              aria-label="关闭知识图谱"
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
              <span className="text-[13px] global-graph-tertiary">加载图谱…</span>
            </div>
          )}

          {!loading && graphData && graphData.nodes.length === 0 && (
            <div className="flex items-center justify-center h-full">
              <p className="text-[13px] global-graph-muted">暂无图谱数据</p>
            </div>
          )}

          {!loading && graphData && graphData.nodes.length > 0 && dimensions.width > 0 && (
            <ForceGraph2D
              ref={fgRef}
              graphData={graphData}
              width={dimensions.width}
              height={dimensions.height}
              backgroundColor="rgba(0,0,0,0)"
              nodeCanvasObject={paintNode}
              nodeCanvasObjectMode={() => "replace"}
              nodePointerAreaPaint={paintPointerArea}
              onNodeClick={handleNodeClick}
              onNodeHover={(node: RuntimeNode | null) => setHoveredNode(node)}
              linkColor={(link: any) => {
                const src = typeof link.source === "object" ? link.source.id : link.source;
                const tgt = typeof link.target === "object" ? link.target.id : link.target;
                return isLinkHighlighted(src, tgt)
                  ? "rgba(255, 255, 255, 0.08)"
                  : "rgba(255, 255, 255, 0.02)";
              }}
              linkWidth={0.5}
              linkDirectionalParticles={1}
              linkDirectionalParticleWidth={1.5}
              linkDirectionalParticleSpeed={0.004}
              linkDirectionalParticleColor={() => "rgba(10, 132, 255, 0.3)"}
              enableNodeDrag={true}
              enableZoomInteraction={true}
              enablePanInteraction={true}
              cooldownTicks={200}
              d3AlphaDecay={0.02}
              d3VelocityDecay={0.3}
              onEngineStop={handleEngineStop}
              minZoom={0.3}
              maxZoom={8}
            />
          )}
        </div>

        {/* Bottom hint */}
        <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex items-center gap-4 text-[11px] px-3 py-1.5 rounded-lg global-graph-bottom-hint">
          <span>滚轮缩放</span>
          <span>拖拽平移</span>
          <span>点击节点跳转</span>
        </div>
      </div>
    </div>
  );
}
