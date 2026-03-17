import { useState, useRef, useCallback, useEffect } from "react";
import type { MouseEvent, DragEvent } from "react";
import type { FileTreeNode, NoteInfo } from "../../types";
import FileIcon from "./FileIcon";

export interface FileTreeContextTarget {
  isFolder: boolean;
  label: string;
  relativePath: string;
  note: NoteInfo | null;
}

// ===== Component =====

export function FileTreeItem({
  node, depth, activeNoteId, onSelectNote, onOpenContextMenu, onMoveToFolder, onInlineRename,
}: {
  node: FileTreeNode;
  depth: number;
  activeNoteId: string | null;
  onSelectNote: (note: NoteInfo) => void;
  onOpenContextMenu: (e: MouseEvent, target: FileTreeContextTarget) => void;
  onMoveToFolder: (sourceRelativePath: string, destFolderRelativePath: string) => void;
  onInlineRename: (sourceRelativePath: string, newName: string) => void;
}) {
  const [expanded, setExpanded] = useState(depth < 1);
  const [dragOver, setDragOver] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(node.fullName);
  const renameInputRef = useRef<HTMLInputElement | null>(null);
  const dragCountRef = useRef(0);

  useEffect(() => {
    if (!renaming) return;
    const timer = window.setTimeout(() => {
      if (!renameInputRef.current) return;
      renameInputRef.current.focus();
      renameInputRef.current.select();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [renaming]);

  useEffect(() => {
    setRenameValue(node.fullName);
    setRenaming(false);
  }, [node.fullName]);

  const beginRename = useCallback(() => {
    setRenameValue(node.fullName);
    setRenaming(true);
  }, [node.fullName]);

  const commitRename = useCallback(() => {
    const next = renameValue.trim();
    setRenaming(false);
    if (!next || next === node.fullName) return;
    onInlineRename(node.relativePath, next);
  }, [renameValue, node.fullName, node.relativePath, onInlineRename]);

  const cancelRename = useCallback(() => {
    setRenaming(false);
    setRenameValue(node.fullName);
  }, [node.fullName]);

  const handleDragStart = useCallback((e: DragEvent) => {
    if (renaming) {
      e.preventDefault();
      return;
    }
    e.dataTransfer.setData("text/x-filetree-path", node.relativePath);
    e.dataTransfer.setData("text/x-filetree-isfolder", node.isFolder ? "1" : "0");
    e.dataTransfer.effectAllowed = "move";
    // Make dragged item semi-transparent
    if (e.currentTarget instanceof HTMLElement) {
      e.currentTarget.style.opacity = "0.4";
    }
  }, [node.relativePath, node.isFolder, renaming]);

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
    const fileCount = node.fileCount;
    return (
      <div>
        <div
          role="button"
          tabIndex={0}
          draggable={!renaming}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
          onDragOver={handleDragOver}
          onDragEnter={handleDragEnter}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onClick={() => { if (!renaming) setExpanded(p => !p); }}
          onKeyDown={e => {
            if (renaming) return;
            if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setExpanded(p => !p); }
          }}
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
          {renaming ? (
            <>
              <label htmlFor={`rename-folder-${node.relativePath}`} className="sr-only">重命名文件夹</label>
              <input
                id={`rename-folder-${node.relativePath}`}
                ref={renameInputRef}
                value={renameValue}
                aria-label="重命名文件夹"
                title="重命名文件夹"
                placeholder="输入新名称"
                onChange={e => setRenameValue(e.target.value)}
                onClick={e => e.stopPropagation()}
                onDoubleClick={e => e.stopPropagation()}
                onBlur={commitRename}
                onKeyDown={e => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    commitRename();
                  } else if (e.key === "Escape") {
                    e.preventDefault();
                    cancelRename();
                  }
                }}
                className="flex-1 bg-transparent text-[13px] outline-none border-b border-white/25"
                style={{ color: "rgba(255,255,255,0.95)" }}
              />
            </>
          ) : (
            <span
              className="truncate flex-1"
              style={{ color: dragOver ? "rgba(10,132,255,0.9)" : "rgba(255,255,255,0.6)", fontWeight: 500 }}
              onDoubleClick={e => {
                e.stopPropagation();
                beginRename();
              }}
            >
              {node.name}
            </span>
          )}
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
                onInlineRename={onInlineRename}
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
      draggable={!renaming}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onClick={() => { if (!renaming) onSelectNote(note); }}
      onKeyDown={e => {
        if (renaming) return;
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelectNote(note); }
      }}
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
      {renaming ? (
        <>
          <label htmlFor={`rename-file-${node.relativePath}`} className="sr-only">重命名文件</label>
          <input
            id={`rename-file-${node.relativePath}`}
            ref={renameInputRef}
            value={renameValue}
            aria-label="重命名文件"
            title="重命名文件"
            placeholder="输入新名称"
            onChange={e => setRenameValue(e.target.value)}
            onClick={e => e.stopPropagation()}
            onDoubleClick={e => e.stopPropagation()}
            onBlur={commitRename}
            onKeyDown={e => {
              if (e.key === "Enter") {
                e.preventDefault();
                commitRename();
              } else if (e.key === "Escape") {
                e.preventDefault();
                cancelRename();
              }
            }}
            className="flex-1 bg-transparent text-[13px] outline-none border-b border-white/25"
            style={{ color: "rgba(255,255,255,0.95)" }}
          />
        </>
      ) : (
        <span
          className="truncate"
          style={{
            color: isActive ? "rgba(255,255,255,0.95)" : "rgba(255,255,255,0.5)",
            fontWeight: isActive ? 500 : 400,
          }}
          onDoubleClick={e => {
            e.stopPropagation();
            beginRename();
          }}
        >
          {note.name}
          {note.file_extension !== "md" && (
            <span style={{ color: "rgba(255,255,255,0.18)", fontWeight: 400 }}>.{note.file_extension}</span>
          )}
        </span>
      )}
    </div>
  );
}
