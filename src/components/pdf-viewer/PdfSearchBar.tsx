import { useCallback, useEffect, useRef, useState } from "react";
import type { SearchMatch } from "../../types/pdf";
import { usePdfRenderer } from "../../hooks/usePdfRenderer";

interface PdfSearchBarProps {
  onResults: (results: SearchMatch[]) => void;
  onNavigate: (match: SearchMatch, index: number) => void;
  onClose: () => void;
}

export default function PdfSearchBar({
  onResults,
  onNavigate,
  onClose,
}: PdfSearchBarProps) {
  const { searchPdf } = usePdfRenderer();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchMatch[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Debounced search
  useEffect(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    if (!query.trim()) {
      setResults([]);
      setActiveIndex(0);
      onResults([]);
      return;
    }

    debounceRef.current = setTimeout(() => {
      searchPdf(query)
        .then((matches) => {
          setResults(matches);
          setActiveIndex(matches.length > 0 ? 0 : 0);
          onResults(matches);
          if (matches.length > 0) {
            onNavigate(matches[0], 0);
          }
        })
        .catch(() => {
          setResults([]);
          onResults([]);
        });
    }, 300);

    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, [query, searchPdf, onResults, onNavigate]);

  const navigateNext = useCallback(() => {
    if (results.length === 0) return;
    const next = (activeIndex + 1) % results.length;
    setActiveIndex(next);
    onNavigate(results[next], next);
  }, [activeIndex, results, onNavigate]);

  const navigatePrev = useCallback(() => {
    if (results.length === 0) return;
    const prev = (activeIndex - 1 + results.length) % results.length;
    setActiveIndex(prev);
    onNavigate(results[prev], prev);
  }, [activeIndex, results, onNavigate]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault();
        if (e.shiftKey) {
          navigatePrev();
        } else {
          navigateNext();
        }
      } else if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    },
    [navigateNext, navigatePrev, onClose],
  );

  const matchDisplay = query.trim()
    ? results.length > 0
      ? `${activeIndex + 1} / ${results.length}`
      : "0 / 0"
    : "";

  return (
    <div className="pdf-search-bar">
      <input
        ref={inputRef}
        type="text"
        className="pdf-search-input"
        placeholder="Search..."
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={handleKeyDown}
      />
      {matchDisplay && (
        <span className="pdf-search-count">{matchDisplay}</span>
      )}
      <button
        type="button"
        className="pdf-toolbar-btn"
        onClick={navigatePrev}
        disabled={results.length === 0}
        title="Previous match (Shift+Enter)"
      >
        &#9650;
      </button>
      <button
        type="button"
        className="pdf-toolbar-btn"
        onClick={navigateNext}
        disabled={results.length === 0}
        title="Next match (Enter)"
      >
        &#9660;
      </button>
      <button
        type="button"
        className="pdf-toolbar-btn"
        onClick={onClose}
        title="Close (Esc)"
      >
        &#10005;
      </button>
    </div>
  );
}
