import { memo, useEffect, useRef, useState } from "react";
import type { PdfAnnotation } from "../../types/pdf";
import { usePdfRenderer } from "../../hooks/usePdfRenderer";
import PdfTextLayer from "./PdfTextLayer";
import type { TextSelectionInfo } from "./PdfTextLayer";
import PdfAnnotationLayer from "./PdfAnnotationLayer";

interface PdfPageProps {
  pageIndex: number;
  widthPts: number;
  heightPts: number;
  zoom: number;
  isVisible: boolean;
  annotations: PdfAnnotation[];
  onAnnotationClick?: (annotation: PdfAnnotation) => void;
  onTextSelected?: (info: TextSelectionInfo) => void;
}

const PdfPage = memo(function PdfPage({
  pageIndex,
  widthPts,
  heightPts,
  zoom,
  isVisible,
  annotations,
  onAnnotationClick,
  onTextSelected,
}: PdfPageProps) {
  const { renderPage } = usePdfRenderer();
  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const renderKeyRef = useRef(0);

  const displayWidth = widthPts * zoom;
  const displayHeight = heightPts * zoom;

  useEffect(() => {
    if (!isVisible) {
      return;
    }

    const key = ++renderKeyRef.current;
    const scale = zoom * window.devicePixelRatio;

    setLoading(true);
    renderPage(pageIndex, scale)
      .then((result) => {
        if (renderKeyRef.current === key) {
          setImageSrc(result.asset_url);
          setLoading(false);
        }
      })
      .catch(() => {
        if (renderKeyRef.current === key) {
          setLoading(false);
        }
      });
  }, [isVisible, pageIndex, zoom, renderPage]);

  return (
    <div
      className="pdf-page-wrapper"
      style={{ width: `${displayWidth}px`, height: `${displayHeight}px` }}
    >
      {isVisible && imageSrc ? (
        <img
          className="pdf-page-image"
          src={imageSrc}
          alt={`Page ${pageIndex + 1}`}
          style={{ width: `${displayWidth}px`, height: `${displayHeight}px` }}
          draggable={false}
        />
      ) : (
        <div
          className="pdf-page-placeholder"
          style={{ width: `${displayWidth}px`, height: `${displayHeight}px` }}
        >
          {loading ? "" : pageIndex + 1}
        </div>
      )}

      {isVisible && (
        <>
          <PdfTextLayer pageIndex={pageIndex} isVisible={isVisible} onTextSelected={onTextSelected} />
          <PdfAnnotationLayer
            pageIndex={pageIndex}
            annotations={annotations}
            onAnnotationClick={onAnnotationClick}
          />
        </>
      )}
    </div>
  );
});

export default PdfPage;
