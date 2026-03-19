import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { NoteInfo } from "../types";

interface UseVaultIndexOptions {
  vaultPath: string;
  ignoredFolders: string;
  activeNote: NoteInfo | null;
  onActiveNoteMissing: () => void;
}

async function scanVaultNotes(vaultPath: string, ignoredFolders: string) {
  return invoke<NoteInfo[]>("scan_vault", {
    vaultPath,
    ignoredFolders: ignoredFolders || "",
  });
}

export function useVaultIndex({
  vaultPath,
  ignoredFolders,
  activeNote,
  onActiveNoteMissing,
}: UseVaultIndexOptions) {
  const [notes, setNotes] = useState<NoteInfo[]>([]);
  const activeNoteRef = useRef<NoteInfo | null>(activeNote);

  useEffect(() => {
    activeNoteRef.current = activeNote;
  }, [activeNote]);

  const refreshNotes = useCallback(async (targetVaultPath = vaultPath) => {
    if (!targetVaultPath) {
      setNotes([]);
      return [];
    }

    const refreshed = await scanVaultNotes(targetVaultPath, ignoredFolders);
    setNotes(refreshed);

    const currentActiveNote = activeNoteRef.current;
    if (currentActiveNote && !refreshed.some(note => note.id === currentActiveNote.id)) {
      onActiveNoteMissing();
    }

    return refreshed;
  }, [ignoredFolders, onActiveNoteMissing, vaultPath]);

  // 统一入口：初始加载 + 依赖变更时触发一次 scan（修复之前的双重调用 bug）
  useEffect(() => {
    if (!vaultPath) {
      setNotes([]);
      return;
    }

    let cancelled = false;
    scanVaultNotes(vaultPath, ignoredFolders)
      .then(refreshed => {
        if (cancelled) return;
        setNotes(refreshed);
        const currentActiveNote = activeNoteRef.current;
        if (currentActiveNote && !refreshed.some(note => note.id === currentActiveNote.id)) {
          onActiveNoteMissing();
        }
      })
      .catch(() => {
        // Keep current UI state
      });

    return () => { cancelled = true; };
  }, [vaultPath, ignoredFolders, onActiveNoteMissing]);

  return {
    notes,
    setNotes,
    refreshNotes,
  };
}
