import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { NoteInfo } from "../../types";
import type { PdfAnnotation, AnnotationColor, SearchMatch } from "../../types/pdf";
import { PdfDocContext, usePdfLifecycle, usePdfAnnotations } from "../../hooks/usePdfRenderer";
import type { TextSelectionInfo } from "./PdfTextLayer";
import PdfToolbar from "./PdfToolbar";
import PdfPage from "./PdfPage";
import PdfSearchBar from "./PdfSearchBar";
import PdfOutlinePanel from "./PdfOutlinePanel";
import PdfAnnotationPanel from "./PdfAnnotationPanel";
import PdfSelectionToolbar from "./PdfSelectionToolbar";
import "./pdf-viewer.css";

interface PdfViewerProps {
  note: NoteInfo;
  vaultPath?: string;
}

type ViewerStatus = "loading" | "ready" | "error";

interface SelectionToolbarState {
  x: number;
  y: number;
  pageIndex: number;
  selectedText: string;
  textRanges: PdfAnnotation["textRanges"];
}

const TOOLBAR_HIDE_DELAY = 3000;
const DEFAULT_ZOOM = 1;
const MIN_ZOOM = 0.25;
const MAX_ZOOM = 4;
const PAGE_BASE_WIDTH = 612; // US Letter width in PDF points
const PAGE_BASE_HEIGHT = 792;
const SCROLL_SAVE_DEBOUNCE = 1000;

function clampZoom(z: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));
}

