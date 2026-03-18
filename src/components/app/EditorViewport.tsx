import { lazy, Suspense, useState } from "react";
import type { NoteInfo, FileCategory, MolecularPreviewMeta } from "../../types";
import ResizeHandle from "../ResizeHandle";
import type { RuntimeSettings } from "../settings/settingsTypes";

const AIAssistantSidebar = lazy(() => import("../AIAssistantSidebar"));
const MarkdownEditor = lazy(() => import("../MarkdownEditor"));
const TimelineEditor = lazy(() => import("../TimelineEditor"));
const CanvasEditor = lazy(() =>
  import("../canvas").then(module => ({ default: module.CanvasEditor }))
);
const SpectroscopyViewer = lazy(() => import("../SpectroscopyViewer"));
const MolecularViewer3D = lazy(() => import("../MolecularViewer3D"));
const SymmetryViewer3D = lazy(() => import("../SymmetryViewer3D"));
const MediaViewer = lazy(() =>
  import("../media-viewer").then(module => ({ default: module.MediaViewer }))
);

interface EditorViewportProps {
  error: string;
  vaultPath: string;
  notes: NoteInfo[];
  activeNote: NoteInfo | null;
  activeCategory: FileCategory | null;
  noteContent: string;
  molecularPreview: MolecularPreviewMeta | null;
  binaryPreviewUrl: string;
  runtimeSettings: RuntimeSettings;
  aiSidebarOpen: boolean;
  rightWidth: number;
  relatedNotes: NoteInfo[];
  resonanceLoading: boolean;
  onRightResizeMouseDown: (e: React.MouseEvent<Element>) => void;
  onSave: (markdown: string) => void | Promise<void>;
  onLiveContentChange: (content: string) => void;
  onSelectNote: (note: NoteInfo) => void | Promise<void>;
}

type MolecularViewMode = "structure" | "symmetry";

