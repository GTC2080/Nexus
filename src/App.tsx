import { lazy, Suspense, useState, useMemo } from "react";
import { getFileCategory } from "./types";
import { useVaultEntryActions } from "./hooks/useVaultEntryActions";
import { useTruthSystem } from "./hooks/useTruthSystem";
import { useRuntimeSettings } from "./hooks/useRuntimeSettings";
import { useRecentVaults } from "./hooks/useRecentVaults";
import { useLazyModalReady } from "./hooks/useLazyModalReady";
import { useAppShortcuts } from "./hooks/useAppShortcuts";
import { useVaultSession } from "./hooks/useVaultSession";
import { useWindowControls } from "./hooks/useWindowControls";
import AppTitleBar from "./components/app/AppTitleBar";
import VaultManagerView from "./components/app/VaultManagerView";
import AppModals from "./components/app/AppModals";

const WorkspaceShell = lazy(() => import("./components/app/WorkspaceShell"));

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
        {!vaultPath ? (
          <div className="flex flex-1 min-h-0">
            <VaultManagerView
              recentVaults={recentVaults}
              onOpenRecent={openVaultByPath}
              onRemoveRecent={removeFromRecent}
              onOpenVault={handleOpenVault}
              onOpenSettings={() => setSettingsOpen(true)}
              onOpenTruth={() => setTruthOpen(true)}
            />
          </div>
        ) : (
          <Suspense fallback={<div className="flex-1 min-h-0" />}>
            <WorkspaceShell
              vaultPath={vaultPath}
              notes={notes}
              activeNote={activeNote}
              loading={loading}
              error={error}
              activeCategory={activeCategory}
              noteContent={noteContent}
              liveContent={liveContent}
              molecularPreview={molecularPreview}
              binaryPreviewUrl={binaryPreviewUrl}
              runtimeSettings={runtimeSettings}
              aiSidebarOpen={aiSidebarOpen}
              truthLevel={truthState.level}
              onOpenSearch={() => setSearchOpen(true)}
              onOpenGraph={() => setGraphOpen(true)}
              onToggleAI={() => setAiSidebarOpen(prev => !prev)}
              onBackToManager={handleBackToManager}
              onOpenTruth={() => setTruthOpen(true)}
              onOpenSettings={() => setSettingsOpen(true)}
              onSelectNote={handleSelectNote}
              onSave={handleSave}
              onLiveContentChange={setLiveContent}
              onCreateFile={handleCreateFile}
              onDeleteEntry={handleDeleteEntry}
              onMoveEntry={handleMoveEntry}
              onRenameEntry={handleRenameEntry}
              onInlineRenameEntry={handleRenameEntryInline}
              onCreateFolder={handleCreateFolder}
            />
          </Suspense>
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
