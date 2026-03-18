import { useCallback, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { Edge } from "@xyflow/react";
import { sanitizePonderPayload, type CanvasFlowNode } from "../components/canvas/canvasUtils";

interface UseCanvasPonderOptions {
  nodes: CanvasFlowNode[];
  setNodes: (updater: (prev: CanvasFlowNode[]) => CanvasFlowNode[]) => void;
  setEdges: (updater: (prev: Edge[]) => Edge[]) => void;
  onToast: (message: string) => void;
}

export function useCanvasPonder({ nodes, setNodes, setEdges, onToast }: UseCanvasPonderOptions) {
  const [ponderingNodeId, setPonderingNodeId] = useState<string | null>(null);

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

      const nextNodes: CanvasFlowNode[] = [];
      const nextEdges: Edge[] = [];
      for (let index = 0; index < suggestions.length; index += 1) {
        const item = suggestions[index];
        const childId = crypto.randomUUID();
        nextNodes.push({
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
            onRetrosynthesize: () => undefined,
            isPondering: false,
            isRetrosynthesizing: false,
          },
        });
        nextEdges.push({
          id: crypto.randomUUID(),
          source: nodeId,
          target: childId,
          label: item.relation,
          animated: true,
        });
      }
      if (nextNodes.length > 0) {
        setNodes(prev => [...prev, ...nextNodes]);
      }
      if (nextEdges.length > 0) {
        setEdges(prev => [...prev, ...nextEdges]);
      }
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