export default function EditorViewport({
  error,
  vaultPath,
  notes,
  activeNote,
  activeCategory,
  noteContent,
  molecularPreview,
  binaryPreviewUrl,
  runtimeSettings,
  aiSidebarOpen,
  rightWidth,
  relatedNotes,
  resonanceLoading,
  onRightResizeMouseDown,
  onSave,
  onLiveContentChange,
  onSelectNote,
}: EditorViewportProps) {
  const [molecularViewMode, setMolecularViewMode] = useState<MolecularViewMode>("structure");

  return (
    <>
      <main className="flex-1 flex flex-col min-w-0 workspace-panel m-0">
        {error && (
          <div
            className="animate-fade-in mx-4 mt-3 px-4 py-2.5 rounded-xl flex items-center gap-2.5 text-[13px]
              bg-[rgba(255,69,58,0.08)] border-[0.5px] border-[rgba(255,69,58,0.12)] text-[#ff453a]"
          >
            <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" /><line x1="15" y1="9" x2="9" y2="15" /><line x1="9" y1="9" x2="15" y2="15" />
            </svg>
            {error}
          </div>
        )}

        {activeNote ? (
          <>
            <header className="mx-0 mt-0 px-6 py-2.5 flex items-center justify-between border-b-[0.5px] border-b-[var(--panel-border)]"
              style={{ background: "var(--subtle-surface)" }}>
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-2 h-2 rounded-full shrink-0 bg-[var(--accent)] shadow-[0_0_8px_rgba(10,132,255,0.4)]" />
                <h1 className="text-[15px] font-semibold truncate tracking-[-0.01em] text-[var(--text-primary)]">
                  {activeNote.name}
                </h1>
                <span className="text-[11px] px-2 py-0.5 rounded-lg shrink-0 bg-[var(--subtle-surface-strong)] text-[var(--text-quaternary)]">
                  .{activeNote.file_extension}
                </span>
              </div>
              <span className="text-[11px] shrink-0 ml-4 tabular-nums text-[var(--text-quaternary)]">
                {new Date(activeNote.updated_at * 1000).toLocaleString("zh-CN")}
              </span>
            </header>

            <Suspense fallback={<div className="flex-1" />}>
              {(() => {
                if (activeCategory === "markdown") {
                  return (
                    <MarkdownEditor
                      key={activeNote.id}
                      initialContent={noteContent}
                      onSave={onSave}
                      onContentChange={onLiveContentChange}
                      vaultPath={vaultPath}
                      fontFamily={runtimeSettings.fontFamily}
                      enableScientific={runtimeSettings.enableScientific || runtimeSettings.activeDiscipline === "chemistry"}
                      activeDiscipline={runtimeSettings.activeDiscipline}
                    />
                  );
                }

                if (activeCategory === "canvas") {
                  return (
                    <CanvasEditor
                      key={activeNote.id}
                      initialContent={noteContent}
                      onSave={onSave}
                    />
                  );
                }

                if (activeCategory === "timeline") {
                  return (
                    <TimelineEditor
                      key={activeNote.id}
                      initialContent={noteContent}
                      onSave={onSave}
                      notes={notes}
                      onSelectNote={note => {
                        void onSelectNote(note);
                      }}
                    />
                  );
                }

                if (activeCategory === "spectroscopy") {
                  return <SpectroscopyViewer key={activeNote.id} note={activeNote} />;
                }

                if (activeCategory === "molecular") {
                  // Chemistry mode: 3D WebGL viewer with structure/symmetry toggle
                  if (runtimeSettings.activeDiscipline === "chemistry") {
                    return (
                      <div className="flex-1 flex flex-col min-h-0">
                        {/* 结构 / 对称性 视图切换 */}
                        <div className="flex items-center gap-0 px-4 py-1.5 border-b-[0.5px] border-b-[var(--panel-border)]"
                          style={{ background: "var(--subtle-surface)" }}>
                          <button
                            type="button"
                            onClick={() => setMolecularViewMode("structure")}
                            className={`px-3 py-1 rounded-l-md text-[11px] font-medium cursor-pointer transition-colors border
                              ${molecularViewMode === "structure"
                                ? "bg-[var(--accent)] border-[var(--accent)] text-white"
                                : "bg-transparent border-[var(--panel-border)] text-[var(--text-quaternary)] hover:text-[var(--text-tertiary)]"
                              }`}
                          >
                            结构
                          </button>
                          <button
                            type="button"
                            onClick={() => setMolecularViewMode("symmetry")}
                            className={`px-3 py-1 rounded-r-md text-[11px] font-medium cursor-pointer transition-colors border border-l-0
                              ${molecularViewMode === "symmetry"
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
                  return (
                    <div className="flex-1 overflow-auto">
                      <pre className="px-10 py-6 text-[13px] leading-relaxed whitespace-pre-wrap break-words
                        text-[var(--text-secondary)] font-mono">
                        <code>{noteContent}</code>
                      </pre>
                    </div>
                  );
                }

                if (activeCategory === "image") {
                  return <MediaViewer category="image" note={activeNote} binaryPreviewUrl={binaryPreviewUrl} />;
                }

                if (activeCategory === "pdf") {
                  return <MediaViewer category="pdf" note={activeNote} binaryPreviewUrl={binaryPreviewUrl} />;
                }

                return (
                  <div className="flex-1 overflow-auto">
                    <pre className="px-10 py-6 text-[13px] leading-relaxed whitespace-pre-wrap break-words
                      text-[var(--text-secondary)] font-mono">
                      <code>{noteContent}</code>
                    </pre>
                  </div>
                );
              })()}
            </Suspense>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center animate-fade-in">
              <svg className="mx-auto w-10 h-10 mb-5 text-[var(--text-quaternary)]"
                viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"
                strokeLinecap="round" strokeLinejoin="round">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
                <line x1="16" y1="13" x2="8" y2="13" />
                <line x1="16" y1="17" x2="8" y2="17" />
              </svg>
              <p className="text-[14px] font-medium text-[var(--text-tertiary)]">
                从左侧选择一篇笔记
              </p>
              <p className="text-[12px] mt-2 text-[var(--text-quaternary)]">
                或按 <kbd className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-[rgba(118,118,128,0.12)] text-[var(--text-tertiary)]">Ctrl+K</kbd> 搜索
              </p>
            </div>
          </div>
        )}
      </main>

      {aiSidebarOpen && activeNote && ["markdown", "pdf"].includes(activeCategory ?? "") && (
        <>
          <ResizeHandle side="right" onMouseDown={onRightResizeMouseDown} />
          <Suspense
            fallback={
              <aside
                className="workspace-panel border-l-[0.5px] border-l-[var(--panel-border)]"
                style={{ width: `${rightWidth}px`, minWidth: `${rightWidth}px` }}
              />
            }
          >
            <AIAssistantSidebar
              width={rightWidth}
              relatedNotes={relatedNotes}
              resonanceLoading={resonanceLoading}
              onSelectNote={onSelectNote}
              activeNoteId={activeNote?.id}
            />
          </Suspense>
        </>
      )}
    </>
  );
}
