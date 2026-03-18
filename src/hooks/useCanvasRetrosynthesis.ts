import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { Edge } from "@xyflow/react";
import type { CanvasFlowNode } from "../components/canvas/canvasUtils";

interface PrecursorNode {
  id: string;
  smiles: string;
  role: string;
}

interface ReactionPathway {
  target_id: string;
  precursors: PrecursorNode[];
  reaction_name: string;
  conditions: string;
}

interface RetroTreeData {
  pathways: ReactionPathway[];
}

interface UseCanvasRetrosynthesisOptions {
  chemistryMode: boolean;
  nodes: CanvasFlowNode[];
  setNodes: (updater: (prev: CanvasFlowNode[]) => CanvasFlowNode[]) => void;
  setEdges: (updater: (prev: Edge[]) => Edge[]) => void;
  onToast: (message: string) => void;
}

const RETRO_X_OFFSET = 450;
const RETRO_Y_SPREAD = 250;
const COLLISION_X_GAP = 320;
const COLLISION_Y_GAP = 220;

type GridPoint = { x: number; y: number };
type OccupiedGrid = Map<string, GridPoint[]>;

function cellKey(cx: number, cy: number): string {
  return `${cx},${cy}`;
}

function toCell(x: number, y: number): { cx: number; cy: number } {
  return {
    cx: Math.floor(x / COLLISION_X_GAP),
    cy: Math.floor(y / COLLISION_Y_GAP),
  };
}

function buildOccupiedGrid(points: GridPoint[]): OccupiedGrid {
  const grid: OccupiedGrid = new Map();
  for (const point of points) {
    const { cx, cy } = toCell(point.x, point.y);
    const key = cellKey(cx, cy);
    const bucket = grid.get(key);
    if (bucket) {
      bucket.push(point);
    } else {
      grid.set(key, [point]);
    }
  }
  return grid;
}

function addPointToGrid(grid: OccupiedGrid, point: GridPoint) {
  const { cx, cy } = toCell(point.x, point.y);
  const key = cellKey(cx, cy);
  const bucket = grid.get(key);
  if (bucket) {
    bucket.push(point);
    return;
  }
  grid.set(key, [point]);
}

function collidesInGrid(x: number, y: number, grid: OccupiedGrid): boolean {
  const { cx, cy } = toCell(x, y);
  for (let dx = -1; dx <= 1; dx += 1) {
    for (let dy = -1; dy <= 1; dy += 1) {
      const bucket = grid.get(cellKey(cx + dx, cy + dy));
      if (!bucket) continue;
      for (const point of bucket) {
        if (Math.abs(point.x - x) < COLLISION_X_GAP && Math.abs(point.y - y) < COLLISION_Y_GAP) {
          return true;
        }
      }
    }
  }
  return false;
}

function resolveCollisionPosition(x: number, y: number, grid: OccupiedGrid): { x: number; y: number } {
  if (!collidesInGrid(x, y, grid)) return { x, y };

  for (let ring = 1; ring <= 22; ring += 1) {
    for (const direction of [-1, 1] as const) {
      const nextX = x - ring * 56;
      const nextY = y + direction * ring * 110;
      if (!collidesInGrid(nextX, nextY, grid)) {
        return { x: nextX, y: nextY };
      }
    }
  }

  return { x: x - 120, y: y + 140 };
}

