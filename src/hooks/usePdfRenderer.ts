import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type {
  PdfAnnotation,
  PdfMetadata,
  PageTextData,
  RenderResult,
  SearchMatch,
} from "../types/pdf";

// ---------------------------------------------------------------------------
// PdfDocContext — shared doc ID across PdfViewer and its children
// ---------------------------------------------------------------------------

/**
 * Holds the currently open PDF doc ID (or null when no PDF is open).
 * PdfViewer wraps its children in `<PdfDocContext.Provider value={docId}>`.
 * Child components (PdfPage, PdfTextLayer, etc.) consume this via
 * `usePdfRenderer()`.
 */
export const PdfDocContext = createContext<string | null>(null);

// ---------------------------------------------------------------------------
// usePdfLifecycle — used by PdfViewer to manage open / close
// ---------------------------------------------------------------------------

export interface PdfLifecycle {
  /** The currently open doc ID, or null */
  docId: string | null;
  /** Ref to the current doc ID — stable reference for callbacks */
  docIdRef: React.MutableRefObject<string | null>;
  /** Metadata returned by open_pdf */
  metadata: PdfMetadata | null;
  /** Open a PDF file by its absolute path and populate metadata */
  openPdf: (filePath: string) => Promise<void>;
  /** Close the currently open PDF and clear state */
  closePdf: () => Promise<void>;
}

export function usePdfLifecycle(): PdfLifecycle {
  const [docId, setDocId] = useState<string | null>(null);
  const [metadata, setMetadata] = useState<PdfMetadata | null>(null);
  const docIdRef = useRef<string | null>(null);

  // Keep the ref in sync with state so stable callbacks can read the latest value.
  useEffect(() => {
    docIdRef.current = docId;
  }, [docId]);

  const openPdf = useCallback(async (filePath: string) => {
    // Close any previously open document first.
    if (docIdRef.current) {
      await invoke("close_pdf", { docId: docIdRef.current }).catch(() => {
        // Ignore close errors — the file may already be gone.
      });
      docIdRef.current = null;
      setDocId(null);
      setMetadata(null);
    }

    const meta = await invoke<PdfMetadata>("open_pdf", { filePath });
    docIdRef.current = meta.doc_id;
    setDocId(meta.doc_id);
    setMetadata(meta);
  }, []);

  const closePdf = useCallback(async () => {
    if (!docIdRef.current) {
      return;
    }
    await invoke("close_pdf", { docId: docIdRef.current });
    docIdRef.current = null;
    setDocId(null);
    setMetadata(null);
  }, []);

  // Ensure the PDF is closed when the component unmounts.
  useEffect(() => {
    return () => {
      if (docIdRef.current) {
        void invoke("close_pdf", { docId: docIdRef.current }).catch(() => undefined);
        docIdRef.current = null;
      }
    };
  }, []);

  return { docId, docIdRef, metadata, openPdf, closePdf };
}

// ---------------------------------------------------------------------------
// usePdfRenderer — used by child components (PdfPage, PdfTextLayer, etc.)
// ---------------------------------------------------------------------------

export interface PdfRenderer {
  /** The current doc ID from context (null if no PDF is open) */
  docId: string | null;
  /**
   * Render a PDF page and return the WebP asset URL and dimensions.
   * @param pageIndex 0-based page index
   * @param scale     Device-pixel-ratio adjusted scale factor
   * @param inlineFallback When true, the backend also returns a data URL for WebView fallback.
   */
  renderPage: (pageIndex: number, scale: number, inlineFallback?: boolean) => Promise<RenderResult>;
  /**
   * Extract text content and word positions for a single page.
   * @param pageIndex 0-based page index
   */
  getPageText: (pageIndex: number) => Promise<PageTextData>;
  /**
   * Search across all pages of the open document.
   * @param query Search string (empty string returns an empty array)
   */
  searchPdf: (query: string) => Promise<SearchMatch[]>;
}

export function usePdfRenderer(): PdfRenderer {
  const docId = useContext(PdfDocContext);

  const renderPage = useCallback(
    async (
      pageIndex: number,
      scale: number,
      inlineFallback = false,
    ): Promise<RenderResult> => {
      if (!docId) {
        throw new Error("usePdfRenderer: no PDF document is open");
      }
      return invoke<RenderResult>("render_pdf_page", { docId, pageIndex, scale, inlineFallback });
    },
    [docId],
  );

  const getPageText = useCallback(
    async (pageIndex: number): Promise<PageTextData> => {
      if (!docId) {
        throw new Error("usePdfRenderer: no PDF document is open");
      }
      return invoke<PageTextData>("get_pdf_page_text", { docId, pageIndex });
    },
    [docId],
  );

  const searchPdf = useCallback(
    async (query: string): Promise<SearchMatch[]> => {
      if (!docId) {
        return [];
      }
      return invoke<SearchMatch[]>("search_pdf", { docId, query });
    },
    [docId],
  );

  return { docId, renderPage, getPageText, searchPdf };
}

// ---------------------------------------------------------------------------
// usePdfAnnotations — stateless annotation persistence helpers
// ---------------------------------------------------------------------------

export interface PdfAnnotationsHook {
  /**
   * Load annotations for a PDF file from the vault.
   * @param vaultPath Absolute path to the vault root
   * @param filePath  Absolute path to the PDF file
   */
  loadAnnotations: (vaultPath: string, filePath: string) => Promise<PdfAnnotation[]>;
  /**
   * Persist the full annotation list for a PDF file to the vault.
   * @param vaultPath       Absolute path to the vault root
   * @param filePath        Absolute path to the PDF file
   * @param annotationsData The complete list of annotations to save
   */
  saveAnnotations: (
    vaultPath: string,
    filePath: string,
    annotationsData: PdfAnnotation[],
  ) => Promise<void>;
}

export function usePdfAnnotations(): PdfAnnotationsHook {
  const loadAnnotations = useCallback(
    async (vaultPath: string, filePath: string): Promise<PdfAnnotation[]> => {
      return invoke<PdfAnnotation[]>("load_pdf_annotations", { vaultPath, filePath });
    },
    [],
  );

  const saveAnnotations = useCallback(
    async (
      vaultPath: string,
      filePath: string,
      annotationsData: PdfAnnotation[],
    ): Promise<void> => {
      return invoke("save_pdf_annotations", { vaultPath, filePath, annotationsData });
    },
    [],
  );

  return { loadAnnotations, saveAnnotations };
}
