import { useState, useCallback, useEffect } from "react";
import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { LazyStore } from "@tauri-apps/plugin-store";
import type { NoteInfo } from "./types";
import { getFileCategory } from "./types";
import MarkdownEditor from "./components/MarkdownEditor";
import CanvasEditor from "./components/CanvasEditor";
import SemanticSearchModal from "./components/SemanticSearchModal";
import GlobalGraphModal from "./components/GlobalGraphModal";
import ActivityBar from "./components/ActivityBar";
import Sidebar from "./components/Sidebar";
import AIAssistantSidebar from "./components/AIAssistantSidebar";
import SettingsModal from "./components/SettingsModal";
import { useSemanticResonance } from "./hooks/useSemanticResonance";
import { useResizable } from "./hooks/useResizable";
import ResizeHandle from "./components/ResizeHandle";
import logoSvg from "./assets/logo.svg";

/** 近期打开过的知识库记录 */
interface RecentVault {
  name: string;
  path: string;
  openedAt: number; // Unix ms
}

const vaultStore = new LazyStore("vaults.json");

function App() {
  const [vaultPath, setVaultPath] = useState<string>("");
  const [notes, setNotes] = useState<NoteInfo[]>([]);
  const [activeNote, setActiveNote] = useState<NoteInfo | null>(null);
  const [noteContent, setNoteContent] = useState<string>("");
  const [liveContent, setLiveContent] = useState<string>("");
  const [error, setError] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [graphOpen, setGraphOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [aiSidebarOpen, setAiSidebarOpen] = useState(true);
  const [recentVaults, setRecentVaults] = useState<RecentVault[]>([]);

  // 从 Store 加载近期知识库列表
  useEffect(() => {
    vaultStore.get<RecentVault[]>("recentVaults").then(list => {
      if (list) setRecentVaults(list);
    }).catch(() => {});
  }, []);

  // 将路径记录到近期列表并持久化
  async function saveToRecent(path: string) {
    const name = path.split(/[/\\]/).pop() || "Vault";
    const entry: RecentVault = { name, path, openedAt: Date.now() };
    const updated = [entry, ...recentVaults.filter(v => v.path !== path)].slice(0, 10);
    setRecentVaults(updated);
    await vaultStore.set("recentVaults", updated);
    await vaultStore.save();
  }

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

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key === "k") { e.preventDefault(); setSearchOpen(true); }
      if ((e.ctrlKey || e.metaKey) && e.key === "g") { e.preventDefault(); if (vaultPath) setGraphOpen(true); }
      if ((e.ctrlKey || e.metaKey) && e.key === "j") { e.preventDefault(); setAiSidebarOpen(prev => !prev); }
      if ((e.ctrlKey || e.metaKey) && e.key === ",") { e.preventDefault(); setSettingsOpen(true); }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [vaultPath]);

  // 通过路径直接打开知识库（用于近期列表点击）
  async function openVaultByPath(path: string) {
    try {
      setError(""); setVaultPath(path); setLoading(true);
      setActiveNote(null); setNoteContent(""); setLiveContent("");
      await invoke("init_vault", { vaultPath: path });
      const result = await invoke<NoteInfo[]>("scan_vault", { vaultPath: path });
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
      const category = getFileCategory(note.file_extension);
      if (category === "image") {
        setNoteContent(""); setLiveContent("");
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

  const handleCreateFile = useCallback(async (kind: "note" | "canvas") => {
    if (!vaultPath) return;
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const extension = kind === "canvas" ? "canvas" : "md";
    const baseName = kind === "canvas" ? "Untitled Canvas" : "Untitled Note";
    const fileName = `${baseName} ${stamp}.${extension}`;
    const filePath = `${vaultPath.replace(/[\\/]+$/, "")}/${fileName}`;
    const initial = kind === "canvas"
      ? JSON.stringify({ nodes: [], edges: [] }, null, 2)
      : "# Untitled\n";

    try {
      setError("");
      await invoke("write_note", { vaultPath, filePath, content: initial });
      const updated = await invoke<NoteInfo[]>("scan_vault", { vaultPath });
      setNotes(updated);
      const created = updated.find(note => note.path === filePath || note.id.endsWith(fileName));
      if (created) {
        await handleSelectNote(created);
      }
    } catch (e) {
      setError(`新建失败: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, [vaultPath]);

  const handleDeleteEntry = useCallback(async (absolutePath: string, targetLabel: string, isFolder: boolean) => {
    if (!vaultPath) return;
    const ok = window.confirm(
      `确认删除${isFolder ? "文件夹" : "文件"}「${targetLabel}」？\n此操作不可恢复。`
    );
    if (!ok) return;

    try {
      setError("");
      await invoke("delete_entry", { vaultPath, targetPath: absolutePath });

      const updated = await invoke<NoteInfo[]>("scan_vault", { vaultPath });
      setNotes(updated);

      if (activeNote) {
        const normalizedTarget = absolutePath.replace(/\\/g, "/");
        const normalizedActive = activeNote.path.replace(/\\/g, "/");
        const deletedCurrent = normalizedActive === normalizedTarget;
        const deletedUnderFolder = isFolder && normalizedActive.startsWith(`${normalizedTarget}/`);
        if (deletedCurrent || deletedUnderFolder) {
          setActiveNote(null);
          setNoteContent("");
          setLiveContent("");
        }
      }
    } catch (e) {
      setError(`删除失败: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, [vaultPath, activeNote]);

  const appWindow = getCurrentWindow();

  return (
    <div className="h-screen w-screen" style={{ background: "var(--surface-0)" }}>
      <div className="h-full w-full overflow-hidden flex flex-col">

        {/* ========== Title Bar — refined with subtle gradient ========== */}
        <div
          onMouseDown={e => { if (!(e.target as HTMLElement).closest("button")) appWindow.startDragging(); }}
          onDoubleClick={e => { if (!(e.target as HTMLElement).closest("button")) appWindow.toggleMaximize(); }}
          className="h-[32px] min-h-[32px] flex items-center justify-between select-none"
          style={{
            background: "rgba(22,22,24,0.95)",
            borderBottom: "0.5px solid rgba(255,255,255,0.04)",
          }}
        >
          <div className="flex items-center gap-2 pl-4">
            <img src={logoSvg} alt="Logo" className="w-[16px] h-[16px] rounded-[3px]" />
            <span className="text-[12px] font-medium" style={{ color: "var(--text-tertiary)" }}>
              Nexus
            </span>
          </div>
          <div className="flex items-center h-full">
            <button onClick={() => appWindow.minimize()}
              className="h-full w-10 flex items-center justify-center transition-colors duration-150 cursor-pointer hover:bg-white/[0.06] rounded-none"
              style={{ color: "var(--text-tertiary)" }} aria-label="最小化">
              <svg width="10" height="1" viewBox="0 0 10 1" fill="currentColor"><rect width="10" height="1" /></svg>
            </button>
            <button onClick={() => appWindow.toggleMaximize()}
              className="h-full w-10 flex items-center justify-center transition-colors duration-150 cursor-pointer hover:bg-white/[0.06] rounded-none"
              style={{ color: "var(--text-tertiary)" }} aria-label="最大化">
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1"><rect x="0.5" y="0.5" width="9" height="9" rx="1" /></svg>
            </button>
            <button onClick={() => appWindow.close()}
              className="h-full w-12 flex items-center justify-center transition-colors duration-150 cursor-pointer hover:bg-[#ff453a]/90 hover:text-white rounded-none"
              style={{ color: "var(--text-tertiary)" }} aria-label="关闭">
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.2">
                <line x1="1" y1="1" x2="9" y2="9" /><line x1="9" y1="1" x2="1" y2="9" />
              </svg>
            </button>
          </div>
        </div>

        {/* ========== Main Content ========== */}
        <div className="flex flex-1 min-h-0">

          {/* Vault 未加载时隐藏侧边栏，启动页独占全屏 */}
          {!vaultPath ? (
            /* ========== Vault Manager — Obsidian 风格双栏启动页 ========== */
            <div className="flex flex-1 min-h-0">
              {/* ===== 左侧：近期知识库列表 ===== */}
              <aside className="w-64 flex flex-col select-none shrink-0"
                style={{ background: "#202020", borderRight: "0.5px solid rgba(255,255,255,0.06)" }}>
                <div className="px-4 pt-5 pb-3">
                  <span className="text-[11px] font-semibold uppercase tracking-wider"
                    style={{ color: "var(--text-quaternary)" }}>
                    近期知识库
                  </span>
                </div>
                <div className="flex-1 overflow-y-auto">
                  {recentVaults.length === 0 ? (
                    <div className="px-4 py-8">
                      <p className="text-[12px] leading-relaxed" style={{ color: "var(--text-quaternary)" }}>
                        打开一个知识库后，<br />它会出现在这里
                      </p>
                    </div>
                  ) : (
                    recentVaults.map(vault => (
                      <button key={vault.path} type="button"
                        onClick={() => openVaultByPath(vault.path)}
                        className="w-full text-left px-4 py-3 cursor-pointer transition-colors duration-150
                          hover:bg-white/[0.05] flex flex-col gap-1"
                        style={{ borderLeft: "2px solid transparent" }}
                        onMouseEnter={e => { e.currentTarget.style.borderLeftColor = "var(--accent)"; }}
                        onMouseLeave={e => { e.currentTarget.style.borderLeftColor = "transparent"; }}>
                        <span className="text-[13px] font-medium" style={{ color: "var(--text-secondary)" }}>
                          {vault.name}
                        </span>
                        <span className="text-[11px] truncate block" style={{ color: "var(--text-quaternary)" }}>
                          {vault.path}
                        </span>
                      </button>
                    ))
                  )}
                </div>
              </aside>

              {/* ===== 右侧：品牌 + 操作卡片 ===== */}
              <main className="flex-1 flex flex-col items-center justify-center px-8"
                style={{ background: "#1A1A1A" }}>
                <div className="max-w-xl w-full animate-fade-in">
                  {/* 品牌区域 */}
                  <div className="flex flex-col items-center mb-10">
                    <img src={logoSvg} alt="Nexus" className="w-20 h-20 rounded-[18px] mb-4" />
                    <h1 className="text-2xl font-bold" style={{ color: "var(--text-primary)" }}>
                      Nexus
                    </h1>
                    <span className="text-[12px] mt-1" style={{ color: "var(--text-quaternary)" }}>
                      版本 0.1.0
                    </span>
                  </div>

                  {/* 操作卡片组 */}
                  <div className="flex flex-col gap-3 w-full">
                    {/* 卡片 1：打开本地知识库 */}
                    <div className="flex justify-between items-center p-4 rounded-xl transition-colors duration-150
                      hover:bg-white/[0.05]"
                      style={{ background: "rgba(255,255,255,0.03)", border: "0.5px solid rgba(255,255,255,0.06)" }}>
                      <div>
                        <p className="text-[14px] font-medium" style={{ color: "var(--text-secondary)" }}>
                          打开本地知识库
                        </p>
                        <p className="text-[12px] mt-1" style={{ color: "var(--text-quaternary)" }}>
                          将一个本地文件夹作为知识库打开
                        </p>
                      </div>
                      <button type="button" onClick={handleOpenVault}
                        className="px-5 py-1.5 rounded-lg text-[13px] font-medium cursor-pointer
                          transition-colors duration-150 shrink-0 ml-4"
                        style={{
                          background: "var(--accent)",
                          color: "#fff",
                          boxShadow: "0 1px 4px rgba(10,132,255,0.25)",
                        }}>
                        打开
                      </button>
                    </div>

                    {/* 卡片 2：新建知识库 */}
                    <div className="flex justify-between items-center p-4 rounded-xl transition-colors duration-150
                      hover:bg-white/[0.05]"
                      style={{ background: "rgba(255,255,255,0.03)", border: "0.5px solid rgba(255,255,255,0.06)" }}>
                      <div>
                        <p className="text-[14px] font-medium" style={{ color: "var(--text-secondary)" }}>
                          新建知识库
                        </p>
                        <p className="text-[12px] mt-1" style={{ color: "var(--text-quaternary)" }}>
                          在指定文件夹下创建一个新的知识库
                        </p>
                      </div>
                      <button type="button" onClick={handleOpenVault}
                        className="px-5 py-1.5 rounded-lg text-[13px] font-medium cursor-pointer
                          transition-colors duration-150 shrink-0 ml-4
                          hover:brightness-110"
                        style={{
                          background: "#363636",
                          color: "var(--text-secondary)",
                          border: "0.5px solid rgba(255,255,255,0.06)",
                        }}>
                        创建
                      </button>
                    </div>

                    {/* 卡片 3：系统设置 */}
                    <div className="flex justify-between items-center p-4 rounded-xl transition-colors duration-150
                      hover:bg-white/[0.05]"
                      style={{ background: "rgba(255,255,255,0.03)", border: "0.5px solid rgba(255,255,255,0.06)" }}>
                      <div>
                        <p className="text-[14px] font-medium" style={{ color: "var(--text-secondary)" }}>
                          系统设置
                        </p>
                        <p className="text-[12px] mt-1" style={{ color: "var(--text-quaternary)" }}>
                          调整 AI 模型参数与全局偏好
                        </p>
                      </div>
                      <button type="button" onClick={() => setSettingsOpen(true)}
                        className="px-5 py-1.5 rounded-lg text-[13px] font-medium cursor-pointer
                          transition-colors duration-150 shrink-0 ml-4
                          hover:brightness-110"
                        style={{
                          background: "#363636",
                          color: "var(--text-secondary)",
                          border: "0.5px solid rgba(255,255,255,0.06)",
                        }}>
                        设置
                      </button>
                    </div>
                  </div>
                </div>
              </main>
            </div>
          ) : (
            <>
              {/* ===== Activity Bar (窄图标条) ===== */}
              <ActivityBar
                onOpenSearch={() => setSearchOpen(true)}
                onOpenGraph={() => setGraphOpen(true)}
                onToggleAI={() => setAiSidebarOpen(prev => !prev)}
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
              />
              <ResizeHandle side="left" onMouseDown={onSidebarDrag} />

              {/* ===== Main Editor ===== */}
              <main className="flex-1 flex flex-col min-w-0" style={{ background: "var(--surface-0)" }}>
                {error && (
                  <div className="animate-fade-in mx-4 mt-3 px-4 py-2.5 rounded-xl flex items-center gap-2.5 text-[13px]"
                    style={{ background: "rgba(255,69,58,0.08)", border: "0.5px solid rgba(255,69,58,0.12)", color: "#ff453a" }}>
                    <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="12" cy="12" r="10" /><line x1="15" y1="9" x2="9" y2="15" /><line x1="9" y1="9" x2="15" y2="15" />
                    </svg>
                    {error}
                  </div>
                )}

                {activeNote ? (
                  <>
                    <header className="px-10 py-3.5 flex items-center justify-between"
                      style={{ borderBottom: "0.5px solid rgba(255,255,255,0.04)" }}>
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-2 h-2 rounded-full shrink-0"
                          style={{
                            background: "var(--accent)",
                            boxShadow: "0 0 8px rgba(10,132,255,0.4)",
                          }} />
                        <h1 className="text-[15px] font-semibold truncate tracking-[-0.01em]" style={{ color: "var(--text-primary)" }}>
                          {activeNote.name}
                        </h1>
                        <span className="text-[11px] px-2 py-0.5 rounded-lg shrink-0"
                          style={{ background: "rgba(118,118,128,0.1)", color: "var(--text-quaternary)" }}>
                          .{activeNote.file_extension}
                        </span>
                      </div>
                      <span className="text-[11px] shrink-0 ml-4 tabular-nums" style={{ color: "var(--text-quaternary)" }}>
                        {new Date(activeNote.updated_at * 1000).toLocaleString("zh-CN")}
                      </span>
                    </header>

                    {(() => {
                      const category = getFileCategory(activeNote.file_extension);

                      if (category === "markdown") {
                        return (
                          <MarkdownEditor key={activeNote.id} initialContent={noteContent}
                            onSave={handleSave} onContentChange={setLiveContent} vaultPath={vaultPath} />
                        );
                      }

                      if (category === "canvas") {
                        return (
                          <CanvasEditor
                            key={activeNote.id}
                            initialContent={noteContent}
                            onSave={handleSave}
                          />
                        );
                      }

                      if (category === "image") {
                        return (
                          <div className="flex-1 flex items-center justify-center p-8 overflow-auto"
                            style={{ background: "rgba(0,0,0,0.12)" }}>
                            <div className="relative rounded-2xl overflow-hidden max-w-full max-h-full"
                              style={{ boxShadow: "0 8px 40px rgba(0,0,0,0.4)" }}>
                              <img
                                src={convertFileSrc(activeNote.path)}
                                alt={activeNote.name}
                                className="max-w-full max-h-[calc(100vh-160px)] object-contain"
                                style={{ display: "block" }}
                              />
                            </div>
                          </div>
                        );
                      }

                      return (
                        <div className="flex-1 overflow-auto">
                          <pre className="px-10 py-6 text-[13px] leading-relaxed whitespace-pre-wrap break-words"
                            style={{
                              color: "var(--text-secondary)",
                              fontFamily: '"SF Mono", "Fira Code", "Cascadia Code", Consolas, monospace',
                            }}>
                            <code>{noteContent}</code>
                          </pre>
                        </div>
                      );
                    })()}
                  </>
                ) : (
                  /* ===== Vault 已加载但未选笔记 ===== */
                  <div className="flex-1 flex items-center justify-center">
                    <div className="text-center animate-fade-in">
                      <svg className="mx-auto w-10 h-10 mb-5" style={{ color: "var(--text-quaternary)" }}
                        viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"
                        strokeLinecap="round" strokeLinejoin="round">
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                        <polyline points="14 2 14 8 20 8" />
                        <line x1="16" y1="13" x2="8" y2="13" />
                        <line x1="16" y1="17" x2="8" y2="17" />
                      </svg>
                      <p className="text-[14px] font-medium" style={{ color: "var(--text-tertiary)" }}>
                        从左侧选择一篇笔记
                      </p>
                      <p className="text-[12px] mt-2" style={{ color: "var(--text-quaternary)" }}>
                        或按 <kbd className="px-1.5 py-0.5 rounded text-[10px] font-mono"
                          style={{ background: "rgba(118,118,128,0.12)", color: "var(--text-tertiary)" }}>Ctrl+K</kbd> 搜索
                      </p>
                    </div>
                  </div>
                )}
              </main>

              {/* ===== Right AI Assistant Sidebar + Resize Handle ===== */}
              {aiSidebarOpen && activeNote && getFileCategory(activeNote.file_extension) === "markdown" && (
                <>
                  <ResizeHandle side="right" onMouseDown={onRightDrag} />
                  <AIAssistantSidebar
                    width={rightWidth}
                    relatedNotes={relatedNotes}
                    resonanceLoading={resonanceLoading}
                    onSelectNote={handleSelectNote}
                  />
                </>
              )}
            </>
          )}
        </div>

        {/* ========== Bottom Status Bar ========== */}
        {vaultPath && (
          <div className="h-[28px] min-h-[28px] flex items-center justify-between px-3 select-none"
            style={{
              background: "rgba(22,22,24,0.95)",
              borderTop: "0.5px solid rgba(255,255,255,0.04)",
            }}>
            <div className="flex items-center gap-2">
              <svg className="w-3 h-3" style={{ color: "var(--text-quinary)" }}
                viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
              </svg>
              <span className="text-[11px]" style={{ color: "var(--text-quaternary)" }}>
                {vaultPath.split(/[/\\]/).pop()}
              </span>
            </div>
            <div className="flex items-center gap-1">
              <button type="button" onClick={() => setSettingsOpen(true)}
                className="w-6 h-6 rounded-md flex items-center justify-center cursor-pointer
                  transition-colors duration-150 hover:bg-white/[0.06]"
                style={{ color: "var(--text-quaternary)" }}
                title="设置 (Ctrl+,)" aria-label="设置">
                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none"
                  stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="3" />
                  <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
                </svg>
              </button>
            </div>
          </div>
        )}
      </div>

      <SemanticSearchModal open={searchOpen} onClose={() => setSearchOpen(false)} onSelect={handleSelectNote} />
      <GlobalGraphModal open={graphOpen} onClose={() => setGraphOpen(false)} onNavigate={handleSelectNote} notes={notes} />
      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  );
}

export default App;
