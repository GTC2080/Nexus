import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { NoteInfo } from "../types";

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

export function useBinaryPreview() {
  const [binaryPreviewUrl, setBinaryPreviewUrl] = useState("");

  const clearBinaryPreview = useCallback(() => {
    setBinaryPreviewUrl(current => {
      if (current) {
        URL.revokeObjectURL(current);
      }
      return "";
    });
  }, []);

  const loadBinaryPreview = useCallback(async (note: NoteInfo) => {
    const bytes = await invoke<number[]>("read_binary_file", { filePath: note.path });
    const nextBlob = new Blob([new Uint8Array(bytes)], {
      type: mimeFromExtension(note.file_extension),
    });
    const nextUrl = URL.createObjectURL(nextBlob);

    setBinaryPreviewUrl(current => {
      if (current) {
        URL.revokeObjectURL(current);
      }
      return nextUrl;
    });

    return nextUrl;
  }, []);

  useEffect(() => clearBinaryPreview, [clearBinaryPreview]);

  return {
    binaryPreviewUrl,
    clearBinaryPreview,
    loadBinaryPreview,
  };
}
