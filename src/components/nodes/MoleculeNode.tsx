import { memo, useState } from "react";
import type { ChangeEvent } from "react";
import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import SmilesViewer from "../SmilesViewer";
import type { MoleculeCanvasNodeData } from "../canvas/canvasUtils";

type MoleculeFlowNode = Node<MoleculeCanvasNodeData, "moleculeNode">;

function MoleculeNode({ id, data }: NodeProps<MoleculeFlowNode>) {
  const [hovered, setHovered] = useState(false);
  const showAction = hovered || data.isSelected;

  const handleTitleChange = (e: ChangeEvent<HTMLInputElement>) => {
    data.onChange(id, { title: e.target.value });
  };

  const handleSmilesChange = (e: ChangeEvent<HTMLInputElement>) => {
    data.onChange(id, { smiles: e.target.value });
  };

  const handleRetro = () => {
    data.onRetrosynthesize(id, (data.smiles ?? "").trim(), 2);
  };

  return (
    <div
      className={`relative min-w-[320px] rounded-md border bg-[#141414] p-3 transition-all ${
        data.isSelected ? "border-blue-500/70" : "border-[#333333]"
      } ${data.isRetrosynthesizing ? "animate-pulse shadow-[0_0_24px_rgba(59,130,246,0.45)]" : ""}`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <Handle type="target" position={Position.Left} className="!w-2.5 !h-2.5 !border-0 !bg-[#1E3A8A]" />

      <input
        value={data.title ?? ""}
        onChange={handleTitleChange}
        placeholder="Target Molecule"
        className="w-full border-b border-[#2A2A2A] bg-transparent pb-1.5 text-[12px] font-mono text-[#BBBBBB] outline-none"
      />
      <input
        value={data.smiles ?? ""}
        onChange={handleSmilesChange}
        placeholder="SMILES"
        className="mt-2 w-full rounded border border-[#2A2A2A] bg-transparent px-2 py-1.5 text-[12px] font-mono text-[#EDEDED] outline-none focus:border-[#3A3A3A]"
      />

      <SmilesViewer smiles={data.smiles ?? ""} width={240} height={150} compact />

      <button
        type="button"
        onClick={handleRetro}
        className={`absolute bottom-2 right-2 rounded border border-[#333333] bg-[#0A0A0A] px-2 py-1 text-[11px] font-mono text-[#888888] transition-all hover:border-[#3B82F6] hover:text-[#B5C7FF] ${
          showAction ? "opacity-100" : "opacity-0 pointer-events-none"
        }`}
      >
        ↤ Retro
      </button>

      <Handle type="source" position={Position.Right} className="!w-2.5 !h-2.5 !border-0 !bg-[#1E3A8A]" />
    </div>
  );
}

export default memo(MoleculeNode);
