import { memo, useEffect, useRef, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
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
  const imageModeRef = useRef<"asset" | "data">("asset");

  const displayWidth = widthPts * zoom;
  const displayHeight = heightPts * zoom;

  // Debounce render when zoom changes rapidly (Ctrl+scroll).
  // pageIndex / visibility changes trigger immediately.
  const zoomTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevZoomRef = useRef(zoom);

  useEffect(() => {
    if (!isVisible) {
      return;
    }

    const doRender = () => {
      const key = ++renderKeyRef.current;
      const scale = zoom * window.devicePixelRatio;

      setLoading(true);
      renderPage(pageIndex, scale)
        .then((result) => {
          if (renderKeyRef.current === key) {
            imageModeRef.current = result.data_url ? "data" : "asset";
            setImageSrc(result.data_url ?? convertFileSrc(result.file_path));
            setLoading(false);
          }
        })
        .catch(() => {
          if (renderKeyRef.current === key) {
            setLoading(false);
          }
        });
    };

    // If only zoom changed, debounce to avoid rendering every intermediate step.
    if (prevZoomRef.current !== zoom) {
      prevZoomRef.current = zoom;
      if (zoomTimerRef.current) clearTimeout(zoomTimerRef.current);
      zoomTimerRef.current = setTimeout(doRender, 150);
    } else {
      doRender();
    }

    return () => {
      if (zoomTimerRef.current) clearTimeout(zoomTimerRef.current);
    };
  }, [isVisible, pageIndex, zoom, renderPage]);

  const handleImageError = () => {
    if (!isVisible || imageModeRef.current === "data") {
      setLoading(false);
      return;
    }

    const key = ++renderKeyRef.current;
    const scale = zoom * window.devicePixelRatio;
    setLoading(true);

    renderPage(pageIndex, scale, true)
      .then((result) => {
        if (renderKeyRef.current !== key) {
          return;
        }

        imageModeRef.current = result.data_url ? "data" : "asset";
        setImageSrc(result.data_url ?? convertFileSrc(result.file_path));
        setLoading(false);
      })
      .catch(() => {
        if (renderKeyRef.current === key) {
          setLoading(false);
        }
      });
  };

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
          onError={handleImageError}
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
