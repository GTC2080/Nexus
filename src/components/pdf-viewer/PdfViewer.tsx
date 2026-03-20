import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { NoteInfo } from "../../types";
import type { PdfAnnotation, SearchMatch } from "../../types/pdf";
import { PdfDocContext, usePdfLifecycle, usePdfAnnotations } from "../../hooks/usePdfRenderer";
import PdfToolbar from "./PdfToolbar";
import PdfPage from "./PdfPage";
import PdfSearchBar from "./PdfSearchBar";
import PdfOutlinePanel from "./PdfOutlinePanel";
import PdfAnnotationPanel from "./PdfAnnotationPanel";
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
  const [visiblePages, setVisiblePages] = useState<Set<number>>(new Set());

  // --- Refs ---
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const pageRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const observerRef = useRef<IntersectionObserver | null>(null);

  // --- Toolbar auto-hide ---
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

  // --- IntersectionObserver for page visibility ---
  useEffect(() => {
    if (!scrollRef.current) return;

    observerRef.current = new IntersectionObserver(
      (entries) => {
        setVisiblePages((prev) => {
          const next = new Set(prev);
          for (const entry of entries) {
            const pageIndex = Number(
              (entry.target as HTMLElement).dataset.pageIndex,
            );
            if (entry.isIntersecting) {
              next.add(pageIndex);
            } else {
              next.delete(pageIndex);
            }
          }
          // Only create a new Set if something actually changed
          if (next.size === prev.size && [...next].every((v) => prev.has(v))) {
            return prev;
          }
          return next;
        });
      },
      {
        root: scrollRef.current,
        rootMargin: "200px 0px",
        threshold: 0,
      },
    );

    return () => {
      observerRef.current?.disconnect();
      observerRef.current = null;
    };
  }, [status]); // Recreate when status changes (loading -> ready)

  // Track current page based on which pages are visible (topmost visible)
  useEffect(() => {
    if (visiblePages.size === 0) return;
    const sorted = [...visiblePages].sort((a, b) => a - b);
    const topmost = sorted[0] + 1; // Convert 0-based to 1-based
    setCurrentPage(topmost);
  }, [visiblePages]);

  // --- Page ref callback (registers/unregisters with IntersectionObserver) ---
  const setPageRef = useCallback(
    (pageIndex: number, el: HTMLDivElement | null) => {
      const observer = observerRef.current;
      const prev = pageRefs.current.get(pageIndex);

      if (prev && observer) {
        observer.unobserve(prev);
      }

      if (el) {
        pageRefs.current.set(pageIndex, el);
        if (observer) {
          observer.observe(el);
        }
      } else {
        pageRefs.current.delete(pageIndex);
      }
    },
    [],
  );

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
    setVisiblePages(new Set());

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
        setShowSearch((prev) => !prev);
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

  // --- Scroll to page ---
  const scrollToPage = useCallback((page: number) => {
    const el = pageRefs.current.get(page - 1);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, []);

  // --- Page change handler ---
  const handlePageChange = useCallback(
    (page: number) => {
      const count = metadata?.page_count ?? 0;
      const clamped = Math.min(Math.max(1, page), count);
      setCurrentPage(clamped);
      scrollToPage(clamped);
    },
    [metadata, scrollToPage],
  );

  // --- Toggle handlers ---
  const toggleSearch = useCallback(() => {
    setShowSearch((prev) => !prev);
  }, []);

  const toggleOutline = useCallback(() => {
    setShowOutline((prev) => !prev);
  }, []);

  const toggleAnnotations = useCallback(() => {
    setShowAnnotationPanel((prev) => !prev);
  }, []);

  // --- Search handlers ---
  const handleSearchResults = useCallback((_results: SearchMatch[]) => {
    // Results are managed by the search bar; we could store them here
    // for search highlight overlay in the future
  }, []);

  const handleSearchNavigate = useCallback(
    (match: SearchMatch, _index: number) => {
      // Navigate to the page of the match (match.page is 0-based)
      handlePageChange(match.page + 1);
    },
    [handlePageChange],
  );

  const handleCloseSearch = useCallback(() => {
    setShowSearch(false);
  }, []);

  // --- Outline navigation ---
  const handleOutlineNavigate = useCallback(
    (pageNumber: number) => {
      handlePageChange(pageNumber);
    },
    [handlePageChange],
  );

  const handleOutlineClose = useCallback(() => {
    setShowOutline(false);
  }, []);

  // --- Annotation panel navigation ---
  const handleAnnotationNavigate = useCallback(
    (pageNumber: number) => {
      handlePageChange(pageNumber);
    },
    [handlePageChange],
  );

  const handleAnnotationPanelClose = useCallback(() => {
    setShowAnnotationPanel(false);
  }, []);

  // --- Page list ---
  const pageElements = useMemo(() => {
    if (!metadata) return null;

    return Array.from({ length: metadata.page_count }, (_, i) => {
      const dim = metadata.page_dimensions[i];
      const w = dim?.width ?? PAGE_BASE_WIDTH;
      const h = dim?.height ?? PAGE_BASE_HEIGHT;

      return (
        <div
          key={i}
          data-page-index={i}
          ref={(el) => setPageRef(i, el)}
        >
          <PdfPage
            pageIndex={i}
            widthPts={w}
            heightPts={h}
            zoom={zoom}
            isVisible={visiblePages.has(i)}
            annotations={annotations}
          />
        </div>
      );
    });
  }, [metadata, zoom, visiblePages, annotations, setPageRef]);

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
        {/* Scroll area with page components */}
        <div ref={scrollRef} className="pdf-viewer-scroll">
          {pageElements}
        </div>

        {/* Search bar */}
        {showSearch && (
          <PdfSearchBar
            onResults={handleSearchResults}
            onNavigate={handleSearchNavigate}
            onClose={handleCloseSearch}
          />
        )}

        {/* Outline panel */}
        {showOutline && metadata?.outline && (
          <PdfOutlinePanel
            outline={metadata.outline}
            onNavigate={handleOutlineNavigate}
            onClose={handleOutlineClose}
          />
        )}

        {/* Annotation panel */}
        {showAnnotationPanel && (
          <PdfAnnotationPanel
            annotations={annotations}
            onClose={handleAnnotationPanelClose}
            onNavigate={handleAnnotationNavigate}
          />
        )}

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
