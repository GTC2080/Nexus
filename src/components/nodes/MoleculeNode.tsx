import { memo, useState } from "react";
import type { ChangeEvent } from "react";
import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import SmilesViewer from "../SmilesViewer";
import type { MoleculeCanvasNodeData } from "../canvas/canvasUtils";

type MoleculeFlowNode = Node<MoleculeCanvasNodeData, "moleculeNode">;

function MoleculeNode({ id, data, selected }: NodeProps<MoleculeFlowNode>) {
  const [hovered, setHovered] = useState(false);
  const showAction = hovered || selected;

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
      className={`relative min-w-[320px] rounded-md border bg-[var(--panel-bg)] p-3 transition-all ${
        selected ? "border-[var(--accent)]" : "border-[var(--panel-border)]"
      } ${data.isRetrosynthesizing ? "animate-pulse shadow-[0_0_24px_rgba(59,130,246,0.45)]" : ""}`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <Handle type="target" position={Position.Left} className="!w-2.5 !h-2.5 !border-0 !bg-[var(--accent)]" />

      <input
        value={data.title ?? ""}
        onChange={handleTitleChange}
        placeholder="Target Molecule"
        className="w-full border-b border-[var(--separator-light)] bg-transparent pb-1.5 text-[12px] font-mono text-[var(--text-secondary)] outline-none"
      />
      <input
        value={data.smiles ?? ""}
        onChange={handleSmilesChange}
        placeholder="SMILES"
        className="mt-2 w-full rounded border border-[var(--glass-border)] bg-transparent px-2 py-1.5 text-[12px] font-mono text-[var(--text-primary)] outline-none focus:border-[var(--glass-border-hover)]"
      />

      <SmilesViewer smiles={data.smiles ?? ""} width={240} height={150} compact />

      <button
        type="button"
        onClick={handleRetro}
        className={`absolute bottom-2 right-2 rounded border border-[var(--separator)] bg-[var(--surface-0)] px-2 py-1 text-[11px] font-mono text-[var(--text-tertiary)] transition-all hover:border-[var(--accent)] hover:text-[var(--accent)] ${
          showAction ? "opacity-100" : "opacity-0 pointer-events-none"
        }`}
      >
        ↤ Retro
      </button>

      <Handle type="source" position={Position.Right} className="!w-2.5 !h-2.5 !border-0 !bg-[var(--accent)]" />
    </div>
  );
}

export default memo(MoleculeNode);
