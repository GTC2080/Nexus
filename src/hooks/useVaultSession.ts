import { useCallback, useState, useTransition } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import type { DisciplineProfile } from "../components/settings/settingsTypes";
import type { MolecularPreviewMeta, NoteInfo } from "../types";
import { useActiveNoteContent } from "./useActiveNoteContent";
import { useNotePersistence } from "./useNotePersistence";
import { useVaultIndex } from "./useVaultIndex";

interface UseVaultSessionOptions {
  ignoredFolders: string;
  activeDiscipline: DisciplineProfile;
  onSaveToRecent: (path: string) => Promise<void>;
}

export function useVaultSession({
  ignoredFolders,
  activeDiscipline,
  onSaveToRecent,
}: UseVaultSessionOptions) {
  const [vaultPath, setVaultPath] = useState("");
  const [activeNote, setActiveNote] = useState<NoteInfo | null>(null);
  const [error, setError] = useState("");
  const [loading, startLoadingTransition] = useTransition();

  const clearActiveSelection = useCallback(() => {
    setActiveNote(null);
  }, []);

  const {
    notes,
    setNotes,
    refreshNotes,
  } = useVaultIndex({
    vaultPath,
    ignoredFolders,
    activeNote,
    onActiveNoteMissing: clearActiveSelection,
  });

  const {
    noteContent,
    setNoteContent,
    liveContent,
    setLiveContent,
    molecularPreview,
    binaryPreviewUrl,
    resetContent,
  } = useActiveNoteContent({
    activeNote,
    activeDiscipline,
  });

  const { enqueueSave, flushPendingSave } = useNotePersistence({
    onError: setError,
  });

  const openVaultByPath = useCallback(async (path: string) => {
    try {
      await flushPendingSave();
      setError("");
      setVaultPath(path);
      setActiveNote(null);
      resetContent();

      startLoadingTransition(async () => {
        try {
          await invoke("init_vault", { vaultPath: path });
          await refreshNotes(path);
          await onSaveToRecent(path);
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : String(cause));
        }
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [flushPendingSave, onSaveToRecent, refreshNotes, resetContent]);

  const handleOpenVault = useCallback(async () => {
    try {
      setError("");
      const selected = await open({ directory: true, multiple: false });
      if (!selected) {
        return;
      }
      await openVaultByPath(selected);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [openVaultByPath]);

  const handleSelectNote = useCallback(async (note: NoteInfo) => {
    try {
      await flushPendingSave();
      setError("");
      setActiveNote(note);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setActiveNote(note);
    }
  }, [flushPendingSave]);

  const handleBackToManager = useCallback(async () => {
    await flushPendingSave();
    setVaultPath("");
    setNotes([]);
    setActiveNote(null);
    resetContent();
    setError("");
  }, [flushPendingSave, resetContent, setNotes]);

  const handleSave = useCallback(async (markdown: string) => {
    if (!activeNote || !vaultPath) {
      return;
    }
    enqueueSave(vaultPath, activeNote.path, markdown);
  }, [activeNote, enqueueSave, vaultPath]);

  return {
    vaultPath,
    notes,
    activeNote,
    noteContent,
    liveContent,
    molecularPreview: molecularPreview as MolecularPreviewMeta | null,
    binaryPreviewUrl,
    error,
    loading,
    setNotes,
    setActiveNote,
    setNoteContent,
    setLiveContent,
    setError,
    openVaultByPath,
    handleOpenVault,
    handleSelectNote,
    handleBackToManager,
    handleSave,
    flushPendingSave,
  };
}
