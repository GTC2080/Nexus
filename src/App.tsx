import { useState, useCallback, useEffect, useRef } from "react";
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
  const [binaryPreviewUrl, setBinaryPreviewUrl] = useState<string>("");
  const [imageZoom, setImageZoom] = useState<number>(1);
  const [imageNaturalSize, setImageNaturalSize] = useState<{ width: number; height: number } | null>(null);
  const [imageViewportSize, setImageViewportSize] = useState<{ width: number; height: number }>({ width: 0, height: 0 });
  const [imagePanning, setImagePanning] = useState(false);
  const imageViewportRef = useRef<HTMLDivElement | null>(null);
  const imagePanRef = useRef({
    active: false,
    startX: 0,
    startY: 0,
    startScrollLeft: 0,
    startScrollTop: 0,
  });
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

  function clampZoom(value: number): number {
    return Math.min(5, Math.max(0.2, value));
  }

  useEffect(() => {
    function handleWindowMouseMove(e: MouseEvent) {
      if (!imagePanRef.current.active) return;
      const viewport = imageViewportRef.current;
      if (!viewport) return;
      const dx = e.clientX - imagePanRef.current.startX;
      const dy = e.clientY - imagePanRef.current.startY;
      viewport.scrollLeft = imagePanRef.current.startScrollLeft - dx;
      viewport.scrollTop = imagePanRef.current.startScrollTop - dy;
    }

    function handleWindowMouseUp() {
      if (!imagePanRef.current.active) return;
      imagePanRef.current.active = false;
      setImagePanning(false);
    }

    window.addEventListener("mousemove", handleWindowMouseMove);
    window.addEventListener("mouseup", handleWindowMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleWindowMouseMove);
      window.removeEventListener("mouseup", handleWindowMouseUp);
    };
  }, []);

  useEffect(() => {
    const viewport = imageViewportRef.current;
    if (!viewport) return;
    const updateSize = () => {
      setImageViewportSize({
        width: viewport.clientWidth,
        height: viewport.clientHeight,
      });
    };
    updateSize();

    const observer = new ResizeObserver(updateSize);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [activeNote?.id]);

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
      setImageZoom(1);
      setImageNaturalSize(null);
      if (binaryPreviewUrl) {
        URL.revokeObjectURL(binaryPreviewUrl);
        setBinaryPreviewUrl("");
      }
      const category = getFileCategory(note.file_extension);
      if (category === "image" || category === "pdf") {
        setNoteContent(""); setLiveContent("");
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

  const handleMoveEntry = useCallback(async (sourceRelativePath: string, destFolderRelativePath: string) => {
    if (!vaultPath) return;
    const normalizedVault = vaultPath.replace(/[\\/]+$/, "");
    const sourcePath = `${normalizedVault}/${sourceRelativePath}`;
    const destFolder = destFolderRelativePath
      ? `${normalizedVault}/${destFolderRelativePath}`
      : normalizedVault;

    try {
      setError("");
      await invoke("move_entry", { vaultPath, sourcePath, destFolder });
      const updated = await invoke<NoteInfo[]>("scan_vault", { vaultPath });
      setNotes(updated);

      // If the active note was moved, update its reference
      if (activeNote) {
        const oldId = activeNote.id.replace(/\\/g, "/");
        const sourceName = sourceRelativePath.split("/").pop() || "";
        const newPrefix = destFolderRelativePath ? `${destFolderRelativePath}/` : "";
        const newId = `${newPrefix}${sourceName}`;
        if (oldId === sourceRelativePath || oldId.startsWith(sourceRelativePath + "/")) {
          const suffix = oldId.substring(sourceRelativePath.length);
          const updatedId = `${newId}${suffix}`;
          const found = updated.find(n => n.id.replace(/\\/g, "/") === updatedId);
          if (found) await handleSelectNote(found);
        }
      }
    } catch (e) {
      setError(`移动失败: ${e instanceof Error ? e.message : String(e)}`);
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
                onCreateCanvas={() => { void handleCreateFile("canvas"); }}
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
                        const viewportInnerWidth = Math.max(0, imageViewportSize.width - 64);
                        const viewportInnerHeight = Math.max(0, imageViewportSize.height - 64);
                        const fitScale = imageNaturalSize && viewportInnerWidth > 0 && viewportInnerHeight > 0
                          ? Math.min(
                            viewportInnerWidth / imageNaturalSize.width,
                            viewportInnerHeight / imageNaturalSize.height,
                            1
                          )
                          : 1;
                        const effectiveScale = fitScale * imageZoom;
                        const renderedWidth = imageNaturalSize
                          ? Math.max(1, Math.round(imageNaturalSize.width * effectiveScale))
                          : 0;
                        const renderedHeight = imageNaturalSize
                          ? Math.max(1, Math.round(imageNaturalSize.height * effectiveScale))
                          : 0;
                        const canPan = renderedWidth > viewportInnerWidth || renderedHeight > viewportInnerHeight;

                        return (
                          <div
                            ref={imageViewportRef}
                            className="flex-1 overflow-auto relative"
                            style={{ background: "rgba(0,0,0,0.12)" }}
                            onWheel={e => {
                              e.preventDefault();
                              const step = e.deltaY > 0 ? -0.1 : 0.1;
                              setImageZoom(prev => clampZoom(prev + step));
                            }}
                            onMouseDown={e => {
                              if (!canPan || e.button !== 0) return;
                              const viewport = imageViewportRef.current;
                              if (!viewport) return;
                              imagePanRef.current.active = true;
                              imagePanRef.current.startX = e.clientX;
                              imagePanRef.current.startY = e.clientY;
                              imagePanRef.current.startScrollLeft = viewport.scrollLeft;
                              imagePanRef.current.startScrollTop = viewport.scrollTop;
                              setImagePanning(true);
                            }}
                          >
                            <div className="absolute right-6 top-6 z-10 flex items-center gap-1 rounded-lg px-1.5 py-1"
                              style={{ background: "rgba(0,0,0,0.72)", border: "1px solid rgba(255,255,255,0.12)" }}>
                              <button
                                type="button"
                                className="w-7 h-7 rounded text-white/90 hover:bg-white/10"
                                onClick={() => setImageZoom(prev => clampZoom(prev - 0.1))}
                                aria-label="缩小"
                              >
                                -
                              </button>
                              <span className="text-[11px] px-1.5 text-white/80 tabular-nums">
                                {Math.round(imageZoom * 100)}%
                              </span>
                              <button
                                type="button"
                                className="w-7 h-7 rounded text-white/90 hover:bg-white/10"
                                onClick={() => setImageZoom(prev => clampZoom(prev + 0.1))}
                                aria-label="放大"
                              >
                                +
                              </button>
                              <button
                                type="button"
                                className="h-7 px-2 rounded text-[11px] text-white/90 hover:bg-white/10"
                                onClick={() => {
                                  setImageZoom(1);
                                  const viewport = imageViewportRef.current;
                                  if (viewport) {
                                    viewport.scrollTo({ left: 0, top: 0, behavior: "smooth" });
                                  }
                                }}
                              >
                                复位
                              </button>
                            </div>
                            <div className="min-h-full min-w-full p-8 box-border flex items-center justify-center">
                              {binaryPreviewUrl ? (
                                <div
                                  style={{
                                    width: `${Math.max(renderedWidth, viewportInnerWidth)}px`,
                                    height: `${Math.max(renderedHeight, viewportInnerHeight)}px`,
                                  }}
                                  className="flex items-center justify-center"
                                >
                                  <img
                                    src={binaryPreviewUrl}
                                    alt={activeNote.name}
                                    draggable={false}
                                    onLoad={e => {
                                      const target = e.currentTarget;
                                      if (target.naturalWidth && target.naturalHeight) {
                                        setImageNaturalSize({
                                          width: target.naturalWidth,
                                          height: target.naturalHeight,
                                        });
                                      }
                                    }}
                                    style={{
                                      display: "block",
                                      maxWidth: "none",
                                      maxHeight: "none",
                                      width: renderedWidth > 0 ? `${renderedWidth}px` : "auto",
                                      height: renderedHeight > 0 ? `${renderedHeight}px` : "auto",
                                      borderRadius: "16px",
                                      boxShadow: "0 8px 40px rgba(0,0,0,0.4)",
                                      transition: "width 120ms ease-out, height 120ms ease-out",
                                      cursor: canPan ? (imagePanning ? "grabbing" : "grab") : "default",
                                      userSelect: "none",
                                    }}
                                  />
                                </div>
                              ) : (
                                <div className="text-white/70 text-[13px] px-8 py-6">正在加载图片...</div>
                              )}
                            </div>
                          </div>
                        );
                      }

                      if (category === "pdf") {
                        return (
                          <div className="flex-1 overflow-hidden p-4" style={{ background: "rgba(0,0,0,0.18)" }}>
                            {binaryPreviewUrl ? (
                              <object
                                data={binaryPreviewUrl}
                                type="application/pdf"
                                className="w-full h-full rounded-xl"
                                style={{
                                  border: "0.5px solid rgba(255,255,255,0.1)",
                                  background: "rgba(0,0,0,0.55)",
                                }}
                              >
                                <div className="h-full flex items-center justify-center">
                                  <button
                                    type="button"
                                    onClick={() => window.open(convertFileSrc(activeNote.path), "_blank")}
                                    className="px-4 py-2 rounded-md border border-white/20 text-white/90 hover:bg-white/10"
                                  >
                                    当前环境无法内嵌预览，点击外部打开 PDF
                                  </button>
                                </div>
                              </object>
                            ) : (
                              <div className="h-full flex items-center justify-center text-white/70 text-[13px]">
                                正在加载 PDF...
                              </div>
                            )}
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
