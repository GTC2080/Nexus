import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { LazyStore } from "@tauri-apps/plugin-store";
import {
  AiSettingsPanel,
  EditorSettingsPanel,
  GeneralSettingsPanel,
  SETTINGS_TABS,
  VaultSettingsPanel,
  type SettingsUpdate,
} from "./settings/SettingsPanels";
import {
  DEFAULT_SETTINGS,
  SETTINGS_STORE_NAME,
  applyRuntimeSettings,
  normalizeDisciplineProfile,
  normalizeTheme,
  toRuntimeSettings,
  type DisciplineProfile,
  type RuntimeSettings,
  type SettingsState,
  type SettingsTab,
} from "./settings/settingsTypes";

export type { DisciplineProfile, RuntimeSettings };

const store = new LazyStore(SETTINGS_STORE_NAME);

interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
  onSettingsApplied?: (settings: RuntimeSettings) => void;
}

type OperationResult = { ok: boolean; msg: string } | null;

function buildFullSettingsPayload(settings: SettingsState): Record<string, unknown> {
  return {
    uiLanguage: settings.uiLanguage,
    theme: settings.theme,
    aiApiKey: settings.chatApiKey,
    aiBaseUrl: settings.chatBaseUrl,
    chatModel: settings.chatModel,
    embeddingApiKey: settings.embeddingApiKey,
    embeddingBaseUrl: settings.embeddingBaseUrl,
    embeddingModel: settings.embeddingModel,
    temperature: settings.temperature,
    systemPrompt: settings.systemPrompt,
    fontFamily: settings.fontFamily,
    enableScientific: settings.enableScientific,
    ignoredFolders: settings.ignoredFolders,
    activeDiscipline: settings.activeDiscipline,
  };
}

function buildAiSettingsPayload(settings: SettingsState): Record<string, unknown> {
  return {
    aiApiKey: settings.chatApiKey,
    aiBaseUrl: settings.chatBaseUrl,
    chatModel: settings.chatModel,
    embeddingApiKey: settings.embeddingApiKey,
    embeddingBaseUrl: settings.embeddingBaseUrl,
    embeddingModel: settings.embeddingModel,
  };
}

async function persistStoreValues(values: Record<string, unknown>) {
  await Promise.all(Object.entries(values).map(([key, value]) => store.set(key, value)));
  await store.save();
}

async function loadSettingsState(): Promise<SettingsState> {
  const [
    uiLanguageRaw,
    themeRaw,
    chatApiKeyRaw,
    chatBaseUrlRaw,
    chatModelRaw,
    embeddingApiKeyRaw,
    embeddingBaseUrlRaw,
    embeddingModelRaw,
    temperatureRaw,
    systemPromptRaw,
    fontFamilyRaw,
    enableScientificRaw,
    ignoredFoldersRaw,
    activeDisciplineRaw,
  ] = await Promise.all([
    store.get("uiLanguage"),
    store.get("theme"),
    store.get("aiApiKey"),
    store.get("aiBaseUrl"),
    store.get("chatModel"),
    store.get("embeddingApiKey"),
    store.get("embeddingBaseUrl"),
    store.get("embeddingModel"),
    store.get("temperature"),
    store.get("systemPrompt"),
    store.get("fontFamily"),
    store.get("enableScientific"),
    store.get("ignoredFolders"),
    store.get("activeDiscipline"),
  ]);

  return {
    uiLanguage: (uiLanguageRaw as string) || DEFAULT_SETTINGS.uiLanguage,
    theme: normalizeTheme(themeRaw),
    chatApiKey: (chatApiKeyRaw as string) || "",
    chatBaseUrl: (chatBaseUrlRaw as string) || DEFAULT_SETTINGS.chatBaseUrl,
    chatModel: (chatModelRaw as string) || DEFAULT_SETTINGS.chatModel,
    embeddingApiKey: (embeddingApiKeyRaw as string) || "",
    embeddingBaseUrl: (embeddingBaseUrlRaw as string) || "",
    embeddingModel: (embeddingModelRaw as string) || DEFAULT_SETTINGS.embeddingModel,
    temperature: (temperatureRaw as number) ?? DEFAULT_SETTINGS.temperature,
    systemPrompt: (systemPromptRaw as string) || "",
    fontFamily: (fontFamilyRaw as string) || DEFAULT_SETTINGS.fontFamily,
    enableScientific: (enableScientificRaw as boolean) ?? DEFAULT_SETTINGS.enableScientific,
    ignoredFolders: (ignoredFoldersRaw as string) || DEFAULT_SETTINGS.ignoredFolders,
    activeDiscipline: normalizeDisciplineProfile(activeDisciplineRaw),
  };
}

