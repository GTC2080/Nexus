import { createPortal } from "react-dom";
import { useRef, type RefObject } from "react";
import type { NoteInfo } from "../../types";
import { useT } from "../../i18n";
import type { FileTreeContextTarget } from "./FileTree";

export interface FileTreeContextMenuState {
  x: number;
  y: number;
  target: FileTreeContextTarget;
}

interface FileTreeContextMenuProps {
  menu: FileTreeContextMenuState | null;
  vaultPath: string;
  onClose: () => void;
  onSelectNote: (note: NoteInfo) => void;
  onCreateFile: (kind: "note" | "mol" | "paper", targetFolderRelativePath?: string) => void;
  onCreateFolder: (targetParentRelativePath?: string) => void;
  onDeleteEntry: (absolutePath: string, targetLabel: string, isFolder: boolean) => void;
  onMoveEntry: (sourceRelativePath: string, destFolderRelativePath: string) => void;
  onRenameEntry: (sourceRelativePath: string, currentFullName: string, isFolder: boolean) => void;
  onCopyPath: (path: string) => void;
  contextMenuRef: RefObject<HTMLDivElement | null>;
}

function toAbsolutePath(vaultPath: string, relativePath: string): string {
  const normalizedVault = vaultPath.replace(/[\\/]+$/, "");
  return `${normalizedVault}/${relativePath}`;
}

function getParentRelativePath(relativePath: string): string {
  const normalized = relativePath.replace(/\\/g, "/");
  const idx = normalized.lastIndexOf("/");
  return idx >= 0 ? normalized.slice(0, idx) : "";
}

function currentTargetName(target: FileTreeContextTarget): string {
  if (!target.note) return target.label;
  return target.note.id.replace(/\\/g, "/").split("/").pop() ?? target.label;
}