export default function PdfViewer({ note, vaultPath }: PdfViewerProps) {
  const { docId, docIdRef, metadata, openPdf, closePdf } = usePdfLifecycle();
  const { loadAnnotations, saveAnnotations } = usePdfAnnotations();

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
  const [selectionToolbar, setSelectionToolbar] = useState<SelectionToolbarState | null>(null);

  // --- Refs ---
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const pageRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const observerRef = useRef<IntersectionObserver | null>(null);
  const selectionToolbarRef = useRef<HTMLDivElement>(null);
  const scrollSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevZoomRef = useRef(DEFAULT_ZOOM);
  const restoredPositionRef = useRef(false);

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
      if (scrollSaveTimerRef.current) {
        clearTimeout(scrollSaveTimerRef.current);
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

  // --- Reading position memory (Task 19) ---
  const positionKey = `pdf-position-${note.id}`;

  // Restore position on mount
  useEffect(() => {
    if (status !== "ready" || restoredPositionRef.current) return;
    restoredPositionRef.current = true;

    try {
      const saved = localStorage.getItem(positionKey);
      if (saved) {
        const { page, zoom: savedZoom } = JSON.parse(saved) as { page: number; zoom: number };
        if (typeof savedZoom === "number") {
          setZoom(clampZoom(savedZoom));
          prevZoomRef.current = clampZoom(savedZoom);
        }
        if (typeof page === "number" && page >= 1) {
          // Delay scroll to page until after the first render with restored zoom
          requestAnimationFrame(() => {
            const el = pageRefs.current.get(page - 1);
            if (el) {
              el.scrollIntoView({ behavior: "instant", block: "start" });
            }
          });
        }
      }
    } catch {
      // Ignore corrupted localStorage data
    }
  }, [status, positionKey]);

  // Save position on scroll (debounced)
  useEffect(() => {
    const scrollEl = scrollRef.current;
    if (!scrollEl || status !== "ready") return;

    const handleScroll = () => {
      if (scrollSaveTimerRef.current) {
        clearTimeout(scrollSaveTimerRef.current);
      }
      scrollSaveTimerRef.current = setTimeout(() => {
        try {
          localStorage.setItem(
            positionKey,
            JSON.stringify({ page: currentPage, zoom }),
          );
        } catch {
          // localStorage may be full — silently ignore
        }
      }, SCROLL_SAVE_DEBOUNCE);
    };

    scrollEl.addEventListener("scroll", handleScroll, { passive: true });
    return () => scrollEl.removeEventListener("scroll", handleScroll);
  }, [status, positionKey, currentPage, zoom]);

  // --- Zoom scroll position preservation (Task 17 & 20) ---
  useEffect(() => {
    const scrollEl = scrollRef.current;
    if (!scrollEl || prevZoomRef.current === zoom) return;

    const ratio = zoom / prevZoomRef.current;
    const scrollMidY = scrollEl.scrollTop + scrollEl.clientHeight / 2;
    const newScrollMidY = scrollMidY * ratio;
    scrollEl.scrollTop = newScrollMidY - scrollEl.clientHeight / 2;

    prevZoomRef.current = zoom;
  }, [zoom]);

  // --- Ctrl+scroll zoom (Task 17 & 20) ---
  useEffect(() => {
    const scrollEl = scrollRef.current;
    if (!scrollEl) return;

    const handleWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();

      // Compute the cursor position fraction within the scroll viewport
      const rect = scrollEl.getBoundingClientRect();
      const cursorFractionY = (e.clientY - rect.top) / rect.height;

      // Pre-zoom: the absolute position the cursor points at
      const preScrollY = scrollEl.scrollTop + cursorFractionY * scrollEl.clientHeight;

      const delta = e.deltaY > 0 ? -0.1 : 0.1;
      setZoom((prev) => {
        const next = clampZoom(prev + delta);
        const ratio = next / prev;

        // Preserve cursor position: adjust scroll so the same content stays under cursor
        requestAnimationFrame(() => {
          const newScrollY = preScrollY * ratio - cursorFractionY * scrollEl.clientHeight;
          scrollEl.scrollTop = newScrollY;
        });

        prevZoomRef.current = prev; // will be updated by the zoom effect, but we handle scroll here
        // We skip the generic zoom scroll effect by updating prevZoomRef early
        requestAnimationFrame(() => {
          prevZoomRef.current = next;
        });

        return next;
      });
    };

    scrollEl.addEventListener("wheel", handleWheel, { passive: false });
    return () => scrollEl.removeEventListener("wheel", handleWheel);
  }, []);

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
    setSelectionToolbar(null);
    restoredPositionRef.current = false;
    prevZoomRef.current = DEFAULT_ZOOM;

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
            err instanceof Error ? err.message : typeof err === "string" ? err : "Failed to open PDF",
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

  // --- Keyboard shortcuts (Task 17) ---
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isCtrl = e.ctrlKey || e.metaKey;

      if (isCtrl && e.key === "f") {
        e.preventDefault();
        setShowSearch((prev) => !prev);
        resetToolbarTimer();
        return;
      }

      if (e.key === "Escape") {
        if (selectionToolbar) {
          setSelectionToolbar(null);
          return;
        }
        if (showSearch) {
          setShowSearch(false);
          resetToolbarTimer();
          return;
        }
        return;
      }

      // Zoom in: Ctrl+= or Ctrl++
      if (isCtrl && (e.key === "=" || e.key === "+")) {
        e.preventDefault();
        setZoom((prev) => clampZoom(prev + 0.25));
        resetToolbarTimer();
        return;
      }

      // Zoom out: Ctrl+-
      if (isCtrl && e.key === "-") {
        e.preventDefault();
        setZoom((prev) => clampZoom(prev - 0.25));
        resetToolbarTimer();
        return;
      }

      // Reset zoom: Ctrl+0
      if (isCtrl && e.key === "0") {
        e.preventDefault();
        setZoom(1);
        resetToolbarTimer();
        return;
      }

      // Space / Shift+Space: scroll by 80% of container height
      if (e.key === " " || e.code === "Space") {
        e.preventDefault();
        const scrollEl = scrollRef.current;
        if (!scrollEl) return;
        const amount = scrollEl.clientHeight * 0.8;
        scrollEl.scrollBy({ top: e.shiftKey ? -amount : amount, behavior: "smooth" });
        return;
      }
    };

    const container = containerRef.current;
    if (container) {
      container.addEventListener("keydown", handleKeyDown);
      return () => container.removeEventListener("keydown", handleKeyDown);
    }
  }, [showSearch, selectionToolbar, resetToolbarTimer]);

  // --- Scroll to page (Task 20) ---
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

  // --- Text selection handling (Task 18) ---
  const handleTextSelected = useCallback(
    (info: TextSelectionInfo) => {
      if (!containerRef.current) return;
      const containerRect = containerRef.current.getBoundingClientRect();

      setSelectionToolbar({
        x: info.clientX - containerRect.left,
        y: info.clientY - containerRect.top - 40, // Position above cursor
        pageIndex: info.pageIndex,
        selectedText: info.selectedText,
        textRanges: info.textRanges,
      });
    },
    [],
  );

  // Highlight creation (Task 18)
  const handleHighlight = useCallback(
    (color: AnnotationColor) => {
      if (!selectionToolbar || !vaultPath) return;

      const now = new Date().toISOString();
      const newAnnotation: PdfAnnotation = {
        id: crypto.randomUUID(),
        pageNumber: selectionToolbar.pageIndex + 1, // Convert 0-based to 1-based
        type: "highlight",
        color,
        textRanges: selectionToolbar.textRanges,
        selectedText: selectionToolbar.selectedText,
        createdAt: now,
        updatedAt: now,
      };

      setAnnotations((prev) => {
        const next = [...prev, newAnnotation];
        // Save asynchronously — don't block UI
        void saveAnnotations(vaultPath, note.path, next);
        return next;
      });

      // Clear browser selection and dismiss toolbar
      window.getSelection()?.removeAllRanges();
      setSelectionToolbar(null);
    },
    [selectionToolbar, vaultPath, note.path, saveAnnotations],
  );

  // Note creation stub (Task 18)
  const handleNote = useCallback(() => {
    // For now, create a highlight with a note placeholder
    // A full note editing UI can be added later
    if (selectionToolbar) {
      handleHighlight("yellow");
    }
  }, [selectionToolbar, handleHighlight]);

  // Copy to clipboard (Task 18)
  const handleCopy = useCallback(() => {
    if (!selectionToolbar) return;
    void navigator.clipboard.writeText(selectionToolbar.selectedText);
    window.getSelection()?.removeAllRanges();
    setSelectionToolbar(null);
  }, [selectionToolbar]);

  // Click-outside dismissal for selection toolbar (Task 18 & 20)
  useEffect(() => {
    if (!selectionToolbar) return;

    const handleMouseDown = (e: MouseEvent) => {
      const toolbarEl = selectionToolbarRef.current;
      if (toolbarEl && toolbarEl.contains(e.target as Node)) return;
      setSelectionToolbar(null);
    };

    // Use a small delay to avoid dismissing on the same click that created the selection
    const timer = setTimeout(() => {
      document.addEventListener("mousedown", handleMouseDown);
    }, 50);

    return () => {
      clearTimeout(timer);
      document.removeEventListener("mousedown", handleMouseDown);
    };
  }, [selectionToolbar]);

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
            onTextSelected={handleTextSelected}
          />
        </div>
      );
    });
  }, [metadata, zoom, visiblePages, annotations, setPageRef, handleTextSelected]);

  // --- Error state ---
  if (status === "error") {
    return (
      <div className="pdf-viewer">
        <div className="pdf-viewer-error">
          <span className="pdf-viewer-error-icon"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg></span>
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

        {/* Selection toolbar */}
        {selectionToolbar && (
          <div ref={selectionToolbarRef}>
            <PdfSelectionToolbar
              x={selectionToolbar.x}
              y={selectionToolbar.y}
              onHighlight={handleHighlight}
              onNote={handleNote}
              onCopy={handleCopy}
            />
          </div>
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
