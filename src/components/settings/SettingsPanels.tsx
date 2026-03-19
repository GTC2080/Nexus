import { useState } from "react";
import type { ReactNode } from "react";
import { useT } from "../../i18n";
import { ACTIVITY_BAR_ITEMS, type ActivityBarItemId } from "./settingsTypes";
import type { SettingsState, SettingsTab } from "./settingsTypes";

export type SettingsUpdate = <K extends keyof SettingsState>(key: K, value: SettingsState[K]) => void;

interface SelectOption<T extends string> {
  value: T;
  label: string;
}

interface TestResult {
  ok: boolean;
  msg: string;
}

const inputClass = "w-full rounded-[10px] px-3 py-2.5 text-sm transition-all placeholder:text-[var(--text-quaternary)] bg-[rgba(255,255,255,0.03)] border border-[var(--separator-light)] text-[var(--text-secondary)] focus:outline-none focus:border-[var(--accent)] focus:bg-[rgba(10,132,255,0.07)]";
const labelClass = "block text-sm font-medium text-[var(--text-secondary)] mb-1.5";
const hintClass = "text-xs text-[var(--text-quaternary)] mt-1";

export const SETTINGS_TABS: { key: SettingsTab; labelKey: string; icon: ReactNode }[] = [
  {
    key: "general", labelKey: "settings.tabs.general",
    icon: <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /></svg>,
  },
  {
    key: "editor", labelKey: "settings.tabs.editor",
    icon: <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>,
  },
  {
    key: "ai", labelKey: "settings.tabs.ai",
    icon: <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2a4 4 0 0 1 4 4v2a4 4 0 0 1-8 0V6a4 4 0 0 1 4-4z" /><path d="M16 14H8a4 4 0 0 0-4 4v2h16v-2a4 4 0 0 0-4-4z" /><line x1="12" y1="8" x2="12" y2="14" /><line x1="8" y1="11" x2="16" y2="11" /></svg>,
  },
  {
    key: "vault", labelKey: "settings.tabs.vault",
    icon: <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" /></svg>,
  },
];