export default function FileTreeContextMenu({
  menu,
  vaultPath,
  onClose,
  onSelectNote,
  onCreateFile,
  onCreateFolder,
  onDeleteEntry,
  onMoveEntry,
  onRenameEntry,
  onCopyPath,
  contextMenuRef,
}: FileTreeContextMenuProps) {
  const t = useT();
  const localRef = useRef<HTMLDivElement | null>(null);
  const menuRef = contextMenuRef ?? localRef;

  if (!menu) return null;

  return createPortal(
    <>
      <div
        className="fixed inset-0 z-[9999]"
        style={{ background: "transparent" }}
        onPointerDown={onClose}
        onContextMenu={e => {
          e.preventDefault();
          onClose();
        }}
      />
      <div
        ref={menuRef}
        className="fixed z-[10000] w-[220px] rounded-lg p-1"
        style={{
          left: `${Math.max(8, Math.min(menu.x, window.innerWidth - 220))}px`,
          top: `${Math.max(8, Math.min(menu.y, window.innerHeight - 360))}px`,
          background: "var(--menu-bg)",
          border: "1px solid var(--separator-light)",
          boxShadow: "0 10px 28px rgba(0,0,0,0.35)",
        }}
        onClick={e => e.stopPropagation()}
      >
        {!menu.target.isFolder && menu.target.note && (
          <button
            type="button"
            className="w-full text-left px-2.5 py-1.5 rounded-md text-[12px] leading-5 transition-colors"
            style={{ color: "var(--text-secondary)" }}
            onMouseEnter={e => { e.currentTarget.style.background = "var(--menu-hover)"; }}
            onMouseLeave={e => { e.currentTarget.style.background = "transparent"; }}
            onClick={() => {
              onSelectNote(menu.target.note!);
              onClose();
            }}
          >
            {t("fileTree.open")}
          </button>
        )}
        {menu.target.relativePath !== "" && (
          <button
            type="button"
            className="w-full text-left px-2.5 py-1.5 rounded-md text-[12px] leading-5 transition-colors"
            style={{ color: "var(--text-secondary)" }}
            onMouseEnter={e => { e.currentTarget.style.background = "var(--menu-hover)"; }}
            onMouseLeave={e => { e.currentTarget.style.background = "transparent"; }}
            onClick={() => {
              onRenameEntry(
                menu.target.relativePath,
                currentTargetName(menu.target),
                menu.target.isFolder
              );
              onClose();
            }}
          >
            {t("fileTree.rename")}
          </button>
        )}
        {menu.target.isFolder ? (
          <>
            <button
              type="button"
              className="w-full text-left px-2.5 py-1.5 rounded-md text-[12px] leading-5 transition-colors"
              style={{ color: "var(--text-secondary)" }}
              onMouseEnter={e => { e.currentTarget.style.background = "var(--menu-hover)"; }}
              onMouseLeave={e => { e.currentTarget.style.background = "transparent"; }}
              onClick={() => {
                onCreateFile("note", menu.target.relativePath);
                onClose();
              }}
            >
              {t("fileTree.newNoteHere")}
            </button>
            <button
              type="button"
              className="w-full text-left px-2.5 py-1.5 rounded-md text-[12px] leading-5 transition-colors"
              style={{ color: "var(--text-secondary)" }}
              onMouseEnter={e => { e.currentTarget.style.background = "var(--menu-hover)"; }}
              onMouseLeave={e => { e.currentTarget.style.background = "transparent"; }}
              onClick={() => {
                onCreateFile("mol", menu.target.relativePath);
                onClose();
              }}
            >
              {t("fileTree.newMolHere")}
            </button>
            <button
              type="button"
              className="w-full text-left px-2.5 py-1.5 rounded-md text-[12px] leading-5 transition-colors"
              style={{ color: "var(--text-secondary)" }}
              onMouseEnter={e => { e.currentTarget.style.background = "var(--menu-hover)"; }}
              onMouseLeave={e => { e.currentTarget.style.background = "transparent"; }}
              onClick={() => {
                onCreateFile("paper", menu.target.relativePath);
                onClose();
              }}
            >
              {t("fileTree.newPaperHere")}
            </button>
            <button
              type="button"
              className="w-full text-left px-2.5 py-1.5 rounded-md text-[12px] leading-5 transition-colors"
              style={{ color: "var(--text-secondary)" }}
              onMouseEnter={e => { e.currentTarget.style.background = "var(--menu-hover)"; }}
              onMouseLeave={e => { e.currentTarget.style.background = "transparent"; }}
              onClick={() => {
                onCreateFolder(menu.target.relativePath);
                onClose();
              }}
            >
              {t("fileTree.newFolderHere")}
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              className="w-full text-left px-2.5 py-1.5 rounded-md text-[12px] leading-5 transition-colors"
              style={{ color: "var(--text-secondary)" }}
              onMouseEnter={e => { e.currentTarget.style.background = "var(--menu-hover)"; }}
              onMouseLeave={e => { e.currentTarget.style.background = "transparent"; }}
              onClick={() => {
                const parent = getParentRelativePath(menu.target.relativePath);
                onCreateFile("note", parent);
                onClose();
              }}
            >
              {t("fileTree.newNoteSibling")}
            </button>
            <button
              type="button"
              className="w-full text-left px-2.5 py-1.5 rounded-md text-[12px] leading-5 transition-colors"
              style={{ color: "var(--text-secondary)" }}
              onMouseEnter={e => { e.currentTarget.style.background = "var(--menu-hover)"; }}
              onMouseLeave={e => { e.currentTarget.style.background = "transparent"; }}
              onClick={() => {
                const parent = getParentRelativePath(menu.target.relativePath);
                onCreateFile("mol", parent);
                onClose();
              }}
            >
              {t("fileTree.newMolSibling")}
            </button>
            <button
              type="button"
              className="w-full text-left px-2.5 py-1.5 rounded-md text-[12px] leading-5 transition-colors"
              style={{ color: "var(--text-secondary)" }}
              onMouseEnter={e => { e.currentTarget.style.background = "var(--menu-hover)"; }}
              onMouseLeave={e => { e.currentTarget.style.background = "transparent"; }}
              onClick={() => {
                const parent = getParentRelativePath(menu.target.relativePath);
                onCreateFile("paper", parent);
                onClose();
              }}
            >
              {t("fileTree.newPaperSibling")}
            </button>
            <button
              type="button"
              className="w-full text-left px-2.5 py-1.5 rounded-md text-[12px] leading-5 transition-colors"
              style={{ color: "var(--text-secondary)" }}
              onMouseEnter={e => { e.currentTarget.style.background = "var(--menu-hover)"; }}
              onMouseLeave={e => { e.currentTarget.style.background = "transparent"; }}
              onClick={() => {
                const parent = getParentRelativePath(menu.target.relativePath);
                onCreateFolder(parent);
                onClose();
              }}
            >
              {t("fileTree.newFolderSibling")}
            </button>
          </>
        )}
        <button
          type="button"
          className="w-full text-left px-2.5 py-1.5 rounded-md text-[12px] leading-5 transition-colors"
          style={{ color: "var(--text-secondary)" }}
          onMouseEnter={e => { e.currentTarget.style.background = "var(--menu-hover)"; }}
          onMouseLeave={e => { e.currentTarget.style.background = "transparent"; }}
          onClick={() => {
            const absolute = menu.target.note?.path ?? toAbsolutePath(vaultPath, menu.target.relativePath);
            onCopyPath(absolute);
            onClose();
          }}
        >
          {t("fileTree.copyPath")}
        </button>
        {menu.target.relativePath.includes("/") && (
          <button
            type="button"
            className="w-full text-left px-2.5 py-1.5 rounded-md text-[12px] leading-5 transition-colors"
            style={{ color: "var(--text-secondary)" }}
            onMouseEnter={e => { e.currentTarget.style.background = "var(--menu-hover)"; }}
            onMouseLeave={e => { e.currentTarget.style.background = "transparent"; }}
            onClick={() => {
              onMoveEntry(menu.target.relativePath, "");
              onClose();
            }}
          >
            {t("fileTree.moveToRoot")}
          </button>
        )}
        {menu.target.relativePath !== "" && (
          <>
            <div className="my-1 h-px" style={{ background: "var(--separator-light)" }} />
            <button
              type="button"
              className="w-full text-left px-2.5 py-1.5 rounded-md text-[12px] leading-5 transition-colors"
              style={{ color: "rgba(255,75,75,0.95)" }}
              onMouseEnter={e => { e.currentTarget.style.background = "var(--menu-hover)"; }}
              onMouseLeave={e => { e.currentTarget.style.background = "transparent"; }}
              onClick={() => {
                const absolute = menu.target.note?.path ?? toAbsolutePath(vaultPath, menu.target.relativePath);
                onDeleteEntry(absolute, menu.target.label, menu.target.isFolder);
                onClose();
              }}
            >
              {menu.target.isFolder ? t("fileTree.deleteFolder") : t("fileTree.deleteFile")}
            </button>
          </>
        )}
      </div>
    </>,
    document.body
  );
}
