import { lazy, Suspense, useState, useCallback, useEffect, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { NoteInfo } from "./types";
import { getFileCategory } from "./types";
import ActivityBar from "./components/ActivityBar";
import Sidebar from "./components/Sidebar";
import { useSemanticResonance } from "./hooks/useSemanticResonance";
import { useResizable } from "./hooks/useResizable";
import { useVaultEntryActions } from "./hooks/useVaultEntryActions";
import { useTruthSystem } from "./hooks/useTruthSystem";
import { useRuntimeSettings } from "./hooks/useRuntimeSettings";
import { useRecentVaults } from "./hooks/useRecentVaults";
import { useLazyModalReady } from "./hooks/useLazyModalReady";
import { useAppShortcuts } from "./hooks/useAppShortcuts";
import ResizeHandle from "./components/ResizeHandle";
import AppTitleBar from "./components/app/AppTitleBar";
import VaultManagerView from "./components/app/VaultManagerView";
import AppStatusBar from "./components/app/AppStatusBar";
const appWindow = getCurrentWindow();
const SemanticSearchModal = lazy(() =>
  import("./components/search").then(module => ({ default: module.SemanticSearchModal }))
);
const GlobalGraphModal = lazy(() =>
  import("./components/global-graph").then(module => ({ default: module.GlobalGraphModal }))
);
const SettingsModal = lazy(() => import("./components/SettingsModal"));
const AIAssistantSidebar = lazy(() => import("./components/AIAssistantSidebar"));
const TruthDashboard = lazy(() => import("./components/TruthDashboard"));
const MarkdownEditor = lazy(() => import("./components/MarkdownEditor"));
const TimelineEditor = lazy(() => import("./components/TimelineEditor"));
const CanvasEditor = lazy(() =>
  import("./components/canvas").then(module => ({ default: module.CanvasEditor }))
);
const SpectroscopyViewer = lazy(() => import("./components/SpectroscopyViewer"));
const MediaViewer = lazy(() =>
  import("./components/media-viewer").then(module => ({ default: module.MediaViewer }))
);

function App() {
  const { runtimeSettings, setRuntimeSettings } = useRuntimeSettings();
  const { recentVaults, saveToRecent } = useRecentVaults();
  const [vaultPath, setVaultPath] = useState<string>("");
  const [notes, setNotes] = useState<NoteInfo[]>([]);
  const [activeNote, setActiveNote] = useState<NoteInfo | null>(null);
  const [noteContent, setNoteContent] = useState<string>("");
  const [liveContent, setLiveContent] = useState<string>("");
  const [binaryPreviewUrl, setBinaryPreviewUrl] = useState<string>("");
  const [error, setError] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [graphOpen, setGraphOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [aiSidebarOpen, setAiSidebarOpen] = useState(true);
  const [truthOpen, setTruthOpen] = useState(false);

  useEffect(() => {
    if (!vaultPath) return;
    let cancelled = false;
    const rescanWithIgnoredFolders = async () => {
      try {
        const refreshed = await invoke<NoteInfo[]>("scan_vault", {
          vaultPath,
          ignoredFolders: runtimeSettings.ignoredFolders || "",
        });
        if (cancelled) return;
        setNotes(refreshed);
        if (activeNote && !refreshed.some(note => note.id === activeNote.id)) {
          setActiveNote(null);
          setNoteContent("");
          setLiveContent("");
        }
      } catch {
        // keep current UI; manual refresh still available
      }
    };
    void rescanWithIgnoredFolders();
    return () => {
      cancelled = true;
    };
  }, [runtimeSettings.ignoredFolders, vaultPath, activeNote]);

  // 左侧侧边栏可拖拽调整宽度（200~480px）
  const { width: sidebarWidth, handleMouseDown: onSidebarDrag } = useResizable({
    initialWidth: 260, minWidth: 200, maxWidth: 480, side: "left",
  });
  // 右侧 AI 助手侧边栏可拖拽调整宽度（240~500px）
  const { width: rightWidth, handleMouseDown: onRightDrag } = useResizable({
    initialWidth: 320, minWidth: 240, maxWidth: 500, side: "right",
  });

  const { relatedNotes, loading: resonanceLoading } = useSemanticResonance(
    liveContent, activeNote?.id ?? null
  );
  const activeCategory = useMemo(
    () => (activeNote ? getFileCategory(activeNote.file_extension) : null),
    [activeNote]
  );

  const { truthState } = useTruthSystem({
    liveContent,
    fileExtension: activeNote?.file_extension ?? null,
    active: !!vaultPath,
  });

  useAppShortcuts({
    vaultLoaded: !!vaultPath,
    onOpenSearch: () => setSearchOpen(true),
    onOpenGraph: () => setGraphOpen(true),
    onToggleAI: () => setAiSidebarOpen(prev => !prev),
    onOpenSettings: () => setSettingsOpen(true),
  });

  const searchModalReady = useLazyModalReady(searchOpen);
  const graphModalReady = useLazyModalReady(graphOpen);
  const settingsModalReady = useLazyModalReady(settingsOpen);
  const truthReady = useLazyModalReady(truthOpen);

  useEffect(() => {
    return () => {
      if (binaryPreviewUrl) {
        URL.revokeObjectURL(binaryPreviewUrl);
      }
    };
  }, [binaryPreviewUrl]);

  function mimeFromExtension(ext: string): string {
    const lower = ext.toLowerCase();
    if (lower === "pdf") return "application/pdf";
    if (lower === "png") return "image/png";
    if (lower === "jpg" || lower === "jpeg") return "image/jpeg";
    if (lower === "gif") return "image/gif";
    if (lower === "svg") return "image/svg+xml";
    if (lower === "webp") return "image/webp";
    if (lower === "bmp") return "image/bmp";
    if (lower === "ico") return "image/x-icon";
    return "application/octet-stream";
  }

  // 通过路径直接打开知识库（用于近期列表点击）
  async function openVaultByPath(path: string) {
    try {
      setError(""); setVaultPath(path); setLoading(true);
      setActiveNote(null); setNoteContent(""); setLiveContent("");
      await invoke("init_vault", { vaultPath: path });
      const result = await invoke<NoteInfo[]>("scan_vault", {
        vaultPath: path,
        ignoredFolders: runtimeSettings.ignoredFolders || "",
      });
      setNotes(result);
      await saveToRecent(path);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); }
  }

  async function handleOpenVault() {
    try {
      setError("");
      const selected = await open({ directory: true, multiple: false });
      if (!selected) return;
      await openVaultByPath(selected);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }

  async function handleSelectNote(note: NoteInfo) {
    try {
      setError(""); setActiveNote(note);
      if (binaryPreviewUrl) {
        URL.revokeObjectURL(binaryPreviewUrl);
        setBinaryPreviewUrl("");
      }
      const category = getFileCategory(note.file_extension);
      if (category === "image" || category === "pdf") {
        setNoteContent("");
        if (category === "pdf") {
          try {
            const indexed = await invoke<string>("read_note_indexed_content", { noteId: note.id });
            setLiveContent(indexed);
          } catch {
            setLiveContent("");
          }
        } else {
          setLiveContent("");
        }
        const bytes = await invoke<number[]>("read_binary_file", { filePath: note.path });
        const uint8 = new Uint8Array(bytes);
        const blob = new Blob([uint8], { type: mimeFromExtension(note.file_extension) });
        const objectUrl = URL.createObjectURL(blob);
        setBinaryPreviewUrl(objectUrl);
      } else {
        const content = await invoke<string>("read_note", { filePath: note.path });
        setNoteContent(content); setLiveContent(content);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setNoteContent(""); setLiveContent("");
    }
  }

  // 返回 Vault Manager 启动页
  function handleBackToManager() {
    setVaultPath("");
    setNotes([]);
    setActiveNote(null);
    setNoteContent("");
    setLiveContent("");
    setError("");
  }

  const handleSave = useCallback(async (markdown: string) => {
    if (!activeNote || !vaultPath) return;
    try { await invoke("write_note", { vaultPath, filePath: activeNote.path, content: markdown }); }
    catch (e) { setError(`保存失败: ${e instanceof Error ? e.message : String(e)}`); }
  }, [activeNote, vaultPath]);

  const {
    handleCreateFile,
    handleDeleteEntry,
    handleMoveEntry,
    handleCreateFolder,
    handleRenameEntryInline,
    handleRenameEntry,
  } = useVaultEntryActions({
    vaultPath,
    ignoredFolders: runtimeSettings.ignoredFolders,
    activeNote,
    setNotes,
    setActiveNote,
    setNoteContent,
    setLiveContent,
    setError,
    onSelectNote: handleSelectNote,
  });

  return (
    <div className="h-screen w-screen workspace-canvas">
      <div className="h-full w-full overflow-hidden flex flex-col">

        {/* ========== Title Bar ========== */}
        <AppTitleBar
          onBackgroundMouseDown={e => {
            if (!(e.target as HTMLElement).closest("button")) {
              void appWindow.startDragging();
            }
          }}
          onBackgroundDoubleClick={e => {
            if (!(e.target as HTMLElement).closest("button")) {
              void appWindow.toggleMaximize();
            }
          }}
          onMinimize={() => appWindow.minimize()}
          onToggleMaximize={() => appWindow.toggleMaximize()}
          onClose={() => appWindow.close()}
        />

        {/* ========== Main Content ========== */}
        <div className="flex flex-1 min-h-0">

          {/* Vault 未加载时隐藏侧边栏，启动页独占全屏 */}
          {!vaultPath ? (
            <VaultManagerView
              recentVaults={recentVaults}
              onOpenRecent={openVaultByPath}
              onOpenVault={handleOpenVault}
              onOpenSettings={() => setSettingsOpen(true)}
            />
          ) : (
            <>
              {/* ===== Activity Bar (窄图标条) ===== */}
              <ActivityBar
                onOpenSearch={() => setSearchOpen(true)}
                onOpenGraph={() => setGraphOpen(true)}
                onToggleAI={() => setAiSidebarOpen(prev => !prev)}
                onCreateCanvas={() => { void handleCreateFile("canvas", ""); }}
                onCreateTimeline={() => { void handleCreateFile("timeline", ""); }}
                onBackToManager={handleBackToManager}
                activePanel="files"
              />

              {/* ===== File Tree Sidebar + Resize Handle ===== */}
              <Sidebar
                vaultPath={vaultPath}
                notes={notes}
                activeNote={activeNote}
                loading={loading}
                width={sidebarWidth}
                onSelectNote={handleSelectNote}
                onCreateFile={handleCreateFile}
                onDeleteEntry={handleDeleteEntry}
                onMoveEntry={handleMoveEntry}
                onRenameEntry={handleRenameEntry}
                onInlineRenameEntry={handleRenameEntryInline}
                onCreateFolder={handleCreateFolder}
              />
              <ResizeHandle side="left" onMouseDown={onSidebarDrag} />

              {/* ===== Main Editor ===== */}
              <main
                className="flex-1 flex flex-col min-w-0 workspace-panel m-0"
              >
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
                          <MarkdownEditor key={activeNote.id} initialContent={noteContent}
                            onSave={handleSave}
                            onContentChange={setLiveContent}
                            vaultPath={vaultPath}
                            fontFamily={runtimeSettings.fontFamily}
                            enableScientific={runtimeSettings.enableScientific}
                          />
                        );
                      }

                      if (activeCategory === "canvas") {
                        return (
                          <CanvasEditor
                            key={activeNote.id}
                            initialContent={noteContent}
                            onSave={handleSave}
                          />
                        );
                      }

                      if (activeCategory === "timeline") {
                        return (
                          <TimelineEditor
                            key={activeNote.id}
                            initialContent={noteContent}
                            onSave={handleSave}
                            notes={notes}
                            onSelectNote={note => {
                              void handleSelectNote(note);
                            }}
                          />
                        );
                      }

                      if (activeCategory === "spectroscopy") {
                        return <SpectroscopyViewer key={activeNote.id} note={activeNote} />;
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
                  /* ===== Vault 已加载但未选笔记 ===== */
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

              {/* ===== Right AI Assistant Sidebar + Resize Handle ===== */}
              {aiSidebarOpen && activeNote && ["markdown", "pdf"].includes(activeCategory ?? "") && (
                <>
                  <ResizeHandle side="right" onMouseDown={onRightDrag} />
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
                      onSelectNote={handleSelectNote}
                      activeNoteId={activeNote?.id}
                    />
                  </Suspense>
                </>
              )}
            </>
          )}
        </div>

        {/* ========== Bottom Status Bar ========== */}
        {vaultPath && (
          <AppStatusBar
            vaultPath={vaultPath}
            truthLevel={truthState.level}
            onOpenTruth={() => setTruthOpen(true)}
            onOpenSettings={() => setSettingsOpen(true)}
          />
        )}
      </div>

      {searchModalReady && (
        <Suspense fallback={null}>
          <SemanticSearchModal open={searchOpen} onClose={() => setSearchOpen(false)} onSelect={handleSelectNote} />
        </Suspense>
      )}
      {graphModalReady && (
        <Suspense fallback={null}>
          <GlobalGraphModal open={graphOpen} onClose={() => setGraphOpen(false)} onNavigate={handleSelectNote} notes={notes} />
        </Suspense>
      )}
      {settingsModalReady && (
        <Suspense fallback={null}>
          <SettingsModal
            open={settingsOpen}
            onClose={() => setSettingsOpen(false)}
            onSettingsApplied={setRuntimeSettings}
          />
        </Suspense>
      )}
      {truthReady && (
        <Suspense fallback={null}>
          <TruthDashboard open={truthOpen} onClose={() => setTruthOpen(false)} state={truthState} />
        </Suspense>
      )}
    </div>
  );
}

export default App;
