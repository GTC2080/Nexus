import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { NoteInfo } from "../../types";
import type { PdfAnnotation, PdfMetadata } from "../../types/pdf";
import { PdfDocContext, usePdfLifecycle, usePdfAnnotations } from "../../hooks/usePdfRenderer";
import PdfToolbar from "./PdfToolbar";
import "./pdf-viewer.css";

interface PdfViewerProps {
  note: NoteInfo;
  vaultPath?: string;
}

type ViewerStatus = "loading" | "ready" | "error";

const TOOLBAR_HIDE_DELAY = 3000;
const DEFAULT_ZOOM = 1;
const PAGE_BASE_WIDTH = 612; // US Letter width in PDF points
const PAGE_BASE_HEIGHT = 792;

export default function PdfViewer({ note, vaultPath }: PdfViewerProps) {
  const { docId, docIdRef, metadata, openPdf, closePdf } = usePdfLifecycle();
  const { loadAnnotations } = usePdfAnnotations();

  // --- Viewer state ---
  const [status, setStatus] = useState<ViewerStatus>("loading");
  const [errorMessage, setErrorMessage] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [zoom, setZoom] = useState(DEFAULT_ZOOM);
  const [showSearch, setShowSearch] = useState(false);
  const [showOutline, setShowOutline] = useState(false);
  const [showAnnotationPanel, setShowAnnotationPanel] = useState(false);
  const [annotations, setAnnotations] = useState<PdfAnnotation[]>([]);
  const [toolbarVisible, setToolbarVisible] = useState(true);

  // --- Toolbar auto-hide ---
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const resetToolbarTimer = useCallback(() => {
    setToolbarVisible(true);
    if (hideTimerRef.current) {
      clearTimeout(hideTimerRef.current);
    }
    hideTimerRef.current = setTimeout(() => {
      setToolbarVisible(false);
    }, TOOLBAR_HIDE_DELAY);
  }, []);

  // Clear timer on unmount
  useEffect(() => {
    return () => {
      if (hideTimerRef.current) {
        clearTimeout(hideTimerRef.current);
      }
    };
  }, []);

  // Start timer on mount
  useEffect(() => {
    resetToolbarTimer();
  }, [resetToolbarTimer]);

  const handleMouseMove = useCallback(() => {
    resetToolbarTimer();
  }, [resetToolbarTimer]);

  // --- Open PDF on mount / when note changes ---
  useEffect(() => {
    let cancelled = false;

    setStatus("loading");
    setErrorMessage("");
    setCurrentPage(1);
    setZoom(DEFAULT_ZOOM);
    setShowSearch(false);
    setShowOutline(false);
    setShowAnnotationPanel(false);
    setAnnotations([]);

    const open = async () => {
      try {
        await openPdf(note.path);
        if (!cancelled) {
          setStatus("ready");
        }
      } catch (err) {
        if (!cancelled) {
          setStatus("error");
          setErrorMessage(
            err instanceof Error ? err.message : "Failed to open PDF",
          );
        }
      }
    };

    void open();

    return () => {
      cancelled = true;
      void closePdf();
    };
  }, [note.path, note.id, openPdf, closePdf]);

  // --- Load annotations once PDF is open ---
  useEffect(() => {
    if (!docId || !vaultPath) return;
    let cancelled = false;

    const load = async () => {
      try {
        const loaded = await loadAnnotations(vaultPath, note.path);
        if (!cancelled) {
          setAnnotations(loaded);
        }
      } catch {
        // Annotations are optional — silently ignore load failures
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [docId, vaultPath, note.path, loadAnnotations]);

  // --- Keyboard shortcuts ---
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "f") {
        e.preventDefault();
        setShowSearch(prev => !prev);
        resetToolbarTimer();
      } else if (e.key === "Escape") {
        if (showSearch) {
          setShowSearch(false);
          resetToolbarTimer();
        }
      }
    };

    const container = containerRef.current;
    if (container) {
      container.addEventListener("keydown", handleKeyDown);
      return () => container.removeEventListener("keydown", handleKeyDown);
    }
  }, [showSearch, resetToolbarTimer]);

  // --- Page change handler ---
  const handlePageChange = useCallback(
    (page: number) => {
      const count = metadata?.page_count ?? 0;
      const clamped = Math.min(Math.max(1, page), count);
      setCurrentPage(clamped);
      // TODO: scroll to page when PdfPage components are implemented
    },
    [metadata],
  );

  // --- Toggle handlers ---
  const toggleSearch = useCallback(() => {
    setShowSearch(prev => !prev);
  }, []);

  const toggleOutline = useCallback(() => {
    setShowOutline(prev => !prev);
  }, []);

  const toggleAnnotations = useCallback(() => {
    setShowAnnotationPanel(prev => !prev);
  }, []);

  // --- Placeholder pages ---
  const pagePlaceholders = useMemo(() => {
    if (!metadata) return null;

    return Array.from({ length: metadata.page_count }, (_, i) => {
      const dim = metadata.page_dimensions[i];
      const w = (dim?.width ?? PAGE_BASE_WIDTH) * zoom;
      const h = (dim?.height ?? PAGE_BASE_HEIGHT) * zoom;

      return (
        <div
          key={i}
          className="pdf-page-placeholder"
          style={{ width: `${w}px`, height: `${h}px` }}
        >
          {i + 1}
        </div>
      );
    });
  }, [metadata, zoom]);

  // --- Error state ---
  if (status === "error") {
    return (
      <div className="pdf-viewer">
        <div className="pdf-viewer-error">
          <span className="pdf-viewer-error-icon">&#9888;</span>
          <span className="pdf-viewer-error-message">{errorMessage}</span>
        </div>
      </div>
    );
  }

  // --- Loading state ---
  if (status === "loading") {
    return (
      <div className="pdf-viewer">
        <div className="pdf-viewer-loading">
          <div className="pdf-viewer-loading-spinner" />
        </div>
      </div>
    );
  }

  // --- Ready state ---
  return (
    <PdfDocContext.Provider value={docIdRef.current}>
      <div
        ref={containerRef}
        className="pdf-viewer"
        onMouseMove={handleMouseMove}
        tabIndex={-1}
      >
        {/* Scroll area with page placeholders */}
        <div className="pdf-viewer-scroll">
          {pagePlaceholders}
        </div>

        {/* Floating toolbar */}
        <PdfToolbar
          metadata={metadata}
          currentPage={currentPage}
          zoom={zoom}
          showOutline={showOutline}
          visible={toolbarVisible}
          onPageChange={handlePageChange}
          onZoomChange={setZoom}
          onToggleSearch={toggleSearch}
          onToggleOutline={toggleOutline}
          onToggleAnnotations={toggleAnnotations}
        />
      </div>
    </PdfDocContext.Provider>
  );
}
