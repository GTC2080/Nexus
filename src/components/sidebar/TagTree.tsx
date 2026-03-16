import { useState } from "react";
import type { TagInfo } from "../../types";

// ===== Data Structure =====

export interface TagTreeNode {
  name: string;
  fullPath: string;
  count: number;
  children: TagTreeNode[];
}

export function buildTagTree(tags: TagInfo[]): TagTreeNode[] {
  const root: TagTreeNode[] = [];
  for (const tag of tags) {
    const parts = tag.name.split("/");
    let currentLevel = root;
    for (let i = 0; i < parts.length; i++) {
      const segment = parts[i];
      const fullPath = parts.slice(0, i + 1).join("/");
      let existing = currentLevel.find(n => n.name === segment);
      if (!existing) {
        existing = { name: segment, fullPath, count: 0, children: [] };
        currentLevel.push(existing);
      }
      if (fullPath === tag.name) existing.count = tag.count;
      currentLevel = existing.children;
    }
  }
  return root;
}

// ===== Component =====

export function TagTreeItem({
  node, depth, onSelectTag, selectedTag,
}: {
  node: TagTreeNode; depth: number; onSelectTag: (tag: string) => void; selectedTag: string | null;
}) {
  const [expanded, setExpanded] = useState(depth === 0);
  const hasChildren = node.children.length > 0;
  const isSelected = selectedTag === node.fullPath;

  return (
    <div>
      <button
        type="button"
        onClick={() => { if (hasChildren) setExpanded(p => !p); onSelectTag(node.fullPath); }}
        className="w-full text-left py-[6px] rounded-[10px] text-[13px]
          transition-all duration-150 cursor-pointer flex items-center gap-1.5"
        style={{
          paddingLeft: `${10 + depth * 14}px`, paddingRight: 10,
          background: isSelected ? "rgba(10,132,255,0.12)" : "transparent",
        }}
        onMouseEnter={e => { if (!isSelected) (e.currentTarget.style.background = "rgba(255,255,255,0.05)"); }}
        onMouseLeave={e => { if (!isSelected) (e.currentTarget.style.background = "transparent"); }}
      >
        {hasChildren ? (
          <svg className="w-3 h-3 shrink-0 transition-transform duration-200"
            style={{ color: "rgba(255,255,255,0.2)", transform: expanded ? "rotate(90deg)" : "rotate(0deg)" }}
            viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
            strokeLinecap="round" strokeLinejoin="round">
            <polyline points="9 18 15 12 9 6" />
          </svg>
        ) : <span className="w-3 shrink-0" />}
        <span className="w-[6px] h-[6px] rounded-full shrink-0"
          style={{ background: isSelected ? "var(--accent)" : "rgba(255,255,255,0.12)" }} />
        <span className="truncate flex-1" style={{
          color: isSelected ? "rgba(255,255,255,0.95)" : "rgba(255,255,255,0.5)",
          fontWeight: isSelected ? 500 : 400,
        }}>
          {node.name}
        </span>
        {node.count > 0 && (
          <span className="text-[10px] tabular-nums" style={{ color: "rgba(255,255,255,0.18)" }}>
            {node.count}
          </span>
        )}
      </button>
      {hasChildren && expanded && (
        <div>
          {node.children.map(child => (
            <TagTreeItem key={child.fullPath} node={child} depth={depth + 1}
              onSelectTag={onSelectTag} selectedTag={selectedTag} />
          ))}
        </div>
      )}
    </div>
  );
}
