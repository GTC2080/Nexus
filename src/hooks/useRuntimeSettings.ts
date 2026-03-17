import { useEffect, useState } from "react";
import { LazyStore } from "@tauri-apps/plugin-store";
import {
  DEFAULT_RUNTIME_SETTINGS,
  SETTINGS_STORE_NAME,
  normalizeDisciplineProfile,
  normalizeTheme,
  type RuntimeSettings,
} from "../components/settings/settingsTypes";

const settingsStore = new LazyStore(SETTINGS_STORE_NAME);

export function useRuntimeSettings() {
  const [runtimeSettings, setRuntimeSettings] = useState<RuntimeSettings>(DEFAULT_RUNTIME_SETTINGS);

  useEffect(() => {
    (async () => {
      try {
        const [
          uiLanguageRaw,
          themeRaw,
          fontFamilyRaw,
          enableScientificRaw,
          ignoredFoldersRaw,
          activeDisciplineRaw,
        ] = await Promise.all([
          settingsStore.get("uiLanguage"),
          settingsStore.get("theme"),
          settingsStore.get("fontFamily"),
          settingsStore.get("enableScientific"),
          settingsStore.get("ignoredFolders"),
          settingsStore.get("activeDiscipline"),
        ]);
        const uiLanguage = (uiLanguageRaw as string) || DEFAULT_RUNTIME_SETTINGS.uiLanguage;
        const theme = normalizeTheme(themeRaw);
        const fontFamily = (fontFamilyRaw as string) || DEFAULT_RUNTIME_SETTINGS.fontFamily;
        const enableScientific = (enableScientificRaw as boolean) ?? DEFAULT_RUNTIME_SETTINGS.enableScientific;
        const ignoredFolders = (ignoredFoldersRaw as string) || DEFAULT_RUNTIME_SETTINGS.ignoredFolders;
        const activeDiscipline = normalizeDisciplineProfile(activeDisciplineRaw);
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