export default function SettingsModal({ open, onClose, onSettingsApplied }: SettingsModalProps) {
  const [activeTab, setActiveTab] = useState<SettingsTab>("general");
  const [settings, setSettings] = useState<SettingsState>(DEFAULT_SETTINGS);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [rebuilding, setRebuilding] = useState(false);
  const [testResult, setTestResult] = useState<OperationResult>(null);
  const [rebuildResult, setRebuildResult] = useState<OperationResult>(null);

  useEffect(() => {
    if (!open) return;
    setTestResult(null);
    setRebuildResult(null);
    (async () => {
      try {
        setSettings(await loadSettingsState());
      } catch {
        setSettings(DEFAULT_SETTINGS);
      }
    })();
  }, [open]);

  const updateSetting: SettingsUpdate = useCallback((key, value) => {
    setSettings(prev => ({ ...prev, [key]: value }));
  }, []);

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      await persistStoreValues(buildFullSettingsPayload(settings));
      const runtime = toRuntimeSettings(settings);
      applyRuntimeSettings(runtime);
      onSettingsApplied?.(runtime);
      onClose();
    } catch (error) {
      console.error("保存设置失败:", error);
    } finally {
      setSaving(false);
    }
  }, [settings, onClose, onSettingsApplied]);

  const handleTest = useCallback(async () => {
    setTesting(true);
    setTestResult(null);
    try {
      await persistStoreValues(buildAiSettingsPayload(settings));
      const msg = await invoke<string>("test_ai_connection");
      setTestResult({ ok: true, msg });
    } catch (error) {
      setTestResult({ ok: false, msg: error instanceof Error ? error.message : String(error) });
    } finally {
      setTesting(false);
    }
  }, [settings]);

  const handleRebuildVectors = useCallback(async () => {
    const ok = window.confirm("将清空并重建当前知识库的全部向量索引，期间可能耗时较长。继续吗？");
    if (!ok) return;
    setRebuilding(true);
    setRebuildResult(null);
    try {
      const count = await invoke<number>("rebuild_vector_index");
      setRebuildResult({ ok: true, msg: `重建完成：${count} 条笔记向量已更新。` });
    } catch (error) {
      setRebuildResult({ ok: false, msg: error instanceof Error ? error.message : String(error) });
    } finally {
      setRebuilding(false);
    }
  }, []);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{
        background: "radial-gradient(1200px 700px at 12% 10%, rgba(10,132,255,0.08) 0%, rgba(0,0,0,0) 40%), rgba(0,0,0,0.55)",
        backdropFilter: "blur(24px)",
      }}
      onClick={event => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-4xl h-[70vh] min-h-[500px] rounded-2xl overflow-hidden flex animate-modal-in glass-elevated">
        <div className="w-52 bg-[rgba(255,255,255,0.02)] border-r border-[var(--separator-light)] flex flex-col">
          <div className="px-5 pt-5 pb-3">
            <h2 className="text-[15px] font-semibold text-[var(--text-primary)] tracking-[-0.01em]">设置</h2>
          </div>
          <nav className="flex-1 py-1">
            {SETTINGS_TABS.map(tab => (
              <button
                key={tab.key}
                type="button"
                onClick={() => setActiveTab(tab.key)}
                className={`w-full flex items-center gap-2.5 px-4 py-2 mx-2 mt-0.5 rounded-md text-sm cursor-pointer transition-colors
                  ${activeTab === tab.key
                    ? "bg-[var(--accent-soft)] text-[var(--text-primary)] border border-[rgba(10,132,255,0.35)] font-medium"
                    : "text-[var(--text-tertiary)] hover:bg-[rgba(255,255,255,0.05)] hover:text-[var(--text-secondary)] border border-transparent"
                  }`}
                style={{ width: "calc(100% - 16px)" }}
              >
                {tab.icon}
                {tab.label}
              </button>
            ))}
          </nav>
          <div className="px-5 pb-4 text-[11px] text-[var(--text-quaternary)]">v0.1.0</div>
        </div>

        <div className="flex-1 flex flex-col min-w-0">
          <div className="flex items-center justify-between px-8 pt-6 pb-4 border-b border-[var(--separator-light)]">
            <h3 className="text-[14px] font-semibold text-[var(--text-primary)]">
              {SETTINGS_TABS.find(tab => tab.key === activeTab)?.label}
            </h3>
            <button
              type="button"
              onClick={onClose}
              className="w-7 h-7 rounded-full flex items-center justify-center transition-all duration-150 cursor-pointer hover:bg-[rgba(255,255,255,0.08)] active:scale-90 text-[var(--text-quaternary)] hover:text-[var(--text-secondary)]"
              aria-label="关闭设置"
            >
              <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-8">
            {activeTab === "general" && <GeneralSettingsPanel settings={settings} onUpdate={updateSetting} />}
            {activeTab === "editor" && <EditorSettingsPanel settings={settings} onUpdate={updateSetting} />}
            {activeTab === "ai" && (
              <AiSettingsPanel
                settings={settings}
                onUpdate={updateSetting}
                testing={testing}
                testResult={testResult}
                onTest={() => { void handleTest(); }}
              />
            )}
            {activeTab === "vault" && (
              <VaultSettingsPanel
                settings={settings}
                onUpdate={updateSetting}
                rebuilding={rebuilding}
                rebuildResult={rebuildResult}
                onRebuildVectors={() => { void handleRebuildVectors(); }}
              />
            )}
          </div>

          <div className="px-8 py-4 border-t border-[var(--separator-light)] flex items-center justify-end gap-3 bg-[rgba(255,255,255,0.02)]">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-md text-sm cursor-pointer text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[rgba(255,255,255,0.08)] transition-colors"
            >
              取消
            </button>
            <button
              type="button"
              onClick={() => { void handleSave(); }}
              disabled={saving}
              className="px-5 py-2 rounded-md text-sm font-medium cursor-pointer disabled:opacity-50 transition-all hover:brightness-110"
              style={{
                background: "linear-gradient(135deg, #0A84FF 0%, #0066D6 100%)",
                color: "#fff",
                boxShadow: "0 6px 18px rgba(10,132,255,0.28), inset 0 1px 0 rgba(255,255,255,0.18)",
              }}
            >
              {saving ? "保存中…" : "保存"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
