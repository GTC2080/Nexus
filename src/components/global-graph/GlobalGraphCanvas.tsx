import { useCallback, useEffect, useRef } from "react";
import ForceGraph2D from "react-force-graph-2d";
import type { GraphData, GraphNode } from "../../types";

interface RuntimeNode extends GraphNode {
  x?: number;
  y?: number;
}

interface RuntimeLink {
  source: string | RuntimeNode;
  target: string | RuntimeNode;
  kind?: string;
}

interface GlobalGraphCanvasProps {
  graphData: GraphData;
  width: number;
  height: number;
  hoveredNode: RuntimeNode | null;
  neighborMap: Map<string, Set<string>>;
  linkSet: Set<string>;
  onNodeClick: (node: RuntimeNode) => void;
  onNodeHover: (node: RuntimeNode | null) => void;
}

export default function GlobalGraphCanvas({
  graphData,
  width,
  height,
  hoveredNode,
  neighborMap,
  linkSet,
  onNodeClick,
  onNodeHover,
}: GlobalGraphCanvasProps) {
  const fgRef = useRef<any>(null);

  const isHighlighted = useCallback((nodeId: string) => {
    if (!hoveredNode) return true;
    if (hoveredNode.id === nodeId) return true;
    return neighborMap.get(hoveredNode.id)?.has(nodeId) ?? false;
  }, [hoveredNode, neighborMap]);

  const isLinkHighlighted = useCallback((source: string, target: string) => {
    if (!hoveredNode) return true;
    return (hoveredNode.id === source || hoveredNode.id === target) &&
      linkSet.has(`${source}->${target}`);
  }, [hoveredNode, linkSet]);

  const paintNode = useCallback((node: RuntimeNode, ctx: CanvasRenderingContext2D, globalScale: number) => {
    const x = node.x ?? 0;
    const y = node.y ?? 0;
    const highlighted = isHighlighted(node.id);
    const opacity = highlighted ? 1 : 0.12;
    const connections = neighborMap.get(node.id)?.size ?? 0;
    const baseSize = Math.min(3 + connections * 0.6, 8);
    const size = hoveredNode?.id === node.id ? baseSize * 1.4 : baseSize;

    let color: string;
    if (node.ghost) {
      color = `rgba(142, 142, 147, ${opacity * 0.5})`;
    } else if (hoveredNode?.id === node.id) {
      color = `rgba(10, 132, 255, ${opacity})`;
    } else {
      color = `rgba(10, 132, 255, ${opacity * 0.7})`;
    }

    if (hoveredNode?.id === node.id) {
      ctx.beginPath();
      ctx.arc(x, y, size + 4, 0, 2 * Math.PI);
      ctx.fillStyle = "rgba(10, 132, 255, 0.08)";
      ctx.fill();
    }

    ctx.beginPath();
    ctx.arc(x, y, size, 0, 2 * Math.PI);
    ctx.fillStyle = color;
    ctx.fill();

    const showLabel = globalScale > 1.5 || hoveredNode?.id === node.id ||
      (highlighted && hoveredNode !== null);
    if (showLabel) {
      const fontSize = Math.max(10 / globalScale, 2);
      ctx.font = `${fontSize}px -apple-system, BlinkMacSystemFont, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.fillStyle = highlighted
        ? `rgba(255, 255, 255, ${node.ghost ? 0.4 : 0.8})`
        : "rgba(255, 255, 255, 0.1)";
      ctx.fillText(node.name, x, y + size + 2);
    }
  }, [hoveredNode, isHighlighted, neighborMap]);

  const paintPointerArea = useCallback((node: RuntimeNode, color: string, ctx: CanvasRenderingContext2D) => {
    const x = node.x ?? 0;
    const y = node.y ?? 0;
    const connections = neighborMap.get(node.id)?.size ?? 0;
    const size = Math.min(3 + connections * 0.6, 8) + 4;
    ctx.beginPath();
    ctx.arc(x, y, size, 0, 2 * Math.PI);
    ctx.fillStyle = color;
    ctx.fill();
  }, [neighborMap]);

  useEffect(() => {
    if (!fgRef.current) return;
    const fg = fgRef.current;
    const charge = fg.d3Force("charge");
    if (charge) charge.strength(-80).distanceMax(300);
    const link = fg.d3Force("link");
    if (link) link.distance(50);
    const center = fg.d3Force("center");
    if (center) center.strength(0.05);
  }, [graphData]);

  return (
    <ForceGraph2D
      ref={fgRef}
      graphData={graphData}
      width={width}
      height={height}
      backgroundColor="rgba(0,0,0,0)"
      nodeCanvasObject={paintNode}
      nodeCanvasObjectMode={() => "replace"}
      nodePointerAreaPaint={paintPointerArea}
      onNodeClick={onNodeClick}
      onNodeHover={(node: RuntimeNode | null) => onNodeHover(node)}
      linkColor={(link: RuntimeLink) => {
        const src = typeof link.source === "object" ? link.source.id : link.source;
        const tgt = typeof link.target === "object" ? link.target.id : link.target;
        const highlighted = isLinkHighlighted(src, tgt);
        const kind = link.kind ?? "link";
        if (kind === "link") return highlighted ? "rgba(10, 132, 255, 0.18)" : "rgba(10, 132, 255, 0.04)";
        if (kind === "tag") return highlighted ? "rgba(48, 209, 88, 0.15)" : "rgba(48, 209, 88, 0.03)";
        return highlighted ? "rgba(255, 255, 255, 0.06)" : "rgba(255, 255, 255, 0.015)";
      }}
      linkWidth={(link: RuntimeLink) => {
        const kind = link.kind ?? "link";
        if (kind === "link") return 0.8;
        if (kind === "tag") return 0.5;
        return 0.3;
      }}
      linkDirectionalParticles={(link: RuntimeLink) => {
        const kind = link.kind ?? "link";
        return kind === "folder" ? 0 : 1;
      }}
      linkDirectionalParticleWidth={1.5}
      linkDirectionalParticleSpeed={0.004}
      linkDirectionalParticleColor={(link: RuntimeLink) => {
        const kind = link.kind ?? "link";
        if (kind === "tag") return "rgba(48, 209, 88, 0.25)";
        return "rgba(10, 132, 255, 0.3)";
      }}
      enableNodeDrag
      enableZoomInteraction
      enablePanInteraction
      cooldownTicks={200}
      d3AlphaDecay={0.02}
      d3VelocityDecay={0.3}
      onEngineStop={() => {}}
      minZoom={0.3}
      maxZoom={8}
    />
  );
}
