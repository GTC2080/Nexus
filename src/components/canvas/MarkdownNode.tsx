import { memo, useState } from "react";
import type { ChangeEvent } from "react";
import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import type { MarkdownCanvasNodeData } from "./canvasUtils";

type MarkdownFlowNode = Node<MarkdownCanvasNodeData, "markdownNode">;

function MarkdownNode({ id, data }: NodeProps<MarkdownFlowNode>) {
  const typedData = data;
  const [hovered, setHovered] = useState(false);

  const handleTitleChange = (e: ChangeEvent<HTMLInputElement>) => {
    typedData.onChange(id, { title: e.target.value });
  };

  const handleContentChange = (e: ChangeEvent<HTMLTextAreaElement>) => {
    typedData.onChange(id, { content: e.target.value });
  };

  return (
    <div
      className={`group relative bg-[var(--panel-bg)] border rounded-lg p-4 shadow-2xl min-w-[200px] backdrop-blur-md transition-colors ${
        typedData.isSelected ? "border-[var(--accent)]" : "border-[var(--panel-border)]"
      } ${
        typedData.isPondering ? "canvas-node-pondering" : ""
      }`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <Handle type="target" position={Position.Left} className="!w-2.5 !h-2.5 !border-0 !bg-[var(--accent)]/80" />
      <button
        type="button"
        onClick={() => typedData.onPonder(id, typedData.title.trim(), typedData.content.trim())}
        className={`absolute right-2 top-2 text-[11px] px-2 py-1 rounded border border-[var(--separator-light)] text-[var(--text-secondary)] bg-[var(--subtle-surface)] hover:bg-[var(--sidebar-hover)] transition-opacity ${
          hovered || typedData.isSelected ? "opacity-100" : "opacity-70"
        }`}
      >
        思索
      </button>
      <input
        value={typedData.title}
        onChange={handleTitleChange}
        placeholder="Node title"
        className="w-full bg-transparent text-[var(--text-primary)] text-[13px] font-medium outline-none border-b border-[var(--separator-light)] pb-2 pr-14"
      />
      <textarea
        value={typedData.content}
        onChange={handleContentChange}
        placeholder="Write ideas..."
        className="w-full mt-3 min-h-[88px] resize-none bg-transparent text-[var(--text-secondary)] text-[12px] leading-5 outline-none"
      />
      <Handle type="source" position={Position.Right} className="!w-2.5 !h-2.5 !border-0 !bg-[var(--accent)]/80" />
    </div>
  );
}

export default memo(MarkdownNode);
