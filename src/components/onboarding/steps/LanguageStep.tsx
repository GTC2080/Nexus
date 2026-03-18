interface LanguageStepProps {
  value: string;
  onChange: (value: string) => void;
}

const LANGUAGES = [
  { value: "zh-CN", label: "简体中文", desc: "Chinese Simplified" },
  { value: "en", label: "English", desc: "英语" },
];

export default function LanguageStep({ value, onChange }: LanguageStepProps) {
  return (
    <div className="flex flex-col items-center">
      <h2 className="text-lg font-semibold text-[var(--text-primary)] mb-2">选择语言 / Choose Language</h2>
      <p className="text-sm text-[var(--text-tertiary)] mb-8">选择你偏好的界面语言</p>
      <div className="flex gap-4">
        {LANGUAGES.map(lang => (
          <button
            key={lang.value}
            type="button"
            onClick={() => onChange(lang.value)}
            className="w-48 h-32 rounded-2xl border-2 flex flex-col items-center justify-center gap-2 transition-all duration-200 cursor-pointer"
            style={{
              borderColor: value === lang.value ? "var(--accent)" : "var(--separator-light)",
              background: value === lang.value ? "var(--accent-soft)" : "var(--surface-1)",
            }}
          >
            <span className="text-xl font-semibold text-[var(--text-primary)]">{lang.label}</span>
            <span className="text-xs text-[var(--text-tertiary)]">{lang.desc}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
