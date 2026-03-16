import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import type { MouseEvent, DragEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { NoteInfo, TagInfo } from "../types";
import { buildFileTree, FileTreeItem, type FileTreeContextTarget } from "./sidebar/FileTree";
import { buildTagTree, TagTreeItem } from "./sidebar/TagTree";

interface SidebarProps {
  vaultPath: string;
  notes: NoteInfo[];
  activeNote: NoteInfo | null;
  loading: boolean;
  width: number;
  onSelectNote: (note: NoteInfo) => void;
  onCreateFile: (kind: "note" | "canvas", targetFolderRelativePath?: string) => void;
  onDeleteEntry: (absolutePath: string, targetLabel: string, isFolder: boolean) => void;
  onMoveEntry: (sourceRelativePath: string, destFolderRelativePath: string) => void;
  onRenameEntry: (sourceRelativePath: string, currentFullName: string, isFolder: boolean) => void;
  onInlineRenameEntry: (sourceRelativePath: string, newName: string) => void;
  onCreateFolder: (targetParentRelativePath?: string) => void;
}

/** 文件树面板 — 纯内容，无工具按钮 */
export default function Sidebar({
  vaultPath, notes, activeNote, loading, width, onSelectNote, onCreateFile, onDeleteEntry, onMoveEntry, onRenameEntry, onInlineRenameEntry, onCreateFolder,
}: SidebarProps) {
  const [tab, setTab] = useState<"files" | "tags">("files");
  const [newMenuOpen, setNewMenuOpen] = useState(false);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    target: FileTreeContextTarget;
  } | null>(null);
  const [tags, setTags] = useState<TagInfo[]>([]);
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [tagNotes, setTagNotes] = useState<NoteInfo[]>([]);
  const [tagNotesLoading, setTagNotesLoading] = useState(false);

  useEffect(() => {
    if (!vaultPath || tab !== "tags") return;
    invoke<TagInfo[]>("get_all_tags").then(setTags).catch(e => console.error("加载标签失败:", e));
  }, [vaultPath, tab]);

  useEffect(() => {
    if (!vaultPath || tab !== "tags") return;
    invoke<TagInfo[]>("get_all_tags").then(setTags).catch(e => console.error("刷新标签失败:", e));
  }, [notes, vaultPath, tab]);

  const tagTree = useMemo(() => buildTagTree(tags), [tags]);
  const fileTree = useMemo(() => buildFileTree(notes), [notes]);

  const handleSelectTag = useCallback(async (tag: string) => {
    setSelectedTag(prev => (prev === tag ? null : tag));
    setTagNotesLoading(true);
    try {
      const result = await invoke<NoteInfo[]>("get_notes_by_tag", { tag });
      setTagNotes(result);
    } catch (e) { console.error("按标签查询笔记失败:", e); setTagNotes([]); }
    finally { setTagNotesLoading(false); }
  }, []);

  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    window.addEventListener("click", close);
    window.addEventListener("keydown", close);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("keydown", close);
    };
  }, [contextMenu]);

  const toAbsolutePath = useCallback((relativePath: string) => {
    const normalizedVault = vaultPath.replace(/[\\/]+$/, "");
    return `${normalizedVault}/${relativePath}`;
  }, [vaultPath]);

  const getParentRelativePath = useCallback((relativePath: string) => {
    const normalized = relativePath.replace(/\\/g, "/");
    const idx = normalized.lastIndexOf("/");
    return idx >= 0 ? normalized.slice(0, idx) : "";
  }, []);

  const copyPathToClipboard = useCallback(async (path: string) => {
    try {
      await navigator.clipboard.writeText(path);
    } catch (e) {
      console.error("复制路径失败:", e);
    }
  }, []);

  const handleTreeContextMenu = useCallback((e: MouseEvent, target: FileTreeContextTarget) => {
    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      target,
    });
  }, []);

  // Root-level drop (move to vault root)
  const [rootDragOver, setRootDragOver] = useState(false);
  const rootDragCountRef = useRef(0);

  const handleRootDragOver = useCallback((e: DragEvent) => {
    // Only handle if the event wasn't already consumed by a folder drop zone
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  }, []);

  const handleRootDragEnter = useCallback((e: DragEvent) => {
    e.preventDefault();
    rootDragCountRef.current++;
    if (rootDragCountRef.current === 1) {
      setRootDragOver(true);
    }
  }, []);

  const handleRootDragLeave = useCallback(() => {
    rootDragCountRef.current--;
    if (rootDragCountRef.current <= 0) {
      rootDragCountRef.current = 0;
      setRootDragOver(false);
    }
  }, []);

  const handleRootDrop = useCallback((e: DragEvent) => {
    e.preventDefault();
    rootDragCountRef.current = 0;
    setRootDragOver(false);
    const sourcePath = e.dataTransfer.getData("text/x-filetree-path");
    if (!sourcePath) return;
    // Already at root if no "/" in path
    if (!sourcePath.includes("/")) return;
    onMoveEntry(sourcePath, "");
  }, [onMoveEntry]);

  return (
    <aside
      className="flex flex-col select-none"
      style={{
        width: `${width}px`,
        minWidth: `${width}px`,
        background: "var(--sidebar-bg)",
        backdropFilter: "blur(40px) saturate(1.8)",
        WebkitBackdropFilter: "blur(40px) saturate(1.8)",
        margin: "10px 0 10px 10px",
        borderRadius: "16px",
        border: "0.5px solid rgba(255,255,255,0.06)",
        boxShadow: "inset 0 0.5px 0 rgba(255,255,255,0.05), 0 10px 24px rgba(0,0,0,0.2)",
        overflow: "hidden",
      }}
    >
      {/* Segmented Control — 目录 / 标签 */}
      <div className="px-3 pt-3 pb-2">
        <div className="flex items-center justify-end mb-2 relative">
          <button
            type="button"
            onClick={() => setNewMenuOpen(v => !v)}
            className="w-7 h-7 rounded-md text-[15px] cursor-pointer hover:bg-white/10 transition-colors"
            style={{ color: "rgba(255,255,255,0.78)" }}
            title="新建"
            aria-label="新建"
          >
            +
          </button>
          {newMenuOpen && (
            <div
              className="absolute top-8 right-0 z-20 rounded-lg p-1 min-w-[132px]"
              style={{ background: "rgba(14,14,14,0.96)", border: "1px solid rgba(255,255,255,0.08)" }}
            >
              <button
                type="button"
                onClick={() => {
                  setNewMenuOpen(false);
                  onCreateFile("note", "");
                }}
                className="w-full text-left px-2.5 py-1.5 text-[12px] rounded-md hover:bg-white/10"
                style={{ color: "rgba(255,255,255,0.9)" }}
              >
                新建笔记
              </button>
              <button
                type="button"
                onClick={() => {
                  setNewMenuOpen(false);
                  onCreateFile("canvas", "");
                }}
                className="w-full text-left px-2.5 py-1.5 text-[12px] rounded-md hover:bg-white/10"
                style={{ color: "rgba(255,255,255,0.9)" }}
              >
                新建画布
              </button>
              <button
                type="button"
                onClick={() => {
                  setNewMenuOpen(false);
                  onCreateFolder("");
                }}
                className="w-full text-left px-2.5 py-1.5 text-[12px] rounded-md hover:bg-white/10"
                style={{ color: "rgba(255,255,255,0.9)" }}
              >
                新建文件夹
              </button>
            </div>
          )}
        </div>
        <div className="flex p-[3px] rounded-[11px]"
          style={{ background: "rgba(118,118,128,0.12)" }}>
          {(["files", "tags"] as const).map(t => {
            const active = tab === t;
            return (
              <button key={t} onClick={() => setTab(t)}
                className="flex-1 px-2 py-[5px] rounded-[9px] text-[12px] font-medium
                  transition-all duration-250 cursor-pointer flex items-center justify-center gap-1.5"
                style={{
                  background: active ? "rgba(255,255,255,0.12)" : "transparent",
                  color: active ? "rgba(255,255,255,0.9)" : "rgba(255,255,255,0.35)",
                  boxShadow: active
                    ? "0 1px 4px rgba(0,0,0,0.25), 0 0.5px 1px rgba(0,0,0,0.15), inset 0 0.5px 0 rgba(255,255,255,0.06)"
                    : "none",
                }}>
                {t === "files" ? (
                  <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                    strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                  </svg>
                ) : (
                  <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                    strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" />
                    <line x1="7" y1="7" x2="7.01" y2="7" />
                  </svg>
                )}
                {t === "files" ? "目录" : "标签"}
                {t === "tags" && tags.length > 0 && (
                  <span className="text-[10px]" style={{ color: "rgba(255,255,255,0.2)" }}>{tags.length}</span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* 文件计数 */}
      {tab === "files" && notes.length > 0 && (
        <div className="px-4 pb-1">
          <span className="text-[11px] font-medium uppercase tracking-wider"
            style={{ color: "var(--text-quinary)" }}>
            文件 <span className="ml-1 normal-case tracking-normal">{notes.length}</span>
          </span>
        </div>
      )}

      {/* 内容区 */}
      <nav
        className="flex-1 overflow-y-auto px-2 pb-3 pt-1"
        onDragOver={handleRootDragOver}
        onDragEnter={handleRootDragEnter}
        onDragLeave={handleRootDragLeave}
        onDrop={handleRootDrop}
        style={rootDragOver ? { background: "rgba(10,132,255,0.06)" } : undefined}
      >
        {loading && (
          <div className="flex flex-col items-center py-12 gap-3">
            <div className="w-5 h-5 rounded-full border-[1.5px] animate-spin"
              style={{ borderColor: "rgba(255,255,255,0.06)", borderTopColor: "var(--accent)" }} />
            <p className="text-[11px]" style={{ color: "var(--text-quaternary)" }}>扫描中…</p>
          </div>
        )}

        {!loading && tab === "files" && (
          <>
            {notes.length === 0 && vaultPath && (
              <p className="text-[12px] text-center py-12" style={{ color: "var(--text-quaternary)" }}>
                未找到支持的文件
              </p>
            )}
            {fileTree.map((node, i) => (
              <FileTreeItem key={node.isFolder ? `d:${node.name}` : node.note?.id ?? i}
                node={node} depth={0} activeNoteId={activeNote?.id ?? null} onSelectNote={onSelectNote}
                onOpenContextMenu={handleTreeContextMenu}
                onMoveToFolder={onMoveEntry}
                onInlineRename={onInlineRenameEntry} />
            ))}
          </>
        )}

        {!loading && tab === "tags" && (
          <>
            {tags.length === 0 && (
              <div className="flex flex-col items-center py-16 gap-3">
                <div className="w-11 h-11 rounded-[13px] flex items-center justify-center"
                  style={{ background: "rgba(255,255,255,0.04)" }}>
                  <svg className="w-5 h-5" style={{ color: "rgba(255,255,255,0.1)" }}
                    viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"
                    strokeLinecap="round" strokeLinejoin="round">
                    <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" />
                    <line x1="7" y1="7" x2="7.01" y2="7" />
                  </svg>
                </div>
                <p className="text-[12px] text-center leading-relaxed max-w-[180px]"
                  style={{ color: "var(--text-quaternary)" }}>
                  在笔记中使用 #标签 或<br />Frontmatter tags 来组织内容
                </p>
              </div>
            )}
            {tagTree.map(node => (
              <TagTreeItem key={node.fullPath} node={node} depth={0}
                onSelectTag={handleSelectTag} selectedTag={selectedTag} />
            ))}
            {selectedTag && (
              <div className="mt-3 pt-3" style={{ borderTop: "0.5px solid rgba(255,255,255,0.05)" }}>
                <div className="px-2.5 pb-2 flex items-center gap-1.5">
                  <span className="text-[11px] font-medium" style={{ color: "var(--text-quaternary)" }}>
                    #{selectedTag}
                  </span>
                  {!tagNotesLoading && (
                    <span className="text-[10px]" style={{ color: "var(--text-quinary)" }}>{tagNotes.length}</span>
                  )}
                </div>
                {tagNotesLoading && (
                  <div className="flex items-center justify-center py-4">
                    <div className="w-4 h-4 rounded-full border-[1.5px] animate-spin"
                      style={{ borderColor: "rgba(255,255,255,0.06)", borderTopColor: "var(--accent)" }} />
                  </div>
                )}
                {!tagNotesLoading && tagNotes.map(note => {
                  const isActive = activeNote?.id === note.id;
                  return (
                    <button key={note.id} onClick={() => onSelectNote(note)}
                      className="w-full text-left px-3 py-[6px] rounded-[10px] text-[12px]
                        transition-all duration-150 cursor-pointer flex items-center gap-2 relative
                        hover:bg-white/[0.055]"
                      style={{ background: isActive ? "rgba(10,132,255,0.12)" : "transparent" }}>
                      {isActive && (
                        <div className="absolute left-[3px] top-1/2 -translate-y-1/2 w-[3px] h-[12px] rounded-full"
                          style={{ background: "var(--accent)" }} />
                      )}
                      <svg className="w-3.5 h-3.5 shrink-0"
                        style={{ color: isActive ? "rgba(255,255,255,0.7)" : "rgba(255,255,255,0.2)" }}
                        viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"
                        strokeLinecap="round" strokeLinejoin="round">
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                        <polyline points="14 2 14 8 20 8" />
                      </svg>
                      <span className="truncate" style={{
                        color: isActive ? "rgba(255,255,255,0.95)" : "rgba(255,255,255,0.55)",
                        fontWeight: isActive ? 500 : 400,
                      }}>{note.name}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </>
        )}
      </nav>

      {contextMenu && (
        <div
          className="fixed z-[100] min-w-[148px] rounded-lg p-1"
          style={{
            left: `${contextMenu.x}px`,
            top: `${contextMenu.y}px`,
            background: "rgba(12,12,12,0.98)",
            border: "1px solid rgba(255,255,255,0.1)",
            boxShadow: "0 10px 28px rgba(0,0,0,0.35)",
          }}
          onClick={e => e.stopPropagation()}
        >
          {!contextMenu.target.isFolder && contextMenu.target.note && (
            <button
              type="button"
              className="w-full text-left px-2.5 py-1.5 rounded-md text-[12px] hover:bg-white/10"
              style={{ color: "rgba(255,255,255,0.9)" }}
              onClick={() => {
                onSelectNote(contextMenu.target.note!);
                setContextMenu(null);
              }}
            >
              打开
            </button>
          )}
          <button
            type="button"
            className="w-full text-left px-2.5 py-1.5 rounded-md text-[12px] hover:bg-white/10"
            style={{ color: "rgba(255,255,255,0.9)" }}
            onClick={() => {
              onRenameEntry(
                contextMenu.target.relativePath,
                contextMenu.target.note
                  ? contextMenu.target.note.id.replace(/\\/g, "/").split("/").pop() ?? contextMenu.target.label
                  : contextMenu.target.label,
                contextMenu.target.isFolder
              );
              setContextMenu(null);
            }}
          >
            重命名
          </button>
          {contextMenu.target.isFolder ? (
            <>
              <button
                type="button"
                className="w-full text-left px-2.5 py-1.5 rounded-md text-[12px] hover:bg-white/10"
                style={{ color: "rgba(255,255,255,0.9)" }}
                onClick={() => {
                  onCreateFile("note", contextMenu.target.relativePath);
                  setContextMenu(null);
                }}
              >
                在此新建笔记
              </button>
              <button
                type="button"
                className="w-full text-left px-2.5 py-1.5 rounded-md text-[12px] hover:bg-white/10"
                style={{ color: "rgba(255,255,255,0.9)" }}
                onClick={() => {
                  onCreateFile("canvas", contextMenu.target.relativePath);
                  setContextMenu(null);
                }}
              >
                在此新建画布
              </button>
              <button
                type="button"
                className="w-full text-left px-2.5 py-1.5 rounded-md text-[12px] hover:bg-white/10"
                style={{ color: "rgba(255,255,255,0.9)" }}
                onClick={() => {
                  onCreateFolder(contextMenu.target.relativePath);
                  setContextMenu(null);
                }}
              >
                在此新建文件夹
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                className="w-full text-left px-2.5 py-1.5 rounded-md text-[12px] hover:bg-white/10"
                style={{ color: "rgba(255,255,255,0.9)" }}
                onClick={() => {
                  const parent = getParentRelativePath(contextMenu.target.relativePath);
                  onCreateFile("note", parent);
                  setContextMenu(null);
                }}
              >
                同级新建笔记
              </button>
              <button
                type="button"
                className="w-full text-left px-2.5 py-1.5 rounded-md text-[12px] hover:bg-white/10"
                style={{ color: "rgba(255,255,255,0.9)" }}
                onClick={() => {
                  const parent = getParentRelativePath(contextMenu.target.relativePath);
                  onCreateFile("canvas", parent);
                  setContextMenu(null);
                }}
              >
                同级新建画布
              </button>
              <button
                type="button"
                className="w-full text-left px-2.5 py-1.5 rounded-md text-[12px] hover:bg-white/10"
                style={{ color: "rgba(255,255,255,0.9)" }}
                onClick={() => {
                  const parent = getParentRelativePath(contextMenu.target.relativePath);
                  onCreateFolder(parent);
                  setContextMenu(null);
                }}
              >
                同级新建文件夹
              </button>
            </>
          )}
          <button
            type="button"
            className="w-full text-left px-2.5 py-1.5 rounded-md text-[12px] hover:bg-white/10"
            style={{ color: "rgba(255,255,255,0.9)" }}
            onClick={() => {
              const absolute = contextMenu.target.note?.path ?? toAbsolutePath(contextMenu.target.relativePath);
              void copyPathToClipboard(absolute);
              setContextMenu(null);
            }}
          >
            复制路径
          </button>
          {contextMenu.target.relativePath.includes("/") && (
            <button
              type="button"
              className="w-full text-left px-2.5 py-1.5 rounded-md text-[12px] hover:bg-white/10"
              style={{ color: "rgba(255,255,255,0.9)" }}
              onClick={() => {
                onMoveEntry(contextMenu.target.relativePath, "");
                setContextMenu(null);
              }}
            >
              移动到根目录
            </button>
          )}
          <div className="my-1 h-px" style={{ background: "rgba(255,255,255,0.08)" }} />
          <button
            type="button"
            className="w-full text-left px-2.5 py-1.5 rounded-md text-[12px] hover:bg-white/10"
            style={{ color: "rgba(255,75,75,0.95)" }}
            onClick={() => {
              const absolute = contextMenu.target.note?.path ?? toAbsolutePath(contextMenu.target.relativePath);
              onDeleteEntry(absolute, contextMenu.target.label, contextMenu.target.isFolder);
              setContextMenu(null);
            }}
          >
            删除{contextMenu.target.isFolder ? "文件夹" : "文件"}
          </button>
        </div>
      )}
    </aside>
  );
}
