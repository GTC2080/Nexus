import { useState, useRef, useCallback } from "react";
import type { MouseEvent, DragEvent } from "react";
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
  node, depth, activeNoteId, onSelectNote, onOpenContextMenu, onMoveToFolder,
}: {
  node: FileTreeNode;
  depth: number;
  activeNoteId: string | null;
  onSelectNote: (note: NoteInfo) => void;
  onOpenContextMenu: (e: MouseEvent, target: FileTreeContextTarget) => void;
  onMoveToFolder: (sourceRelativePath: string, destFolderRelativePath: string) => void;
}) {
  const [expanded, setExpanded] = useState(depth < 1);
  const [dragOver, setDragOver] = useState(false);
  const dragCountRef = useRef(0);

  const handleDragStart = useCallback((e: DragEvent) => {
    e.dataTransfer.setData("text/x-filetree-path", node.relativePath);
    e.dataTransfer.setData("text/x-filetree-isfolder", node.isFolder ? "1" : "0");
    e.dataTransfer.effectAllowed = "move";
    // Make dragged item semi-transparent
    if (e.currentTarget instanceof HTMLElement) {
      e.currentTarget.style.opacity = "0.4";
    }
  }, [node.relativePath, node.isFolder]);

  const handleDragEnd = useCallback((e: DragEvent) => {
    if (e.currentTarget instanceof HTMLElement) {
      e.currentTarget.style.opacity = "";
    }
  }, []);

  const handleDragOver = useCallback((e: DragEvent) => {
    if (!node.isFolder) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = "move";
  }, [node.isFolder]);

  const handleDragEnter = useCallback((e: DragEvent) => {
    if (!node.isFolder) return;
    e.preventDefault();
    e.stopPropagation();
    dragCountRef.current++;
    if (dragCountRef.current === 1) {
      setDragOver(true);
    }
  }, [node.isFolder]);

  const handleDragLeave = useCallback((e: DragEvent) => {
    if (!node.isFolder) return;
    e.stopPropagation();
    dragCountRef.current--;
    if (dragCountRef.current <= 0) {
      dragCountRef.current = 0;
      setDragOver(false);
    }
  }, [node.isFolder]);

  const handleDrop = useCallback((e: DragEvent) => {
    if (!node.isFolder) return;
    e.preventDefault();
    e.stopPropagation();
    dragCountRef.current = 0;
    setDragOver(false);

    const sourcePath = e.dataTransfer.getData("text/x-filetree-path");
    if (!sourcePath || sourcePath === node.relativePath) return;

    // Don't drop into its current parent (already there)
    const sourceParent = sourcePath.includes("/")
      ? sourcePath.substring(0, sourcePath.lastIndexOf("/"))
      : "";
    if (sourceParent === node.relativePath) return;

    // Don't drop a folder into its own subtree
    if (node.relativePath.startsWith(sourcePath + "/")) return;

    onMoveToFolder(sourcePath, node.relativePath);
  }, [node.relativePath, node.isFolder, onMoveToFolder]);

  if (node.isFolder) {
    const fileCount = countFiles(node);
    return (
      <div>
        <div
          role="button"
          tabIndex={0}
          draggable
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
          onDragOver={handleDragOver}
          onDragEnter={handleDragEnter}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onClick={() => setExpanded(p => !p)}
          onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setExpanded(p => !p); } }}
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
          style={{
            paddingLeft: `${10 + depth * 14}px`,
            paddingRight: 10,
            background: dragOver ? "rgba(10,132,255,0.18)" : undefined,
            outline: dragOver ? "2px dashed rgba(10,132,255,0.6)" : "none",
            outlineOffset: "-2px",
            borderRadius: 10,
          }}
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
            style={{ color: dragOver ? "rgba(10,132,255,0.8)" : expanded ? "rgba(10,132,255,0.5)" : "rgba(255,255,255,0.25)" }}
            viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"
            strokeLinecap="round" strokeLinejoin="round">
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
          </svg>
          <span className="truncate flex-1" style={{ color: dragOver ? "rgba(10,132,255,0.9)" : "rgba(255,255,255,0.6)", fontWeight: 500 }}>
            {node.name}
          </span>
          <span className="text-[10px] tabular-nums" style={{ color: "rgba(255,255,255,0.12)" }}>
            {fileCount}
          </span>
        </div>
        {expanded && (
          <div>
            {node.children.map((child, i) => (
              <FileTreeItem
                key={child.isFolder ? `d:${child.name}` : child.note?.id ?? i}
                node={child} depth={depth + 1}
                activeNoteId={activeNoteId} onSelectNote={onSelectNote}
                onOpenContextMenu={onOpenContextMenu}
                onMoveToFolder={onMoveToFolder}
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
    <div
      role="button"
      tabIndex={0}
      draggable
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onClick={() => onSelectNote(note)}
      onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelectNote(note); } }}
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
        transition-all duration-150 cursor-pointer flex items-center gap-2 relative
        hover:bg-white/[0.055]"
      style={{
        paddingLeft: `${24 + depth * 14}px`, paddingRight: 10,
        background: isActive ? "rgba(10,132,255,0.12)" : "transparent",
      }}
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
    </div>
  );
}
