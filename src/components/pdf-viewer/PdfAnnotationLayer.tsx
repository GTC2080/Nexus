import { memo } from "react";
import type { PdfAnnotation } from "../../types/pdf";
import { HIGHLIGHT_COLORS } from "../../types/pdf";

interface PdfAnnotationLayerProps {
  pageIndex: number;
  annotations: PdfAnnotation[];
  onAnnotationClick?: (annotation: PdfAnnotation) => void;
}

const PdfAnnotationLayer = memo(function PdfAnnotationLayer({
  pageIndex,
  annotations,
  onAnnotationClick,
}: PdfAnnotationLayerProps) {
  // Annotations use 1-based pageNumber; pageIndex is 0-based
  const pageAnnotations = annotations.filter(
    (a) => a.pageNumber === pageIndex + 1,
  );

  if (pageAnnotations.length === 0) {
    return null;
  }

  return (
    <div className="pdf-annotation-layer">
      {pageAnnotations.map((annotation) => {
        if (annotation.type === "area" && annotation.area) {
          const r = annotation.area;
          return (
            <div
              key={annotation.id}
              className="pdf-annotation-highlight pdf-annotation-area"
              style={{
                left: `${r.x * 100}%`,
                top: `${r.y * 100}%`,
                width: `${r.w * 100}%`,
                height: `${r.h * 100}%`,
                border: `2px dashed ${HIGHLIGHT_COLORS[annotation.color]}`,
                background: "transparent",
              }}
              onClick={() => onAnnotationClick?.(annotation)}
            />
          );
        }

        // Text highlight — render a div per rect
        if (annotation.textRanges) {
          return annotation.textRanges.map((range, ri) =>
            range.rects.map((rect, rj) => (
              <div
                key={`${annotation.id}-${ri}-${rj}`}
                className="pdf-annotation-highlight"
                style={{
                  left: `${rect.x * 100}%`,
                  top: `${rect.y * 100}%`,
                  width: `${rect.w * 100}%`,
                  height: `${rect.h * 100}%`,
                  background: HIGHLIGHT_COLORS[annotation.color],
                }}
                onClick={() => onAnnotationClick?.(annotation)}
              />
            )),
          );
        }

        return null;
      })}
    </div>
  );
});

export default PdfAnnotationLayer;