function ThemedSelect<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: Array<SelectOption<T>>;
  onChange: (next: T) => void;
}) {
  const [open, setOpen] = useState(false);
  const selected = options.find(option => option.value === value) ?? options[0];

  return (
    <div className="relative" tabIndex={0} onBlur={() => setOpen(false)}>
      <button
        type="button"
        className={inputClass + " w-full text-left pr-9 cursor-pointer"}
        onClick={() => setOpen(prev => !prev)}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        {selected?.label ?? ""}
        <span className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-[var(--text-tertiary)]">
          <svg className={"w-4 h-4 transition-transform " + (open ? "rotate-180" : "")} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </span>
      </button>

      {open && (
        <div
          className="absolute left-0 right-0 mt-1 z-30 rounded-[10px] border border-[var(--separator-light)] bg-[var(--surface-2)] shadow-[0_12px_28px_rgba(0,0,0,0.35)] overflow-hidden"
          role="listbox"
        >
          {options.map(option => (
            <button
              key={option.value}
              type="button"
              onMouseDown={e => e.preventDefault()}
              onClick={() => {
                onChange(option.value);
                setOpen(false);
              }}
              className={`w-full text-left px-3 py-2 text-sm transition-colors ${
                option.value === value
                  ? "bg-[var(--accent-soft)] text-[var(--text-primary)]"
                  : "text-[var(--text-secondary)] hover:bg-[rgba(255,255,255,0.06)]"
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function GeneralSettingsPanel({
  settings,
  onUpdate,
  onRerunOnboarding,
}: {
  settings: SettingsState;
  onUpdate: SettingsUpdate;
  onRerunOnboarding: () => void;
}) {
  const t = useT();
  return (
    <div className="space-y-6 max-w-lg">
      <div>
        <label className={labelClass}>{t("settings.language")}</label>
        <ThemedSelect
          value={settings.uiLanguage}
          onChange={next => onUpdate("uiLanguage", next)}
          options={[
            { value: "zh-CN", label: t("settings.zhCN") },
            { value: "en", label: t("settings.en") },
          ]}
        />
        <p className={hintClass}>{t("settings.languageHint")}</p>
      </div>

      <div>
        <label className={labelClass}>{t("settings.theme")}</label>
        <ThemedSelect
          value={settings.theme}
          onChange={next => onUpdate("theme", next)}
          options={[
            { value: "dark", label: t("settings.themeDark") },
            { value: "light", label: t("settings.themeLight") },
          ]}
        />
        <p className={hintClass}>{t("settings.themeHint")}</p>
      </div>

      <div className="pt-4 mt-4 border-t border-[var(--separator-light)]">
        <label className={labelClass}>{t("settings.activityBarFeatures")}</label>
        <p className={hintClass + " mb-3"}>{t("settings.activityBarHint")}</p>
        <div className="space-y-2">
          {ACTIVITY_BAR_ITEMS.map(item => {
            const visible = settings.visibleActivityBarItems.includes(item.id);
            return (
              <div key={item.id} className="flex items-center justify-between py-1">
                <span className="text-sm text-[var(--text-secondary)]">{t(item.labelKey)}</span>
                <button
                  type="button"
                  onClick={() => {
                    const next = visible
                      ? settings.visibleActivityBarItems.filter((id: ActivityBarItemId) => id !== item.id)
                      : [...settings.visibleActivityBarItems, item.id];
                    onUpdate("visibleActivityBarItems", next);
                  }}
                  className="relative w-11 h-6 rounded-full transition-colors duration-200 cursor-pointer flex-shrink-0"
                  style={{ background: visible ? "var(--accent)" : "var(--separator)" }}
                >
                  <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform duration-200 ${
                    visible ? "translate-x-5" : "translate-x-0"
                  }`} />
                </button>
              </div>
            );
          })}
        </div>
      </div>

      <div className="pt-4 mt-4 border-t border-[var(--separator-light)]">
        <button
          type="button"
          onClick={onRerunOnboarding}
          className="px-4 py-2 rounded-md text-sm cursor-pointer transition-colors bg-[rgba(255,255,255,0.04)] border border-[var(--separator-light)] text-[var(--text-secondary)] hover:bg-[rgba(255,255,255,0.08)] hover:text-[var(--text-primary)]"
        >
          {t("settings.rerunOnboarding")}
        </button>
        <p className="text-xs text-[var(--text-quaternary)] mt-1.5">{t("settings.rerunOnboardingHint")}</p>
      </div>
    </div>
  );
}

export function EditorSettingsPanel({
  settings,
  onUpdate,
}: {
  settings: SettingsState;
  onUpdate: SettingsUpdate;
}) {
  const t = useT();
  return (
    <div className="space-y-6 max-w-lg">
      <div>
        <label className={labelClass}>{t("settings.font")}</label>
        <input
          type="text"
          className={inputClass}
          value={settings.fontFamily}
          onChange={e => onUpdate("fontFamily", e.target.value)}
          placeholder="System Default"
        />
        <p className={hintClass}>{t("settings.fontHint")}</p>
      </div>

      <div className="flex items-center justify-between">
        <div>
          <label className={labelClass}>{t("settings.scientific")}</label>
          <p className={hintClass + " mt-0"}>{t("settings.scientificHint")}</p>
        </div>
        <button
          type="button"
          onClick={() => onUpdate("enableScientific", !settings.enableScientific)}
          className="relative w-11 h-6 rounded-full transition-colors duration-200 cursor-pointer flex-shrink-0"
          style={{ background: settings.enableScientific ? "var(--accent)" : "var(--separator)" }}
        >
          <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform duration-200 ${
            settings.enableScientific ? "translate-x-5" : "translate-x-0"
          }`}
          />
        </button>
      </div>
    </div>
  );
}

export function AiSettingsPanel({
  settings,
  onUpdate,
  testing,
  testResult,
  onTest,
}: {
  settings: SettingsState;
  onUpdate: SettingsUpdate;
  testing: boolean;
  testResult: TestResult | null;
  onTest: () => void;
}) {
  const t = useT();
  return (
    <div className="space-y-6 max-w-lg">
      <div>
        <p className="text-xs font-semibold text-[var(--text-tertiary)] uppercase tracking-wider mb-4">{t("settings.chatModel")}</p>
        <div className="space-y-4">
          <div>
            <label className={labelClass}>{t("settings.apiKey")}</label>
            <input type="password" className={inputClass} value={settings.chatApiKey} onChange={e => onUpdate("chatApiKey", e.target.value)} placeholder="sk-..." />
          </div>
          <div>
            <label className={labelClass}>{t("settings.baseUrl")}</label>
            <input type="text" className={inputClass} value={settings.chatBaseUrl} onChange={e => onUpdate("chatBaseUrl", e.target.value)} placeholder="https://api.openai.com/v1" />
          </div>
          <div>
            <label className={labelClass}>{t("settings.modelName")}</label>
            <input type="text" className={inputClass} value={settings.chatModel} onChange={e => onUpdate("chatModel", e.target.value)} placeholder="gpt-4o-mini" />
          </div>
        </div>
      </div>

      <hr className="border-[var(--separator-light)]" />

      <div>
        <p className="text-xs font-semibold text-[var(--text-tertiary)] uppercase tracking-wider mb-1">{t("settings.embeddingModel")}</p>
        <p className={hintClass + " mb-4"}>{t("settings.embeddingFallbackHint")}</p>
        <div className="space-y-4">
          <div>
            <label className={labelClass}>{t("settings.apiKey")}</label>
            <input type="password" className={inputClass} value={settings.embeddingApiKey} onChange={e => onUpdate("embeddingApiKey", e.target.value)} placeholder={t("settings.embeddingApiKeyPlaceholder")} />
          </div>
          <div>
            <label className={labelClass}>{t("settings.baseUrl")}</label>
            <input type="text" className={inputClass} value={settings.embeddingBaseUrl} onChange={e => onUpdate("embeddingBaseUrl", e.target.value)} placeholder={t("settings.embeddingBaseUrlPlaceholder")} />
          </div>
          <div>
            <label className={labelClass}>{t("settings.modelName")}</label>
            <input type="text" className={inputClass} value={settings.embeddingModel} onChange={e => onUpdate("embeddingModel", e.target.value)} placeholder="text-embedding-3-small" />
          </div>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onTest}
          disabled={testing || !settings.chatApiKey}
          className="px-4 py-2 rounded-md text-sm font-medium cursor-pointer transition-colors
            bg-[rgba(255,255,255,0.04)] border border-[var(--separator-light)] text-[var(--text-secondary)] hover:bg-[rgba(255,255,255,0.08)] hover:text-[var(--text-primary)]
            disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {testing ? t("settings.testing") : t("settings.testConnection")}
        </button>
        {testResult && (
          <span className={`text-xs flex items-center gap-1.5 ${testResult.ok ? "text-emerald-400" : "text-red-400"}`}>
            <svg className="w-3.5 h-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              {testResult.ok
                ? <polyline points="20 6 9 17 4 12" />
                : <><circle cx="12" cy="12" r="10" /><line x1="15" y1="9" x2="9" y2="15" /><line x1="9" y1="9" x2="15" y2="15" /></>
              }
            </svg>
            {testResult.msg}
          </span>
        )}
      </div>

      <hr className="border-[var(--separator-light)]" />

      <div>
        <p className="text-xs font-semibold text-[var(--text-tertiary)] uppercase tracking-wider mb-4">{t("settings.advanced")}</p>
        <div className="space-y-5">
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-sm font-medium text-[var(--text-secondary)]">Temperature</label>
              <span className="text-xs text-[var(--text-tertiary)] tabular-nums">{settings.temperature.toFixed(1)}</span>
            </div>
            <input
              type="range"
              min="0"
              max="2"
              step="0.1"
              value={settings.temperature}
              onChange={e => onUpdate("temperature", parseFloat(e.target.value))}
              className="w-full h-1 rounded-full appearance-none cursor-pointer bg-[rgba(255,255,255,0.16)]
                [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:h-3.5
                [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[var(--accent)] [&::-webkit-slider-thumb]:shadow-[0_0_10px_rgba(10,132,255,0.45)]
                [&::-webkit-slider-thumb]:cursor-pointer"
            />
            <p className={hintClass}>{t("settings.temperatureHint")}</p>
          </div>
          <div>
            <label className={labelClass}>{t("settings.systemPrompt")}</label>
            <textarea className={inputClass + " min-h-[100px] resize-y"} value={settings.systemPrompt} onChange={e => onUpdate("systemPrompt", e.target.value)} placeholder={t("settings.systemPromptPlaceholder")} />
            <p className={hintClass}>{t("settings.systemPromptHint")}</p>
          </div>
        </div>
      </div>
    </div>
  );
}

export function VaultSettingsPanel({
  settings,
  onUpdate,
  rebuilding,
  rebuildResult,
  onRebuildVectors,
}: {
  settings: SettingsState;
  onUpdate: SettingsUpdate;
  rebuilding: boolean;
  rebuildResult: TestResult | null;
  onRebuildVectors: () => void;
}) {
  const t = useT();
  return (
    <div className="space-y-6 max-w-lg">
      <div>
        <label className={labelClass}>{t("settings.ignoredFolders")}</label>
        <input type="text" className={inputClass} value={settings.ignoredFolders} onChange={e => onUpdate("ignoredFolders", e.target.value)} placeholder="node_modules, .git" />
        <p className={hintClass}>{t("settings.ignoredFoldersHint")}</p>
      </div>

      <div className="mt-10 rounded-lg border border-red-500/35 bg-red-500/5 p-5">
        <p className="text-sm font-medium text-red-400 mb-1">{t("settings.dangerZone")}</p>
        <p className="text-xs text-red-300/70 mb-4">{t("settings.dangerZoneHint")}</p>
        <button
          type="button"
          onClick={onRebuildVectors}
          disabled={rebuilding}
          className="border border-red-500/40 text-red-300 hover:bg-red-500/12 px-4 py-2 rounded-md text-sm cursor-pointer transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {rebuilding ? t("settings.rebuilding") : t("settings.rebuildIndex")}
        </button>
        {rebuildResult && (
          <p className={`text-xs mt-3 ${rebuildResult.ok ? "text-emerald-300" : "text-red-300"}`}>
            {rebuildResult.msg}
          </p>
        )}
      </div>
    </div>
  );
}
