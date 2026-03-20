import { useMemo } from "react";
import type { PdfAnnotation } from "../../types/pdf";
import { HIGHLIGHT_COLORS } from "../../types/pdf";

interface PdfAnnotationPanelProps {
  annotations: PdfAnnotation[];
  onClose: () => void;
  onNavigate: (pageNumber: number) => void;
}

const TYPE_LABELS: Record<string, string> = {
  highlight: "\u9AD8\u4EAE",
  note: "\u6279\u6CE8",
  area: "\u533A\u57DF",
};

export default function PdfAnnotationPanel({
  annotations,
  onClose,
  onNavigate,
}: PdfAnnotationPanelProps) {
  // Group annotations by page
  const grouped = useMemo(() => {
    const map = new Map<number, PdfAnnotation[]>();
    for (const a of annotations) {
      const list = map.get(a.pageNumber) ?? [];
      list.push(a);
      map.set(a.pageNumber, list);
    }
    // Sort by page number
    return Array.from(map.entries()).sort(([a], [b]) => a - b);
  }, [annotations]);

  return (
    <div className="pdf-annotation-panel">
      <div className="pdf-annotation-panel-header">
        <span>
          {"\u6279\u6CE8"} ({annotations.length})
        </span>
        <button
          type="button"
          className="pdf-toolbar-btn"
          onClick={onClose}
          title="Close"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>

      {annotations.length === 0 ? (
        <div className="pdf-annotation-panel-empty">
          {"\u6682\u65E0\u6279\u6CE8"}
        </div>
      ) : (
        <div className="pdf-annotation-panel-list">
          {grouped.map(([page, items]) => (
            <div key={page} className="pdf-annotation-panel-group">
              <div className="pdf-annotation-panel-page-label">
                {"\u7B2C"} {page} {"\u9875"}
              </div>
              {items.map((annotation) => (
                <button
                  key={annotation.id}
                  type="button"
                  className="pdf-annotation-panel-item"
                  onClick={() => onNavigate(annotation.pageNumber)}
                >
                  <span
                    className="pdf-annotation-panel-dot"
                    style={{
                      background: HIGHLIGHT_COLORS[annotation.color],
                    }}
                  />
                  <div className="pdf-annotation-panel-item-body">
                    <span className="pdf-annotation-panel-item-type">
                      {TYPE_LABELS[annotation.type] ?? annotation.type}
                    </span>
                    {annotation.selectedText && (
                      <span className="pdf-annotation-panel-item-text">
                        {annotation.selectedText.length > 60
                          ? annotation.selectedText.slice(0, 60) + "..."
                          : annotation.selectedText}
                      </span>
                    )}
                    {annotation.content && (
                      <span className="pdf-annotation-panel-item-note">
                        {annotation.content.length > 40
                          ? annotation.content.slice(0, 40) + "..."
                          : annotation.content}
                      </span>
                    )}
                  </div>
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
