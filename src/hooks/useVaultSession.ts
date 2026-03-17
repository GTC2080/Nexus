import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import type { DisciplineProfile } from "../components/settings/settingsTypes";
import type { MolecularPreviewMeta, NoteInfo } from "../types";
import { getFileCategory } from "../types";

interface UseVaultSessionOptions {
  ignoredFolders: string;
  activeDiscipline: DisciplineProfile;
  onSaveToRecent: (path: string) => Promise<void>;
}

function mimeFromExtension(ext: string): string {
  const lower = ext.toLowerCase();
  if (lower === "pdf") return "application/pdf";
  if (lower === "png") return "image/png";
  if (lower === "jpg" || lower === "jpeg") return "image/jpeg";
  if (lower === "gif") return "image/gif";
  if (lower === "svg") return "image/svg+xml";
  if (lower === "webp") return "image/webp";
  if (lower === "bmp") return "image/bmp";
  if (lower === "ico") return "image/x-icon";
  return "application/octet-stream";
}

export function useVaultSession({ ignoredFolders, activeDiscipline, onSaveToRecent }: UseVaultSessionOptions) {
  const [vaultPath, setVaultPath] = useState<string>("");
  const [notes, setNotes] = useState<NoteInfo[]>([]);
  const [activeNote, setActiveNote] = useState<NoteInfo | null>(null);
  const [noteContent, setNoteContent] = useState<string>("");
  const [liveContent, setLiveContent] = useState<string>("");
  const [molecularPreview, setMolecularPreview] = useState<MolecularPreviewMeta | null>(null);
  const [binaryPreviewUrl, setBinaryPreviewUrl] = useState<string>("");
  const [error, setError] = useState<string>("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!vaultPath) return;
    let cancelled = false;
    const rescanWithIgnoredFolders = async () => {
      try {
        const refreshed = await invoke<NoteInfo[]>("scan_vault", {
          vaultPath,
          ignoredFolders: ignoredFolders || "",
        });
        if (cancelled) return;
        setNotes(refreshed);
        if (activeNote && !refreshed.some(note => note.id === activeNote.id)) {
          setActiveNote(null);
          setNoteContent("");
          setLiveContent("");
        }
      } catch {
        // keep current UI; manual refresh still available
      }
    };
    void rescanWithIgnoredFolders();
    return () => {
      cancelled = true;
    };
  }, [ignoredFolders, vaultPath, activeNote]);

  useEffect(() => {
    if (!activeNote) return;
    if (getFileCategory(activeNote.file_extension) !== "molecular") return;
    let cancelled = false;
    const syncMolecularContentForDiscipline = async () => {
      try {
        if (activeDiscipline === "chemistry") {
          const preview = await invoke<{
            preview_data: string;
            atom_count: number;
            preview_atom_count: number;
            truncated: boolean;
          }>("read_molecular_preview", {
            filePath: activeNote.path,
            maxAtoms: 2000,
          });
          if (cancelled) return;
          setNoteContent(preview.preview_data);
          setLiveContent(preview.preview_data);
          setMolecularPreview({
            atom_count: preview.atom_count,
            preview_atom_count: preview.preview_atom_count,
            truncated: preview.truncated,
          });
          return;
        }

        const content = await invoke<string>("read_note", { filePath: activeNote.path });
        if (cancelled) return;
        setNoteContent(content);
        setLiveContent(content);
        setMolecularPreview(null);
      } catch {
        // keep current content on discipline-switch load failure
      }
    };
    void syncMolecularContentForDiscipline();
    return () => {
      cancelled = true;
    };
  }, [activeDiscipline, activeNote]);

  useEffect(() => {
    return () => {
      if (binaryPreviewUrl) {
        URL.revokeObjectURL(binaryPreviewUrl);
      }
    };
  }, [binaryPreviewUrl]);

  const openVaultByPath = useCallback(async (path: string) => {
    try {
      setError("");
      setVaultPath(path);
      setLoading(true);
      setActiveNote(null);
      setNoteContent("");
      setLiveContent("");
      await invoke("init_vault", { vaultPath: path });
      const result = await invoke<NoteInfo[]>("scan_vault", {
        vaultPath: path,
        ignoredFolders: ignoredFolders || "",
      });
      setNotes(result);
      await onSaveToRecent(path);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [ignoredFolders, onSaveToRecent]);

  const handleOpenVault = useCallback(async () => {
    try {
      setError("");
      const selected = await open({ directory: true, multiple: false });
      if (!selected) return;
      await openVaultByPath(selected);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [openVaultByPath]);

  const handleSelectNote = useCallback(async (note: NoteInfo) => {
    try {
      setError("");
      setActiveNote(note);
      setMolecularPreview(null);
      if (binaryPreviewUrl) {
        URL.revokeObjectURL(binaryPreviewUrl);
        setBinaryPreviewUrl("");
      }
      const category = getFileCategory(note.file_extension);
      if (category === "image" || category === "pdf") {
        setNoteContent("");
        if (category === "pdf") {
          try {
            const indexed = await invoke<string>("read_note_indexed_content", { noteId: note.id });
            setLiveContent(indexed);
          } catch {
            setLiveContent("");
          }
        } else {
          setLiveContent("");
        }
        const bytes = await invoke<number[]>("read_binary_file", { filePath: note.path });
        const uint8 = new Uint8Array(bytes);
        const blob = new Blob([uint8], { type: mimeFromExtension(note.file_extension) });
        const objectUrl = URL.createObjectURL(blob);
        setBinaryPreviewUrl(objectUrl);
      } else if (category === "molecular" && activeDiscipline === "chemistry") {
        try {
          const preview = await invoke<{
            preview_data: string;
            atom_count: number;
            preview_atom_count: number;
            truncated: boolean;
          }>("read_molecular_preview", {
            filePath: note.path,
            maxAtoms: 2000,
          });
          setNoteContent(preview.preview_data);
          setLiveContent(preview.preview_data);
          setMolecularPreview({
            atom_count: preview.atom_count,
            preview_atom_count: preview.preview_atom_count,
            truncated: preview.truncated,
          });
        } catch {
          const content = await invoke<string>("read_note", { filePath: note.path });
          setNoteContent(content);
          setLiveContent(content);
        }
      } else {
        const content = await invoke<string>("read_note", { filePath: note.path });
        setNoteContent(content);
        setLiveContent(content);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setNoteContent("");
      setLiveContent("");
      setMolecularPreview(null);
    }
  }, [activeDiscipline, binaryPreviewUrl]);

  const handleBackToManager = useCallback(() => {
    setVaultPath("");
    setNotes([]);
    setActiveNote(null);
    setNoteContent("");
    setLiveContent("");
    setMolecularPreview(null);
    setError("");
  }, []);

  const handleSave = useCallback(async (markdown: string) => {
    if (!activeNote || !vaultPath) return;
    try {
      await invoke("write_note", { vaultPath, filePath: activeNote.path, content: markdown });
    } catch (e) {
      setError(`保存失败: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, [activeNote, vaultPath]);

  return {
    vaultPath,
    notes,
    activeNote,
    noteContent,
    liveContent,
    molecularPreview,
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
  };
}
