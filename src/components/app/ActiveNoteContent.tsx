import { lazy, Suspense, useMemo, useState } from "react";
import type { FileCategory, MolecularPreviewMeta, NoteInfo } from "../../types";
import type { RuntimeSettings } from "../settings/settingsTypes";

const MarkdownEditor = lazy(() => import("../MarkdownEditor"));
const PublishStudio = lazy(() => import("../publish-studio"));
const CanvasEditor = lazy(() =>
  import("../canvas").then(module => ({ default: module.CanvasEditor }))
);
const SpectroscopyViewer = lazy(() => import("../SpectroscopyViewer"));
const MolecularViewer3D = lazy(() => import("../MolecularViewer3D"));
const SymmetryViewer3D = lazy(() => import("../SymmetryViewer3D"));
const MediaViewer = lazy(() =>
  import("../media-viewer").then(module => ({ default: module.MediaViewer }))
);

interface ActiveNoteContentProps {
  vaultPath: string;
  notes: NoteInfo[];
  activeNote: NoteInfo;
  activeCategory: FileCategory | null;
  noteContent: string;
  molecularPreview: MolecularPreviewMeta | null;
  binaryPreviewUrl: string;
  runtimeSettings: RuntimeSettings;
  onSave: (markdown: string) => void | Promise<void>;
  onLiveContentChange: (content: string) => void;
}

type MolecularViewMode = "structure" | "symmetry";

function PlainTextContent({ noteContent }: { noteContent: string }) {
  return (
    <div className="flex-1 overflow-auto">
      <pre
        className="px-10 py-6 text-[13px] leading-relaxed whitespace-pre-wrap break-words
          text-[var(--text-secondary)] font-mono"
      >
        <code>{noteContent}</code>
      </pre>
    </div>
  );
}

function MolecularContent({
  activeNote,
  noteContent,
  molecularPreview,
  runtimeSettings,
}: Pick<ActiveNoteContentProps, "activeNote" | "noteContent" | "molecularPreview" | "runtimeSettings">) {
  const [molecularViewMode, setMolecularViewMode] = useState<MolecularViewMode>("structure");

  if (runtimeSettings.activeDiscipline !== "chemistry") {
    return <PlainTextContent noteContent={noteContent} />;
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div
        className="flex items-center gap-0 px-4 py-1.5 border-b-[0.5px] border-b-[var(--panel-border)]"
        style={{ background: "var(--subtle-surface)" }}
      >
        <button
          type="button"
          onClick={() => setMolecularViewMode("structure")}
          className={`px-3 py-1 rounded-l-md text-[11px] font-medium cursor-pointer transition-colors border ${
            molecularViewMode === "structure"
              ? "bg-[var(--accent)] border-[var(--accent)] text-white"
              : "bg-transparent border-[var(--panel-border)] text-[var(--text-quaternary)] hover:text-[var(--text-tertiary)]"
          }`}
        >
          结构
        </button>
        <button
          type="button"
          onClick={() => setMolecularViewMode("symmetry")}
          className={`px-3 py-1 rounded-r-md text-[11px] font-medium cursor-pointer transition-colors border border-l-0 ${
            molecularViewMode === "symmetry"
              ? "bg-[var(--accent)] border-[var(--accent)] text-white"
              : "bg-transparent border-[var(--panel-border)] text-[var(--text-quaternary)] hover:text-[var(--text-tertiary)]"
          }`}
        >
          对称性
        </button>
      </div>

      {molecularViewMode === "structure" ? (
        <MolecularViewer3D
          key={`struct-${activeNote.id}`}
          data={noteContent}
          format={activeNote.file_extension}
          filePath={activeNote.path}
          previewMeta={molecularPreview}
        />
      ) : (
        <SymmetryViewer3D
          key={`sym-${activeNote.id}`}
          data={noteContent}
          format={activeNote.file_extension}
          filePath={activeNote.path}
        />
      )}
    </div>
  );
}

export default function ActiveNoteContent({
  vaultPath,
  notes,
  activeNote,
  activeCategory,
  noteContent,
  molecularPreview,
  binaryPreviewUrl,
  runtimeSettings,
  onSave,
  onLiveContentChange,
}: ActiveNoteContentProps) {
  const renderedContent = useMemo(() => {
    switch (activeCategory) {
      case "markdown":
        return (
          <MarkdownEditor
            key={activeNote.id}
            initialContent={noteContent}
            onSave={onSave}
            onContentChange={onLiveContentChange}
            vaultPath={vaultPath}
            fontFamily={runtimeSettings.fontFamily}
            enableScientific={
              runtimeSettings.enableScientific || runtimeSettings.activeDiscipline === "chemistry"
            }
            activeDiscipline={runtimeSettings.activeDiscipline}
          />
        );
      case "canvas":
        return (
          <CanvasEditor
            key={activeNote.id}
            initialContent={noteContent}
            onSave={onSave}
            activeDiscipline={runtimeSettings.activeDiscipline}
          />
        );
      case "paper":
        return (
          <PublishStudio
            key={activeNote.id}
            notes={notes}
            initialContent={noteContent}
            onSave={onSave}
          />
        );
      case "spectroscopy":
        return <SpectroscopyViewer key={activeNote.id} note={activeNote} />;
      case "molecular":
        return (
          <MolecularContent
            activeNote={activeNote}
            noteContent={noteContent}
            molecularPreview={molecularPreview}
            runtimeSettings={runtimeSettings}
          />
        );
      case "image":
        return <MediaViewer category="image" note={activeNote} binaryPreviewUrl={binaryPreviewUrl} />;
      case "pdf":
        return <MediaViewer category="pdf" note={activeNote} binaryPreviewUrl={binaryPreviewUrl} />;
      default:
        return <PlainTextContent noteContent={noteContent} />;
    }
  }, [
    activeCategory,
    activeNote,
    binaryPreviewUrl,
    molecularPreview,
    noteContent,
    notes,
    onLiveContentChange,
    onSave,
    runtimeSettings,
    vaultPath,
  ]);

  return <Suspense fallback={<div className="flex-1" />}>{renderedContent}</Suspense>;
}
