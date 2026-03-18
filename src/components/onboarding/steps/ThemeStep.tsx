interface ThemeStepProps {
  value: string;
  onChange: (value: string) => void;
  uiLanguage: string;
}

const THEMES = [
  { value: "dark", label: "深色模式", desc: "Dark Mode", icon: "🌙" },
  { value: "light", label: "浅色模式", desc: "Light Mode", icon: "☀️" },
];

export default function ThemeStep({ value, onChange, uiLanguage }: ThemeStepProps) {
  const handleChange = (theme: string) => {
    onChange(theme);
    document.documentElement.setAttribute("data-theme", theme);
  };

  return (
    <div className="flex flex-col items-center">
      <h2 className="text-lg font-semibold text-[var(--text-primary)] mb-2">{uiLanguage === "en" ? "Choose Theme" : "选择主题"}</h2>
      <p className="text-sm text-[var(--text-tertiary)] mb-8">{uiLanguage === "en" ? "You can change this anytime in settings" : "你可以随时在设置中更改"}</p>
      <div className="flex gap-4">
        {THEMES.map(theme => (
          <button
            key={theme.value}
            type="button"
            onClick={() => handleChange(theme.value)}
            className="w-48 h-32 rounded-2xl border-2 flex flex-col items-center justify-center gap-2 transition-all duration-200 cursor-pointer"
            style={{
              borderColor: value === theme.value ? "var(--accent)" : "var(--separator-light)",
              background: value === theme.value ? "var(--accent-soft)" : "var(--surface-1)",
            }}
          >
            <span className="text-2xl">{theme.icon}</span>
            <span className="text-base font-semibold text-[var(--text-primary)]">{uiLanguage === "en" ? theme.desc : theme.label}</span>
            <span className="text-xs text-[var(--text-tertiary)]">{uiLanguage === "en" ? theme.label : theme.desc}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