export function useCanvasRetrosynthesis({
  chemistryMode,
  nodes,
  setNodes,
  setEdges,
  onToast,
}: UseCanvasRetrosynthesisOptions) {
  const nodesRef = useRef(nodes);
  const [retrosynthesizingNodeId, setRetrosynthesizingNodeId] = useState<string | null>(null);

  useEffect(() => {
    nodesRef.current = nodes;
  }, [nodes]);

  const onRetrosynthesize = useCallback(
    async (nodeId: string, targetSmiles: string, depth: number) => {
      if (!chemistryMode) {
        onToast("逆合成功能仅在化学模式下可用");
        return;
      }
      const smiles = (targetSmiles ?? "").trim();
      if (!smiles) {
        onToast("请先填写目标分子 SMILES");
        return;
      }

      const rootNode = nodesRef.current.find(node => node.id === nodeId);
      if (!rootNode) return;

      setRetrosynthesizingNodeId(nodeId);
      try {
        const result = await invoke<RetroTreeData>("retrosynthesize_target", {
          targetSmiles: smiles,
          depth,
        });
        if (!Array.isArray(result.pathways) || result.pathways.length === 0) {
          onToast("未生成可用逆合成路径");
          return;
        }

        const existingNodes = nodesRef.current;
        const occupied = existingNodes.map(node => ({ x: node.position.x, y: node.position.y }));
        const occupiedGrid = buildOccupiedGrid(occupied);
        const retroToCanvas = new Map<string, string>();

        for (const existingNode of existingNodes) {
          const retroId =
            typeof existingNode.data?.retroId === "string" ? existingNode.data.retroId : "";
          if (retroId) {
            retroToCanvas.set(retroId, existingNode.id);
          }
        }

        const rootRetroId = result.pathways[0]?.target_id;
        if (rootRetroId) {
          retroToCanvas.set(rootRetroId, nodeId);
        }

        const createdNodes: CanvasFlowNode[] = [];
        const createdEdges: Edge[] = [];

        for (const pathway of result.pathways) {
          const targetCanvasId = retroToCanvas.get(pathway.target_id);
          if (!targetCanvasId) continue;

          const targetNode =
            existingNodes.find(node => node.id === targetCanvasId) ??
            createdNodes.find(node => node.id === targetCanvasId);
          if (!targetNode) continue;

          const count = pathway.precursors.length;
          if (count < 1) continue;

          pathway.precursors.forEach((precursor, index) => {
            let precursorCanvasId = retroToCanvas.get(precursor.id);
            if (!precursorCanvasId) {
              const baseX = targetNode.position.x - RETRO_X_OFFSET;
              const baseY = targetNode.position.y + (index - (count - 1) / 2) * RETRO_Y_SPREAD;
              const pos = resolveCollisionPosition(baseX, baseY, occupiedGrid);
              occupied.push(pos);
              addPointToGrid(occupiedGrid, pos);

              precursorCanvasId = crypto.randomUUID();
              retroToCanvas.set(precursor.id, precursorCanvasId);
              createdNodes.push({
                id: precursorCanvasId,
                type: "moleculeNode",
                position: pos,
                data: {
                  title: precursor.role,
                  content: "",
                  smiles: precursor.smiles,
                  retroId: precursor.id,
                  onChange: () => undefined,
                  onPonder: () => undefined,
                  onRetrosynthesize: () => undefined,
                  isPondering: false,
                  isRetrosynthesizing: false,
                  chemistryMode: true,
                },
              });
            }

            const label = `${pathway.reaction_name} · ${pathway.conditions}`;
            createdEdges.push({
              id: crypto.randomUUID(),
              source: precursorCanvasId,
              target: targetCanvasId,
              animated: true,
              type: "smoothstep",
              style: { stroke: "#1E3A8A", strokeWidth: 1.2 },
              label,
              labelStyle: {
                fill: "#888888",
                fontSize: 11,
                fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
              },
              labelShowBg: true,
              labelBgPadding: [8, 4],
              labelBgBorderRadius: 4,
              labelBgStyle: {
                fill: "#0A0A0A",
                fillOpacity: 0.95,
                stroke: "#222222",
                strokeWidth: 0.5,
              },
            });
          });
        }

        if (rootRetroId) {
          setNodes(prev =>
            prev.map(node =>
              node.id === nodeId
                ? { ...node, data: { ...node.data, smiles, retroId: rootRetroId } }
                : node
            )
          );
        }

        if (createdNodes.length > 0) {
          setNodes(prev => {
            const known = new Set(prev.map(node => node.id));
            const appended = createdNodes.filter(node => !known.has(node.id));
            return [...prev, ...appended];
          });
        }

        if (createdEdges.length > 0) {
          setEdges(prev => {
            const edgeKey = (edge: Edge) => `${edge.source}->${edge.target}::${String(edge.label ?? "")}`;
            const known = new Set(prev.map(edgeKey));
            const appended = createdEdges.filter(edge => !known.has(edgeKey(edge)));
            return [...prev, ...appended];
          });
        }
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        onToast(`逆合成失败: ${msg}`);
      } finally {
        setRetrosynthesizingNodeId(null);
      }
    },
    [chemistryMode, onToast, setEdges, setNodes]
  );

  const clearRetrosynthesisNode = useCallback(() => {
    setRetrosynthesizingNodeId(null);
  }, []);

  return { onRetrosynthesize, retrosynthesizingNodeId, clearRetrosynthesisNode };
}
