import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { LazyStore } from "@tauri-apps/plugin-store";

const store = new LazyStore("settings.json");

interface SettingsModalProps { open: boolean; onClose: () => void; }

interface SettingsState {
  chatApiKey: string; chatBaseUrl: string; chatModel: string;
  embeddingApiKey: string; embeddingBaseUrl: string; embeddingModel: string;
}

const DEFAULTS: SettingsState = {
  chatApiKey: "", chatBaseUrl: "https://api.openai.com/v1", chatModel: "gpt-4o-mini",
  embeddingApiKey: "", embeddingBaseUrl: "", embeddingModel: "text-embedding-3-small",
};

export default function SettingsModal({ open, onClose }: SettingsModalProps) {
  const [settings, setSettings] = useState<SettingsState>(DEFAULTS);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null);

  useEffect(() => {
    if (!open) return;
    setTestResult(null);
    (async () => {
      try {
        const chatApiKey = ((await store.get("aiApiKey")) as string) || "";
        const chatBaseUrl = ((await store.get("aiBaseUrl")) as string) || DEFAULTS.chatBaseUrl;
        const chatModel = ((await store.get("chatModel")) as string) || DEFAULTS.chatModel;
        const embeddingApiKey = ((await store.get("embeddingApiKey")) as string) || "";
        const embeddingBaseUrl = ((await store.get("embeddingBaseUrl")) as string) || "";
        const embeddingModel = ((await store.get("embeddingModel")) as string) || DEFAULTS.embeddingModel;
        setSettings({ chatApiKey, chatBaseUrl, chatModel, embeddingApiKey, embeddingBaseUrl, embeddingModel });
      } catch { setSettings(DEFAULTS); }
    })();
  }, [open]);

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      await store.set("aiApiKey", settings.chatApiKey);
      await store.set("aiBaseUrl", settings.chatBaseUrl);
      await store.set("chatModel", settings.chatModel);
      await store.set("embeddingApiKey", settings.embeddingApiKey);
      await store.set("embeddingBaseUrl", settings.embeddingBaseUrl);
      await store.set("embeddingModel", settings.embeddingModel);
      await store.save(); onClose();
    } catch (e) { console.error("保存设置失败:", e); }
    finally { setSaving(false); }
  }, [settings, onClose]);

  const handleTest = useCallback(async () => {
    setTesting(true); setTestResult(null);
    try {
      await store.set("aiApiKey", settings.chatApiKey);
      await store.set("aiBaseUrl", settings.chatBaseUrl);
      await store.set("chatModel", settings.chatModel);
      await store.set("embeddingApiKey", settings.embeddingApiKey);
      await store.set("embeddingBaseUrl", settings.embeddingBaseUrl);
      await store.set("embeddingModel", settings.embeddingModel);
      await store.save();
      const msg = await invoke<string>("test_ai_connection");
      setTestResult({ ok: true, msg });
    } catch (e) { setTestResult({ ok: false, msg: e instanceof Error ? e.message : String(e) }); }
    finally { setTesting(false); }
  }, [settings]);

  if (!open) return null;

  const fieldStyle: React.CSSProperties = {
    background: "rgba(0,0,0,0.2)",
    border: "0.5px solid rgba(255,255,255,0.06)",
    borderRadius: 12,
    padding: "10px 14px",
    color: "var(--text-primary)",
    fontSize: 13,
    width: "100%",
    outline: "none",
    transition: "border-color 0.2s, box-shadow 0.2s",
  };

  const focusStyle = (e: React.FocusEvent<HTMLInputElement>) => {
    e.target.style.borderColor = "rgba(10,132,255,0.5)";
    e.target.style.boxShadow = "0 0 0 3px rgba(10,132,255,0.12)";
  };
  const blurStyle = (e: React.FocusEvent<HTMLInputElement>) => {
    e.target.style.borderColor = "rgba(255,255,255,0.06)";
    e.target.style.boxShadow = "none";
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.55)", backdropFilter: "blur(24px)" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="glass-elevated glass-highlight animate-modal-in w-[440px] max-h-[85vh] overflow-y-auto rounded-[20px]"
        style={{ background: "rgba(44,44,46,0.92)" }}>

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4"
          style={{ borderBottom: "0.5px solid rgba(255,255,255,0.06)" }}>
          <h2 className="text-[15px] font-semibold tracking-[-0.01em]" style={{ color: "var(--text-primary)" }}>设置</h2>
          <button onClick={onClose}
            className="w-7 h-7 rounded-full flex items-center justify-center transition-all duration-150 cursor-pointer
              hover:bg-white/[0.1] active:scale-90"
            style={{ background: "rgba(118,118,128,0.15)", color: "var(--text-tertiary)" }}
            aria-label="关闭设置">
            <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-5 space-y-5">
          {/* Chat Model Section */}
          <div className="rounded-[14px] p-4" style={{ background: "rgba(0,0,0,0.15)", border: "0.5px solid rgba(255,255,255,0.04)" }}>
            <p className="text-[12px] font-medium mb-3" style={{ color: "var(--text-tertiary)" }}>Chat 模型</p>
            <div className="space-y-3">
              <div>
                <label className="block text-[12px] mb-1.5" style={{ color: "var(--text-quaternary)" }}>API Key</label>
                <input type="password" value={settings.chatApiKey}
                  onChange={(e) => setSettings(s => ({ ...s, chatApiKey: e.target.value }))}
                  placeholder="sk-..." style={fieldStyle} onFocus={focusStyle} onBlur={blurStyle} />
              </div>
              <div>
                <label className="block text-[12px] mb-1.5" style={{ color: "var(--text-quaternary)" }}>Base URL</label>
                <input type="text" value={settings.chatBaseUrl}
                  onChange={(e) => setSettings(s => ({ ...s, chatBaseUrl: e.target.value }))}
                  placeholder="https://api.openai.com/v1" style={fieldStyle} onFocus={focusStyle} onBlur={blurStyle} />
              </div>
              <div>
                <label className="block text-[12px] mb-1.5" style={{ color: "var(--text-quaternary)" }}>模型名称</label>
                <input type="text" value={settings.chatModel}
                  onChange={(e) => setSettings(s => ({ ...s, chatModel: e.target.value }))}
                  placeholder="gpt-4o-mini" style={fieldStyle} onFocus={focusStyle} onBlur={blurStyle} />
              </div>
            </div>
          </div>

          {/* Embedding Model Section */}
          <div className="rounded-[14px] p-4" style={{ background: "rgba(0,0,0,0.15)", border: "0.5px solid rgba(255,255,255,0.04)" }}>
            <p className="text-[12px] font-medium mb-1.5" style={{ color: "var(--text-tertiary)" }}>Embedding 模型</p>
            <p className="text-[11px] mb-3" style={{ color: "var(--text-quaternary)" }}>留空则使用 Chat 模型的配置</p>
            <div className="space-y-3">
              <div>
                <label className="block text-[12px] mb-1.5" style={{ color: "var(--text-quaternary)" }}>API Key</label>
                <input type="password" value={settings.embeddingApiKey}
                  onChange={(e) => setSettings(s => ({ ...s, embeddingApiKey: e.target.value }))}
                  placeholder="留空则使用 Chat API Key" style={fieldStyle} onFocus={focusStyle} onBlur={blurStyle} />
              </div>
              <div>
                <label className="block text-[12px] mb-1.5" style={{ color: "var(--text-quaternary)" }}>Base URL</label>
                <input type="text" value={settings.embeddingBaseUrl}
                  onChange={(e) => setSettings(s => ({ ...s, embeddingBaseUrl: e.target.value }))}
                  placeholder="留空则使用 Chat Base URL" style={fieldStyle} onFocus={focusStyle} onBlur={blurStyle} />
              </div>
              <div>
                <label className="block text-[12px] mb-1.5" style={{ color: "var(--text-quaternary)" }}>模型名称</label>
                <input type="text" value={settings.embeddingModel}
                  onChange={(e) => setSettings(s => ({ ...s, embeddingModel: e.target.value }))}
                  placeholder="text-embedding-3-small" style={fieldStyle} onFocus={focusStyle} onBlur={blurStyle} />
              </div>
            </div>
          </div>

          {/* Test result */}
          {testResult && (
            <div className="animate-fade-in px-4 py-3 rounded-[12px] text-[12px] flex items-center gap-2.5"
              style={{
                background: testResult.ok ? "rgba(48,209,88,0.08)" : "rgba(255,69,58,0.08)",
                border: `0.5px solid ${testResult.ok ? "rgba(48,209,88,0.15)" : "rgba(255,69,58,0.15)"}`,
                color: testResult.ok ? "#30d158" : "#ff453a",
              }}>
              <svg className="w-3.5 h-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                {testResult.ok
                  ? <polyline points="20 6 9 17 4 12" />
                  : <><circle cx="12" cy="12" r="10" /><line x1="15" y1="9" x2="9" y2="15" /><line x1="9" y1="9" x2="15" y2="15" /></>
                }
              </svg>
              <span className="flex-1 break-all">{testResult.msg}</span>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 flex items-center gap-3"
          style={{ borderTop: "0.5px solid rgba(255,255,255,0.05)" }}>
          <button onClick={handleTest} disabled={testing || !settings.chatApiKey}
            className="apple-btn px-4 py-2 rounded-[12px] text-[13px] font-medium cursor-pointer
              disabled:opacity-40 disabled:cursor-not-allowed"
            style={{ background: "rgba(118,118,128,0.12)", color: "var(--text-secondary)" }}>
            {testing ? "测试中…" : "测试连接"}
          </button>
          <div className="flex-1" />
          <button onClick={onClose}
            className="apple-btn px-4 py-2 rounded-[12px] text-[13px] cursor-pointer
              hover:bg-white/[0.06]"
            style={{ color: "var(--text-tertiary)" }}>
            取消
          </button>
          <button onClick={handleSave} disabled={saving}
            className="apple-btn px-5 py-2 rounded-[12px] text-[13px] font-medium cursor-pointer
              disabled:opacity-50"
            style={{
              background: "linear-gradient(135deg, #0A84FF 0%, #0070E0 100%)",
              color: "#fff",
              boxShadow: "0 2px 10px rgba(10,132,255,0.3), inset 0 1px 0 rgba(255,255,255,0.12)",
            }}>
            {saving ? "保存中…" : "保存"}
          </button>
        </div>
      </div>
    </div>
  );
}
