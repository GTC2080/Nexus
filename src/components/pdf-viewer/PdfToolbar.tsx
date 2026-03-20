import { useCallback, useRef, useState } from "react";
import type { PdfMetadata } from "../../types/pdf";

interface PdfToolbarProps {
  metadata: PdfMetadata | null;
  currentPage: number;
  zoom: number;
  showOutline: boolean;
  visible: boolean;
  onPageChange: (page: number) => void;
  onZoomChange: (zoom: number) => void;
  onToggleSearch: () => void;
  onToggleOutline: () => void;
  onToggleAnnotations: () => void;
}

const ZOOM_MIN = 0.25;
const ZOOM_MAX = 5;
const ZOOM_STEP = 0.15;

function clampZoom(value: number): number {
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, value));
}

export default function PdfToolbar({
  metadata,
  currentPage,
  zoom,
  showOutline,
  visible,
  onPageChange,
  onZoomChange,
  onToggleSearch,
  onToggleOutline,
  onToggleAnnotations,
}: PdfToolbarProps) {
  const pageCount = metadata?.page_count ?? 0;
  const [editingPage, setEditingPage] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handlePageInputCommit = useCallback(
    (value: string) => {
      setEditingPage(false);
      const num = parseInt(value, 10);
      if (!Number.isNaN(num) && num >= 1 && num <= pageCount) {
        onPageChange(num);
      }
    },
    [onPageChange, pageCount],
  );

  const handlePageInputKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") {
        handlePageInputCommit(e.currentTarget.value);
      } else if (e.key === "Escape") {
        setEditingPage(false);
      }
    },
    [handlePageInputCommit],
  );

  const hasOutline = metadata?.outline && metadata.outline.length > 0;

  return (
    <div className={`pdf-toolbar-wrapper ${visible ? "" : "pdf-toolbar-hidden"}`}>
      <div className="pdf-toolbar">
        {/* TOC / Outline */}
        <button
          type="button"
          className={`pdf-toolbar-btn ${showOutline ? "pdf-toolbar-btn-active" : ""}`}
          onClick={onToggleOutline}
          disabled={!hasOutline}
          title="Table of Contents"
        >
          &#9776;
        </button>

        <div className="pdf-toolbar-divider" />

        {/* Zoom controls */}
        <button
          type="button"
          className="pdf-toolbar-btn"
          onClick={() => onZoomChange(clampZoom(zoom - ZOOM_STEP))}
          disabled={zoom <= ZOOM_MIN}
          title="Zoom Out"
        >
          &minus;
        </button>
        <span className="pdf-toolbar-zoom">
          {Math.round(zoom * 100)}%
        </span>
        <button
          type="button"
          className="pdf-toolbar-btn"
          onClick={() => onZoomChange(clampZoom(zoom + ZOOM_STEP))}
          disabled={zoom >= ZOOM_MAX}
          title="Zoom In"
        >
          +
        </button>

        <div className="pdf-toolbar-divider" />

        {/* Search */}
        <button
          type="button"
          className="pdf-toolbar-btn"
          onClick={onToggleSearch}
          title="Search (Ctrl+F)"
        >
          &#128269;
        </button>

        <div className="pdf-toolbar-divider" />

        {/* Page navigation */}
        <button
          type="button"
          className="pdf-toolbar-btn"
          onClick={() => onPageChange(Math.max(1, currentPage - 1))}
          disabled={currentPage <= 1}
          title="Previous Page"
        >
          &#9664;
        </button>

        <div className="pdf-toolbar-page">
          {editingPage ? (
            <input
              ref={inputRef}
              type="text"
              className="pdf-toolbar-page-input"
              defaultValue={String(currentPage)}
              autoFocus
              onBlur={e => handlePageInputCommit(e.currentTarget.value)}
              onKeyDown={handlePageInputKeyDown}
            />
          ) : (
            <button
              type="button"
              className="pdf-toolbar-page-input"
              style={{ cursor: "text" }}
              onClick={() => {
                setEditingPage(true);
                // Focus will happen via autoFocus on the input
              }}
            >
              {currentPage}
            </button>
          )}
          <span className="pdf-toolbar-page-total">/ {pageCount}</span>
        </div>

        <button
          type="button"
          className="pdf-toolbar-btn"
          onClick={() => onPageChange(Math.min(pageCount, currentPage + 1))}
          disabled={currentPage >= pageCount}
          title="Next Page"
        >
          &#9654;
        </button>

        <div className="pdf-toolbar-divider" />

        {/* Annotations */}
        <button
          type="button"
          className="pdf-toolbar-btn"
          onClick={onToggleAnnotations}
          title="Annotations"
        >
          &#128221;
        </button>
      </div>
    </div>
  );
}
