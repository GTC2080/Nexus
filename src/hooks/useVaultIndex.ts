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

  useEffect(() => {
    if (!vaultPath) {
      setNotes([]);
      return;
    }

    let cancelled = false;

    const rescanWithIgnoredFolders = async () => {
      try {
        const refreshed = await scanVaultNotes(vaultPath, ignoredFolders);
        if (cancelled) {
          return;
        }
        setNotes(refreshed);

        const currentActiveNote = activeNoteRef.current;
        if (currentActiveNote && !refreshed.some(note => note.id === currentActiveNote.id)) {
          onActiveNoteMissing();
        }
      } catch {
        // Keep current UI state; user can still refresh via other actions.
      }
    };

    void rescanWithIgnoredFolders();

    return () => {
      cancelled = true;
    };
  }, [ignoredFolders, onActiveNoteMissing, vaultPath]);

  return {
    notes,
    setNotes,
    refreshNotes,
  };
}
