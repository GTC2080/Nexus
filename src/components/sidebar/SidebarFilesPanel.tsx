import type { MouseEvent as ReactMouseEvent } from "react";
import type { FileTreeNode, NoteInfo } from "../../types";
import { useT } from "../../i18n";
import { FileTreeItem, type FileTreeContextTarget } from "./FileTree";

interface SidebarFilesPanelProps {
  loading: boolean;
  notes: NoteInfo[];
  vaultPath: string;
  fileTree: FileTreeNode[];
  activeNoteId: string | null;
  onSelectNote: (note: NoteInfo) => void;
  onOpenContextMenu: (e: ReactMouseEvent, target: FileTreeContextTarget) => void;
  onMoveEntry: (sourceRelativePath: string, destFolderRelativePath: string) => void;
  onInlineRenameEntry: (sourceRelativePath: string, newName: string) => void;
}

export default function SidebarFilesPanel({
  loading,
  notes,
  vaultPath,
  fileTree,
  activeNoteId,
  onSelectNote,
  onOpenContextMenu,
  onMoveEntry,
  onInlineRenameEntry,
}: SidebarFilesPanelProps) {
  const t = useT();
  if (loading) {
    return (
      <div className="flex flex-col items-center py-12 gap-3">
        <div
          className="w-5 h-5 rounded-full border-[1.5px] animate-spin"
          style={{ borderColor: "rgba(255,255,255,0.06)", borderTopColor: "var(--accent)" }}
        />
        <p className="text-[11px]" style={{ color: "var(--text-quaternary)" }}>{t("sidebar.scanning")}</p>
      </div>
    );
  }

  return (
    <>
      {notes.length === 0 && vaultPath && (
        <p className="text-[12px] text-center py-12" style={{ color: "var(--text-quaternary)" }}>
          {t("sidebar.noFiles")}
        </p>
      )}
      {fileTree.map((node, i) => (
        <FileTreeItem
          key={node.isFolder ? `d:${node.name}` : node.note?.id ?? i}
          node={node}
          depth={0}
          activeNoteId={activeNoteId}
          onSelectNote={onSelectNote}
          onOpenContextMenu={onOpenContextMenu}
          onMoveToFolder={onMoveEntry}
          onInlineRename={onInlineRenameEntry}
        />
      ))}
    </>
  );
}
