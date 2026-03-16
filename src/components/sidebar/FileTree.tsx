import { useState } from "react";
import type { MouseEvent } from "react";
import type { NoteInfo } from "../../types";
import FileIcon from "./FileIcon";

// ===== Data Structure =====

export interface FileTreeNode {
  name: string;
  fullName: string;
  relativePath: string;
  isFolder: boolean;
  note?: NoteInfo;
  children: FileTreeNode[];
}

export interface FileTreeContextTarget {
  isFolder: boolean;
  label: string;
  relativePath: string;
  note: NoteInfo | null;
}

export function buildFileTree(notes: NoteInfo[]): FileTreeNode[] {
  const root: FileTreeNode[] = [];

  for (const note of notes) {
    const parts = note.id.replace(/\\/g, "/").split("/");
    let currentLevel = root;

    for (let i = 0; i < parts.length; i++) {
      const segment = parts[i];
      const isLast = i === parts.length - 1;

      if (isLast) {
        currentLevel.push({
          name: note.name,
          fullName: segment,
          relativePath: parts.slice(0, i + 1).join("/"),
          isFolder: false,
          note,
          children: [],
        });
      } else {
        let folder = currentLevel.find(n => n.isFolder && n.name === segment);
        if (!folder) {
          folder = {
            name: segment,
            fullName: segment,
            relativePath: parts.slice(0, i + 1).join("/"),
            isFolder: true,
            children: [],
          };
          currentLevel.push(folder);
        }
        currentLevel = folder.children;
      }
    }
  }

  function sortTree(nodes: FileTreeNode[]) {
    nodes.sort((a, b) => {
      if (a.isFolder !== b.isFolder) return a.isFolder ? -1 : 1;
      return a.name.localeCompare(b.name, "zh-CN");
    });
    for (const n of nodes) {
      if (n.isFolder) sortTree(n.children);
    }
  }
  sortTree(root);
  return root;
}

function countFiles(node: FileTreeNode): number {
  if (!node.isFolder) return 1;
  return node.children.reduce((sum, c) => sum + countFiles(c), 0);
}

// ===== Component =====

export function FileTreeItem({
  node, depth, activeNoteId, onSelectNote, onOpenContextMenu,
}: {
  node: FileTreeNode;
  depth: number;
  activeNoteId: string | null;
  onSelectNote: (note: NoteInfo) => void;
  onOpenContextMenu: (e: MouseEvent, target: FileTreeContextTarget) => void;
}) {
  const [expanded, setExpanded] = useState(depth < 1);

  if (node.isFolder) {
    const fileCount = countFiles(node);
    return (
      <div>
        <button
          type="button"
          onClick={() => setExpanded(p => !p)}
          onContextMenu={e => {
            e.preventDefault();
            onOpenContextMenu(e, {
              isFolder: true,
              label: node.name,
              relativePath: node.relativePath,
              note: null,
            });
          }}
          className="w-full text-left py-[6px] rounded-[10px] text-[13px]
            transition-all duration-150 cursor-pointer flex items-center gap-1.5
            hover:bg-white/[0.055]"
          style={{ paddingLeft: `${10 + depth * 14}px`, paddingRight: 10 }}
        >
          <svg
            className="w-3 h-3 shrink-0 transition-transform duration-200"
            style={{
              color: "rgba(255,255,255,0.2)",
              transform: expanded ? "rotate(90deg)" : "rotate(0deg)",
            }}
            viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
            strokeLinecap="round" strokeLinejoin="round"
          >
            <polyline points="9 18 15 12 9 6" />
          </svg>
          <svg className="w-[15px] h-[15px] shrink-0"
            style={{ color: expanded ? "rgba(10,132,255,0.5)" : "rgba(255,255,255,0.25)" }}
            viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"
            strokeLinecap="round" strokeLinejoin="round">
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
          </svg>
          <span className="truncate flex-1" style={{ color: "rgba(255,255,255,0.6)", fontWeight: 500 }}>
            {node.name}
          </span>
          <span className="text-[10px] tabular-nums" style={{ color: "rgba(255,255,255,0.12)" }}>
            {fileCount}
          </span>
        </button>
        {expanded && (
          <div>
            {node.children.map((child, i) => (
              <FileTreeItem
                key={child.isFolder ? `d:${child.name}` : child.note?.id ?? i}
                node={child} depth={depth + 1}
                activeNoteId={activeNoteId} onSelectNote={onSelectNote}
                onOpenContextMenu={onOpenContextMenu}
              />
            ))}
          </div>
        )}
      </div>
    );
  }

  // File node
  const note = node.note!;
  const isActive = activeNoteId === note.id;

  return (
    <button
      onClick={() => onSelectNote(note)}
      onContextMenu={e => {
        e.preventDefault();
        onOpenContextMenu(e, {
          isFolder: false,
          label: note.name,
          relativePath: node.relativePath,
          note,
        });
      }}
      className="w-full text-left py-[6px] rounded-[10px] text-[13px]
        transition-all duration-150 cursor-pointer flex items-center gap-2 relative"
      style={{
        paddingLeft: `${24 + depth * 14}px`, paddingRight: 10,
        background: isActive ? "rgba(10,132,255,0.12)" : "transparent",
      }}
      onMouseEnter={e => { if (!isActive) (e.currentTarget.style.background = "rgba(255,255,255,0.05)"); }}
      onMouseLeave={e => { if (!isActive) (e.currentTarget.style.background = "transparent"); }}
    >
      {isActive && (
        <div className="absolute left-[3px] top-1/2 -translate-y-1/2 w-[3px] h-[14px] rounded-full"
          style={{ background: "var(--accent)", boxShadow: "0 0 6px rgba(10,132,255,0.4)" }} />
      )}
      <FileIcon ext={note.file_extension} active={isActive} />
      <span className="truncate" style={{
        color: isActive ? "rgba(255,255,255,0.95)" : "rgba(255,255,255,0.5)",
        fontWeight: isActive ? 500 : 400,
      }}>
        {note.name}
        {note.file_extension !== "md" && (
          <span style={{ color: "rgba(255,255,255,0.18)", fontWeight: 400 }}>.{note.file_extension}</span>
        )}
      </span>
    </button>
  );
}
