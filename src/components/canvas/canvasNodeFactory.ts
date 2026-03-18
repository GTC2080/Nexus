import type { Edge } from "@xyflow/react";
import type {
  CanvasFlowNode,
  CanvasRuntimeData,
  MarkdownCanvasNodeData,
  MoleculeCanvasNodeData,
} from "./canvasUtils";

interface CreateNodeInput {
  x: number;
  y: number;
  chemistryMode: boolean;
}

function createRuntimeData(chemistryMode: boolean): CanvasRuntimeData {
  return {
    onChange: () => undefined,
    onPonder: () => undefined,
    onRetrosynthesize: () => undefined,
    isPondering: false,
    isRetrosynthesizing: false,
    chemistryMode,
  };
}

export function createMarkdownCanvasNode({
  x,
  y,
  chemistryMode,
  title = "New Node",
}: CreateNodeInput & { title?: string }): CanvasFlowNode {
  const data: MarkdownCanvasNodeData = {
    ...createRuntimeData(chemistryMode),
    title,
    content: "",
  };
  return {
    id: crypto.randomUUID(),
    type: "markdownNode",
    position: { x, y },
    data,
  };
}

export function createMoleculeCanvasNode({
  x,
  y,
  chemistryMode,
  smiles = "",
}: CreateNodeInput & { smiles?: string }): CanvasFlowNode {
  const data: MoleculeCanvasNodeData = {
    ...createRuntimeData(chemistryMode),
    title: "Target Molecule",
    content: "",
    smiles,
  };
  return {
    id: crypto.randomUUID(),
    type: "moleculeNode",
    position: { x, y },
    data,
  };
}

export function serializeCanvas(nextNodes: CanvasFlowNode[], nextEdges: Edge[]): string {
  const pureNodes = nextNodes.map(({ data, ...node }) => ({
    ...node,
    data: {
      title: data.title,
      content: data.content,
      ...(typeof data.smiles === "string" ? { smiles: data.smiles } : {}),
      ...(typeof data.retroId === "string" ? { retroId: data.retroId } : {}),
    },
  }));

  return JSON.stringify({ nodes: pureNodes, edges: nextEdges }, null, 2);
}
