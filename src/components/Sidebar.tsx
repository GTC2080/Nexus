import { useState, useEffect, useCallback, useRef } from "react";
import { useT } from "../i18n";
import type { MouseEvent as ReactMouseEvent, DragEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { FileTreeNode, NoteInfo } from "../types";
import { type FileTreeContextTarget } from "./sidebar/FileTree";
import { useSidebarTags } from "../hooks/useSidebarTags";
import FileTreeContextMenu, { type FileTreeContextMenuState } from "./sidebar/FileTreeContextMenu";
import SidebarHeader from "./sidebar/SidebarHeader";
import SidebarFilesPanel from "./sidebar/SidebarFilesPanel";
import SidebarTagsPanel from "./sidebar/SidebarTagsPanel";

interface SidebarProps {
  vaultPath: string;
  notes: NoteInfo[];
  activeNote: NoteInfo | null;
  loading: boolean;
  width: number;
  onSelectNote: (note: NoteInfo) => void;
  onCreateFile: (kind: "note" | "mol" | "paper", targetFolderRelativePath?: string) => void;
  onDeleteEntry: (absolutePath: string, targetLabel: string, isFolder: boolean) => void;
  onMoveEntry: (sourceRelativePath: string, destFolderRelativePath: string) => void;
  onRenameEntry: (sourceRelativePath: string, currentFullName: string, isFolder: boolean) => void;
  onInlineRenameEntry: (sourceRelativePath: string, newName: string) => void;
  onCreateFolder: (targetParentRelativePath?: string) => void;
}

/** 文件树面板 — 纯内容，无工具按钮 */
export default function Sidebar({
  vaultPath,
  notes,
  activeNote,
  loading,
  width,
  onSelectNote,
  onCreateFile,
  onDeleteEntry,
  onMoveEntry,
  onRenameEntry,
  onInlineRenameEntry,
  onCreateFolder,
}: SidebarProps) {
  const t = useT();
  const [tab, setTab] = useState<"files" | "tags">("files");
  const [newMenuOpen, setNewMenuOpen] = useState(false);
  const [contextMenu, setContextMenu] = useState<FileTreeContextMenuState | null>(null);
  const contextMenuRef = useRef<HTMLDivElement | null>(null);
  const [fileTree, setFileTree] = useState<FileTreeNode[]>([]);

  const { tags, tagTree, selectedTag, tagNotes, tagNotesPending, handleSelectTag } =
    useSidebarTags({ vaultPath, notes, tab });

  useEffect(() => {
    let cancelled = false;
    invoke<FileTreeNode[]>("build_file_tree", { notes })
      .then(tree => {
        if (!cancelled) setFileTree(tree);
      })
      .catch(e => {
        console.error("构建文件树失败:", e);
        if (!cancelled) setFileTree([]);
      });
    return () => {
      cancelled = true;
    };
  }, [notes]);

  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    const handlePointerDownCapture = (e: Event) => {
      const menuEl = contextMenuRef.current;
      if (!menuEl) {
        close();
        return;
      }
      if (!menuEl.contains(e.target as Node)) {
        close();
      }
    };
    const handleContextMenuCapture = (e: Event) => {
      const menuEl = contextMenuRef.current;
      if (!menuEl) {
        close();
        return;
      }
      if (!menuEl.contains(e.target as Node)) {
        close();
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    const handleScroll = () => close();

    document.addEventListener("pointerdown", handlePointerDownCapture, true);
    document.addEventListener("contextmenu", handleContextMenuCapture, true);
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("wheel", handleScroll, { passive: true });
    window.addEventListener("resize", handleScroll);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDownCapture, true);
      document.removeEventListener("contextmenu", handleContextMenuCapture, true);
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("wheel", handleScroll);
      window.removeEventListener("resize", handleScroll);
    };
  }, [contextMenu]);

  const copyPathToClipboard = useCallback(async (path: string) => {
    try {
      await navigator.clipboard.writeText(path);
    } catch (e) {
      console.error("复制路径失败:", e);
    }
  }, []);

  const handleTreeContextMenu = useCallback((e: ReactMouseEvent, target: FileTreeContextTarget) => {
    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      target,
    });
  }, []);

  const [rootDragOver, setRootDragOver] = useState(false);
  const rootDragCountRef = useRef(0);

  const handleRootDragOver = useCallback((e: DragEvent) => {
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
    if (!sourcePath.includes("/")) return;
    onMoveEntry(sourcePath, "");
  }, [onMoveEntry]);

  return (
    <aside
      className="flex flex-col select-none workspace-panel"
      style={{
        width: `${width}px`,
        minWidth: `${width}px`,
        margin: "0",
        borderLeft: "none",
        borderRight: "0.5px solid var(--panel-border)",
        overflow: "hidden",
      }}
    >
      <SidebarHeader
        vaultPath={vaultPath}
        tab={tab}
        tagsCount={tags.length}
        newMenuOpen={newMenuOpen}
        onToggleNewMenu={() => setNewMenuOpen(v => !v)}
        onSelectTab={next => {
          setTab(next);
          setNewMenuOpen(false);
        }}
        onCreateFile={(kind, targetFolderRelativePath) => {
          setNewMenuOpen(false);
          onCreateFile(kind, targetFolderRelativePath);
        }}
        onCreateFolder={targetParentRelativePath => {
          setNewMenuOpen(false);
          onCreateFolder(targetParentRelativePath);
        }}
      />

      {tab === "files" && notes.length > 0 && (
        <div className="px-4 pb-1">
          <span className="text-[11px] font-medium uppercase tracking-wider" style={{ color: "var(--text-quinary)" }}>
            {t("sidebar.filesCount")} <span className="ml-1 normal-case tracking-normal">{notes.length}</span>
          </span>
        </div>
      )}

      <nav
        className="flex-1 overflow-y-auto px-2 pb-3 pt-1"
        onDragOver={handleRootDragOver}
        onDragEnter={handleRootDragEnter}
        onDragLeave={handleRootDragLeave}
        onDrop={handleRootDrop}
        onContextMenu={e => {
          if (tab !== "files") return;
          // Only trigger when clicking directly on the nav (blank area), not on child elements
          if (e.target === e.currentTarget) {
            e.preventDefault();
            handleTreeContextMenu(e, {
              isFolder: true,
              label: "",
              relativePath: "",
              note: null,
            });
          }
        }}
        style={rootDragOver ? { background: "var(--accent-soft)" } : undefined}
      >
        {tab === "files" ? (
          <SidebarFilesPanel
            loading={loading}
            notes={notes}
            vaultPath={vaultPath}
            fileTree={fileTree}
            activeNoteId={activeNote?.id ?? null}
            onSelectNote={onSelectNote}
            onOpenContextMenu={handleTreeContextMenu}
            onMoveEntry={onMoveEntry}
            onInlineRenameEntry={onInlineRenameEntry}
          />
        ) : (
          !loading && (
            <SidebarTagsPanel
              tagsCount={tags.length}
              tagTree={tagTree}
              selectedTag={selectedTag}
              tagNotes={tagNotes}
              tagNotesLoading={tagNotesPending}
              activeNoteId={activeNote?.id ?? null}
              onSelectTag={handleSelectTag}
              onSelectNote={onSelectNote}
            />
          )
        )}
      </nav>

      <FileTreeContextMenu
        menu={contextMenu}
        vaultPath={vaultPath}
        onClose={() => setContextMenu(null)}
        onSelectNote={onSelectNote}
        onCreateFile={onCreateFile}
        onCreateFolder={onCreateFolder}
        onDeleteEntry={onDeleteEntry}
        onMoveEntry={onMoveEntry}
        onRenameEntry={onRenameEntry}
        onCopyPath={path => {
          void copyPathToClipboard(path);
        }}
        contextMenuRef={contextMenuRef}
      />
    </aside>
  );
}
