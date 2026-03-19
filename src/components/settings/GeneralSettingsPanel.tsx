import { useT } from "../../i18n";
import { ACTIVITY_BAR_ITEMS, type ActivityBarItemId } from "./settingsTypes";
import type { SettingsState } from "./settingsTypes";
import { labelClass, hintClass, ThemedSelect } from "./settingsShared";
import type { SettingsUpdate } from "./settingsShared";

export default function GeneralSettingsPanel({
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
