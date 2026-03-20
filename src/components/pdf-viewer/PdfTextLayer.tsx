import { memo, useEffect, useRef, useState } from "react";
import type { WordInfo } from "../../types/pdf";
import { usePdfRenderer } from "../../hooks/usePdfRenderer";

interface PdfTextLayerProps {
  pageIndex: number;
  isVisible: boolean;
}

const PdfTextLayer = memo(function PdfTextLayer({
  pageIndex,
  isVisible,
}: PdfTextLayerProps) {
  const { getPageText } = usePdfRenderer();
  const [words, setWords] = useState<WordInfo[]>([]);
  const requestKeyRef = useRef(0);

  useEffect(() => {
    if (!isVisible) {
      return;
    }

    const key = ++requestKeyRef.current;

    getPageText(pageIndex)
      .then((data) => {
        if (requestKeyRef.current === key) {
          setWords(data.words);
        }
      })
      .catch(() => {
        // Text extraction is optional — silently ignore failures
      });
  }, [isVisible, pageIndex, getPageText]);

  if (words.length === 0) {
    return null;
  }

  return (
    <div className="pdf-text-layer">
      {words.map((w, i) => (
        <span
          key={i}
          style={{
            left: `${w.rect.x * 100}%`,
            top: `${w.rect.y * 100}%`,
            width: `${w.rect.w * 100}%`,
            height: `${w.rect.h * 100}%`,
            fontSize: `${w.rect.h * 100}%`,
          }}
        >
          {w.word}
        </span>
      ))}
    </div>
  );
});

export default PdfTextLayer;
