import type { AnnotationColor } from "../../types/pdf";
import { HIGHLIGHT_COLORS } from "../../types/pdf";

interface PdfSelectionToolbarProps {
  /** Position in viewport pixels (relative to the pdf-viewer container) */
  x: number;
  y: number;
  onHighlight: (color: AnnotationColor) => void;
  onNote: () => void;
  onCopy: () => void;
}

const COLOR_ORDER: AnnotationColor[] = [
  "yellow",
  "red",
  "green",
  "blue",
  "purple",
];

export default function PdfSelectionToolbar({
  x,
  y,
  onHighlight,
  onNote,
  onCopy,
}: PdfSelectionToolbarProps) {
  return (
    <div
      className="pdf-selection-toolbar"
      style={{ left: `${x}px`, top: `${y}px` }}
    >
      {COLOR_ORDER.map((color) => (
        <button
          key={color}
          type="button"
          className="pdf-selection-color-btn"
          style={{ background: HIGHLIGHT_COLORS[color] }}
          title={color}
          onClick={() => onHighlight(color)}
        />
      ))}
      <div className="pdf-selection-divider" />
      <button
        type="button"
        className="pdf-selection-action-btn"
        title="Add Note"
        onClick={onNote}
      >
        &#128221;
      </button>
      <button
        type="button"
        className="pdf-selection-action-btn"
        title="Copy"
        onClick={onCopy}
      >
        &#128203;
      </button>
    </div>
  );
}
