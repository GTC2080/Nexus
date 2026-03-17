import { useEffect, useState } from "react";
import { LazyStore } from "@tauri-apps/plugin-store";
import type { RuntimeSettings, DisciplineProfile } from "../components/SettingsModal";

const settingsStore = new LazyStore("settings.json");

const DEFAULT_RUNTIME_SETTINGS: RuntimeSettings = {
  uiLanguage: "zh-CN",
  theme: "dark",
  fontFamily: "System Default",
  enableScientific: false,
  ignoredFolders: "node_modules, .git",
  activeDiscipline: "general",
};

export function useRuntimeSettings() {
  const [runtimeSettings, setRuntimeSettings] = useState<RuntimeSettings>(DEFAULT_RUNTIME_SETTINGS);

  useEffect(() => {
    (async () => {
      try {
        const uiLanguage = ((await settingsStore.get("uiLanguage")) as string) || "zh-CN";
        const theme = (((await settingsStore.get("theme")) as RuntimeSettings["theme"]) || "dark");
        const fontFamily = ((await settingsStore.get("fontFamily")) as string) || "System Default";
        const enableScientific = ((await settingsStore.get("enableScientific")) as boolean) ?? false;
        const ignoredFolders = ((await settingsStore.get("ignoredFolders")) as string) || "node_modules, .git";
        const activeDiscipline = ((await settingsStore.get("activeDiscipline")) as DisciplineProfile) || "general";
        const loaded: RuntimeSettings = { uiLanguage, theme, fontFamily, enableScientific, ignoredFolders, activeDiscipline };
        setRuntimeSettings(loaded);
      } catch {
        // ignore settings load error
      }
    })();
  }, []);

  useEffect(() => {
    document.documentElement.lang = runtimeSettings.uiLanguage || "zh-CN";
    document.documentElement.setAttribute("data-theme", runtimeSettings.theme || "dark");
  }, [runtimeSettings.uiLanguage, runtimeSettings.theme]);

  return { runtimeSettings, setRuntimeSettings };
}
