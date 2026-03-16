import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { Edge } from "@xyflow/react";
import { sanitizePonderPayload, type MarkdownFlowNode } from "../components/canvasUtils";

const STAGGER_DELAY_MS = 120;

interface UseCanvasPonderOptions {
  nodes: MarkdownFlowNode[];
  setNodes: (updater: (prev: MarkdownFlowNode[]) => MarkdownFlowNode[]) => void;
  setEdges: (updater: (prev: Edge[]) => Edge[]) => void;
  onToast: (message: string) => void;
}

export function useCanvasPonder({ nodes, setNodes, setEdges, onToast }: UseCanvasPonderOptions) {
  const timeoutIdsRef = useRef<number[]>([]);
  const [ponderingNodeId, setPonderingNodeId] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      timeoutIdsRef.current.forEach(id => window.clearTimeout(id));
    };
  }, []);

  const onPonder = useCallback(async (nodeId: string, topic: string, context: string) => {
    if (!topic) {
      onToast("请先填写节点标题再进行思索");
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
      onToast(`Ponder 失败: ${msg}`);
    } finally {
      setPonderingNodeId(null);
    }
  }, [nodes, onToast, setEdges, setNodes]);

  const clearPonderingNode = useCallback(() => {
    setPonderingNodeId(null);
  }, []);

  return { onPonder, ponderingNodeId, clearPonderingNode };
}
