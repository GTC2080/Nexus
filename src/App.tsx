import { lazy, Suspense, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { useRuntimeSettings } from "./hooks/useRuntimeSettings";
import { useRecentVaults } from "./hooks/useRecentVaults";
import { useLazyModalReady } from "./hooks/useLazyModalReady";
import { useWindowControls } from "./hooks/useWindowControls";
import type { TruthState } from "./models/truth_system";
import AppTitleBar from "./components/app/AppTitleBar";
import VaultManagerView from "./components/app/VaultManagerView";

const WorkspaceRuntime = lazy(() => import("./components/app/WorkspaceRuntime"));
const SettingsModal = lazy(() => import("./components/SettingsModal"));
const TruthDashboard = lazy(() => import("./components/TruthDashboard"));

const DEFAULT_TRUTH_STATE: TruthState = {
  level: 1,
  totalExp: 0,
  nextLevelExp: 100,
  attributes: { science: 1, engineering: 1, creation: 1, finance: 1 },
  attributeExp: { science: 0, engineering: 0, creation: 0, finance: 0 },
  lastSettlement: Date.now(),
};

function App() {
  const { runtimeSettings, setRuntimeSettings } = useRuntimeSettings();
  const { recentVaults, saveToRecent, removeFromRecent } = useRecentVaults();
  const [workspaceVaultPath, setWorkspaceVaultPath] = useState("");
  const [managerSettingsOpen, setManagerSettingsOpen] = useState(false);
  const [managerTruthOpen, setManagerTruthOpen] = useState(false);
  const [truthSnapshot, setTruthSnapshot] = useState<TruthState>(DEFAULT_TRUTH_STATE);
  const windowControls = useWindowControls();

  const managerSettingsReady = useLazyModalReady(managerSettingsOpen && !workspaceVaultPath);
  const managerTruthReady = useLazyModalReady(managerTruthOpen && !workspaceVaultPath);

  const handleOpenVault = async () => {
    try {
      const selected = await open({ directory: true, multiple: false });
      if (!selected) return;
      setWorkspaceVaultPath(selected);
    } catch (error) {
      console.error("打开知识库失败:", error);
    }
  };

  const handleOpenRecent = (path: string) => {
    setWorkspaceVaultPath(path);
  };

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
        {!workspaceVaultPath ? (
          <div className="flex flex-1 min-h-0">
            <VaultManagerView
              recentVaults={recentVaults}
              onOpenRecent={handleOpenRecent}
              onRemoveRecent={removeFromRecent}
              onOpenVault={handleOpenVault}
              onOpenSettings={() => setManagerSettingsOpen(true)}
              onOpenTruth={() => setManagerTruthOpen(true)}
            />
          </div>
        ) : (
          <Suspense fallback={<div className="flex-1 min-h-0" />}>
            <WorkspaceRuntime
              key={workspaceVaultPath}
              initialVaultPath={workspaceVaultPath}
              runtimeSettings={runtimeSettings}
              onRuntimeSettingsApplied={setRuntimeSettings}
              onSaveToRecent={saveToRecent}
              onExitWorkspace={() => setWorkspaceVaultPath("")}
              onTruthStateSnapshot={setTruthSnapshot}
            />
          </Suspense>
        )}
      </div>

      {!workspaceVaultPath && managerSettingsReady && (
        <Suspense fallback={null}>
          <SettingsModal
            open={managerSettingsOpen}
            onClose={() => setManagerSettingsOpen(false)}
            onSettingsApplied={setRuntimeSettings}
          />
        </Suspense>
      )}
      {!workspaceVaultPath && managerTruthReady && (
        <Suspense fallback={null}>
          <TruthDashboard
            open={managerTruthOpen}
            onClose={() => setManagerTruthOpen(false)}
            state={truthSnapshot}
          />
        </Suspense>
      )}
    </div>
  );
}

export default App;
