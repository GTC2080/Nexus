import { useState, useMemo } from "react";
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
import { useVaultSession } from "./hooks/useVaultSession";
import { useWindowControls } from "./hooks/useWindowControls";
import ResizeHandle from "./components/ResizeHandle";
import AppTitleBar from "./components/app/AppTitleBar";
import VaultManagerView from "./components/app/VaultManagerView";
import AppStatusBar from "./components/app/AppStatusBar";
import EditorViewport from "./components/app/EditorViewport";
import AppModals from "./components/app/AppModals";

function App() {
  const { runtimeSettings, setRuntimeSettings } = useRuntimeSettings();
  const { recentVaults, saveToRecent, removeFromRecent } = useRecentVaults();
  const {
    vaultPath,
    notes,
    activeNote,
    noteContent,
    liveContent,
    molecularPreview,
    binaryPreviewUrl,
    error,
    loading,
    setNotes,
    setActiveNote,
    setNoteContent,
    setLiveContent,
    setError,
    openVaultByPath,
    handleOpenVault,
    handleSelectNote,
    handleBackToManager,
    handleSave,
  } = useVaultSession({
    ignoredFolders: runtimeSettings.ignoredFolders,
    activeDiscipline: runtimeSettings.activeDiscipline,
    onSaveToRecent: saveToRecent,
  });
  const [searchOpen, setSearchOpen] = useState(false);
  const [graphOpen, setGraphOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [aiSidebarOpen, setAiSidebarOpen] = useState(true);
  const [truthOpen, setTruthOpen] = useState(false);
  const windowControls = useWindowControls();

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
          onBackgroundMouseDown={windowControls.onBackgroundMouseDown}
          onBackgroundDoubleClick={windowControls.onBackgroundDoubleClick}
          onMinimize={windowControls.onMinimize}
          onToggleMaximize={windowControls.onToggleMaximize}
          onClose={windowControls.onClose}
        />

        {/* ========== Main Content ========== */}
        <div className="flex flex-1 min-h-0">

          {/* Vault 未加载时隐藏侧边栏，启动页独占全屏 */}
          {!vaultPath ? (
            <VaultManagerView
              recentVaults={recentVaults}
              onOpenRecent={openVaultByPath}
              onRemoveRecent={removeFromRecent}
              onOpenVault={handleOpenVault}
              onOpenSettings={() => setSettingsOpen(true)}
              onOpenTruth={() => setTruthOpen(true)}
            />
          ) : (
            <>
              {/* ===== Activity Bar (窄图标条) ===== */}
              <ActivityBar
                onOpenSearch={() => setSearchOpen(true)}
                onOpenGraph={() => setGraphOpen(true)}
                onToggleAI={() => setAiSidebarOpen(prev => !prev)}
                onCreateCanvas={() => { void handleCreateFile("canvas", ""); }}
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

              <EditorViewport
                error={error}
                vaultPath={vaultPath}
                notes={notes}
                activeNote={activeNote}
                activeCategory={activeCategory}
                noteContent={noteContent}
                molecularPreview={molecularPreview}
                binaryPreviewUrl={binaryPreviewUrl}
                runtimeSettings={runtimeSettings}
                aiSidebarOpen={aiSidebarOpen}
                rightWidth={rightWidth}
                relatedNotes={relatedNotes}
                resonanceLoading={resonanceLoading}
                onRightResizeMouseDown={onRightDrag}
                onSave={handleSave}
                onLiveContentChange={setLiveContent}
                onSelectNote={handleSelectNote}
              />
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

      <AppModals
        searchModalReady={searchModalReady}
        searchOpen={searchOpen}
        graphModalReady={graphModalReady}
        graphOpen={graphOpen}
        settingsModalReady={settingsModalReady}
        settingsOpen={settingsOpen}
        truthReady={truthReady}
        truthOpen={truthOpen}
        notes={notes}
        truthState={truthState}
        onCloseSearch={() => setSearchOpen(false)}
        onCloseGraph={() => setGraphOpen(false)}
        onCloseSettings={() => setSettingsOpen(false)}
        onCloseTruth={() => setTruthOpen(false)}
        onSelectNote={handleSelectNote}
        onSettingsApplied={setRuntimeSettings}
      />
    </div>
  );
}

export default App;
