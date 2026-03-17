import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { LazyStore } from "@tauri-apps/plugin-store";

const store = new LazyStore("settings.json");

interface SettingsModalProps { open: boolean; onClose: () => void; }

type Tab = "general" | "editor" | "ai" | "vault";

interface SettingsState {
  chatApiKey: string; chatBaseUrl: string; chatModel: string;
  embeddingApiKey: string; embeddingBaseUrl: string; embeddingModel: string;
  temperature: number; systemPrompt: string;
  fontFamily: string; enableScientific: boolean;
  ignoredFolders: string;
}

const DEFAULTS: SettingsState = {
  chatApiKey: "", chatBaseUrl: "https://api.openai.com/v1", chatModel: "gpt-4o-mini",
  embeddingApiKey: "", embeddingBaseUrl: "", embeddingModel: "text-embedding-3-small",
  temperature: 0.7, systemPrompt: "",
  fontFamily: "System Default", enableScientific: false,
  ignoredFolders: "node_modules, .git",
};

const TABS: { key: Tab; label: string; icon: JSX.Element }[] = [
  {
    key: "general", label: "常规",
    icon: <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>,
  },
  {
    key: "editor", label: "编辑器",
    icon: <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>,
  },
  {
    key: "ai", label: "AI 模型",
    icon: <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2a4 4 0 0 1 4 4v2a4 4 0 0 1-8 0V6a4 4 0 0 1 4-4z"/><path d="M16 14H8a4 4 0 0 0-4 4v2h16v-2a4 4 0 0 0-4-4z"/><line x1="12" y1="8" x2="12" y2="14"/><line x1="8" y1="11" x2="16" y2="11"/></svg>,
  },
  {
    key: "vault", label: "知识库",
    icon: <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>,
  },
];

const inputClass = "w-full bg-[#141414] border border-[#222] rounded-md px-3 py-2 text-[#EDEDED] text-sm focus:outline-none focus:border-[#444] transition-colors placeholder:text-[#555]";
const labelClass = "block text-sm font-medium text-[#CCC] mb-1.5";
const hintClass = "text-xs text-[#666] mt-1";

export default function SettingsModal({ open, onClose }: SettingsModalProps) {
  const [activeTab, setActiveTab] = useState<Tab>("ai");
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
        const temperature = ((await store.get("temperature")) as number) ?? DEFAULTS.temperature;
        const systemPrompt = ((await store.get("systemPrompt")) as string) || "";
        const fontFamily = ((await store.get("fontFamily")) as string) || DEFAULTS.fontFamily;
        const enableScientific = ((await store.get("enableScientific")) as boolean) ?? false;
        const ignoredFolders = ((await store.get("ignoredFolders")) as string) || DEFAULTS.ignoredFolders;
        setSettings({ chatApiKey, chatBaseUrl, chatModel, embeddingApiKey, embeddingBaseUrl, embeddingModel, temperature, systemPrompt, fontFamily, enableScientific, ignoredFolders });
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
      await store.set("temperature", settings.temperature);
      await store.set("systemPrompt", settings.systemPrompt);
      await store.set("fontFamily", settings.fontFamily);
      await store.set("enableScientific", settings.enableScientific);
      await store.set("ignoredFolders", settings.ignoredFolders);
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

  const upd = <K extends keyof SettingsState>(key: K, val: SettingsState[K]) =>
    setSettings(s => ({ ...s, [key]: val }));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.55)", backdropFilter: "blur(24px)" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>

      <div className="w-full max-w-4xl h-[70vh] min-h-[500px] bg-[#0A0A0A] border border-[#222] rounded-xl shadow-2xl overflow-hidden flex animate-modal-in">

        {/* ───── Sidebar ───── */}
        <div className="w-52 bg-[#111] border-r border-[#222] flex flex-col">
          <div className="px-5 pt-5 pb-3">
            <h2 className="text-[15px] font-semibold text-[#EDEDED] tracking-[-0.01em]">设置</h2>
          </div>
          <nav className="flex-1 py-1">
            {TABS.map(t => (
              <button key={t.key} onClick={() => setActiveTab(t.key)}
                className={`w-full flex items-center gap-2.5 px-4 py-2 mx-2 mt-0.5 rounded-md text-sm cursor-pointer transition-colors
                  ${activeTab === t.key
                    ? "bg-[#1A1A1A] text-[#EDEDED] font-medium"
                    : "text-[#888] hover:bg-[#1A1A1A] hover:text-[#EDEDED]"
                  }`}
                style={{ width: "calc(100% - 16px)" }}>
                {t.icon}
                {t.label}
              </button>
            ))}
          </nav>
          {/* Sidebar footer — version */}
          <div className="px-5 pb-4 text-[11px] text-[#444]">v0.1.0</div>
        </div>

        {/* ───── Content ───── */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Content header */}
          <div className="flex items-center justify-between px-8 pt-6 pb-4 border-b border-[#222]">
            <h3 className="text-[14px] font-semibold text-[#EDEDED]">
              {TABS.find(t => t.key === activeTab)?.label}
            </h3>
            <button onClick={onClose}
              className="w-7 h-7 rounded-full flex items-center justify-center transition-all duration-150 cursor-pointer hover:bg-[#222] active:scale-90 text-[#666]"
              aria-label="关闭设置">
              <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>

          {/* Scrollable pane */}
          <div className="flex-1 overflow-y-auto p-8">

            {/* ════════ General ════════ */}
            {activeTab === "general" && (
              <div className="space-y-6 max-w-lg">
                <div>
                  <label className={labelClass}>语言</label>
                  <select className={inputClass + " cursor-pointer"} defaultValue="zh-CN">
                    <option value="zh-CN">简体中文</option>
                    <option value="en">English</option>
                  </select>
                  <p className={hintClass}>界面显示语言</p>
                </div>
                <div>
                  <label className={labelClass}>主题</label>
                  <select className={inputClass + " cursor-pointer"} defaultValue="dark">
                    <option value="dark">深色</option>
                    <option value="light">浅色</option>
                  </select>
                  <p className={hintClass}>当前仅支持深色主题</p>
                </div>
              </div>
            )}

            {/* ════════ Editor ════════ */}
            {activeTab === "editor" && (
              <div className="space-y-6 max-w-lg">
                <div>
                  <label className={labelClass}>字体</label>
                  <input type="text" className={inputClass}
                    value={settings.fontFamily}
                    onChange={e => upd("fontFamily", e.target.value)}
                    placeholder="System Default" />
                  <p className={hintClass}>编辑器使用的字体族，如 "JetBrains Mono, monospace"</p>
                </div>

                <div className="flex items-center justify-between">
                  <div>
                    <label className={labelClass}>科学渲染</label>
                    <p className={hintClass + " mt-0"}>启用 KaTeX 数学公式和 SMILES 分子式渲染</p>
                  </div>
                  {/* Toggle switch */}
                  <button
                    onClick={() => upd("enableScientific", !settings.enableScientific)}
                    className={`relative w-11 h-6 rounded-full transition-colors duration-200 cursor-pointer flex-shrink-0 ${
                      settings.enableScientific ? "bg-[#3B82F6]" : "bg-[#333]"
                    }`}>
                    <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform duration-200 ${
                      settings.enableScientific ? "translate-x-5" : "translate-x-0"
                    }`} />
                  </button>
                </div>
              </div>
            )}

            {/* ════════ AI Models ════════ */}
            {activeTab === "ai" && (
              <div className="space-y-6 max-w-lg">
                {/* Chat model */}
                <div>
                  <p className="text-xs font-semibold text-[#888] uppercase tracking-wider mb-4">Chat 模型</p>
                  <div className="space-y-4">
                    <div>
                      <label className={labelClass}>API Key</label>
                      <input type="password" className={inputClass}
                        value={settings.chatApiKey}
                        onChange={e => upd("chatApiKey", e.target.value)}
                        placeholder="sk-..." />
                    </div>
                    <div>
                      <label className={labelClass}>Base URL</label>
                      <input type="text" className={inputClass}
                        value={settings.chatBaseUrl}
                        onChange={e => upd("chatBaseUrl", e.target.value)}
                        placeholder="https://api.openai.com/v1" />
                    </div>
                    <div>
                      <label className={labelClass}>模型名称</label>
                      <input type="text" className={inputClass}
                        value={settings.chatModel}
                        onChange={e => upd("chatModel", e.target.value)}
                        placeholder="gpt-4o-mini" />
                    </div>
                  </div>
                </div>

                <hr className="border-[#222]" />

                {/* Embedding model */}
                <div>
                  <p className="text-xs font-semibold text-[#888] uppercase tracking-wider mb-1">Embedding 模型</p>
                  <p className={hintClass + " mb-4"}>留空则使用 Chat 模型的配置</p>
                  <div className="space-y-4">
                    <div>
                      <label className={labelClass}>API Key</label>
                      <input type="password" className={inputClass}
                        value={settings.embeddingApiKey}
                        onChange={e => upd("embeddingApiKey", e.target.value)}
                        placeholder="留空则使用 Chat API Key" />
                    </div>
                    <div>
                      <label className={labelClass}>Base URL</label>
                      <input type="text" className={inputClass}
                        value={settings.embeddingBaseUrl}
                        onChange={e => upd("embeddingBaseUrl", e.target.value)}
                        placeholder="留空则使用 Chat Base URL" />
                    </div>
                    <div>
                      <label className={labelClass}>模型名称</label>
                      <input type="text" className={inputClass}
                        value={settings.embeddingModel}
                        onChange={e => upd("embeddingModel", e.target.value)}
                        placeholder="text-embedding-3-small" />
                    </div>
                  </div>
                </div>

                {/* Test connection */}
                <div className="flex items-center gap-3">
                  <button onClick={handleTest} disabled={testing || !settings.chatApiKey}
                    className="px-4 py-2 rounded-md text-sm font-medium cursor-pointer transition-colors
                      bg-[#1A1A1A] border border-[#333] text-[#CCC] hover:bg-[#222] hover:text-[#EDEDED]
                      disabled:opacity-40 disabled:cursor-not-allowed">
                    {testing ? "测试中…" : "测试连接"}
                  </button>
                  {testResult && (
                    <span className={`text-xs flex items-center gap-1.5 ${testResult.ok ? "text-emerald-400" : "text-red-400"}`}>
                      <svg className="w-3.5 h-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                        strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        {testResult.ok
                          ? <polyline points="20 6 9 17 4 12" />
                          : <><circle cx="12" cy="12" r="10" /><line x1="15" y1="9" x2="9" y2="15" /><line x1="9" y1="9" x2="15" y2="15" /></>
                        }
                      </svg>
                      {testResult.msg}
                    </span>
                  )}
                </div>

                <hr className="border-[#222]" />

                {/* Advanced params */}
                <div>
                  <p className="text-xs font-semibold text-[#888] uppercase tracking-wider mb-4">高级参数</p>
                  <div className="space-y-5">
                    <div>
                      <div className="flex items-center justify-between mb-1.5">
                        <label className="text-sm font-medium text-[#CCC]">Temperature</label>
                        <span className="text-xs text-[#888] tabular-nums">{settings.temperature.toFixed(1)}</span>
                      </div>
                      <input type="range" min="0" max="2" step="0.1"
                        value={settings.temperature}
                        onChange={e => upd("temperature", parseFloat(e.target.value))}
                        className="w-full h-1 rounded-full appearance-none cursor-pointer bg-[#333]
                          [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:h-3.5
                          [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[#EDEDED] [&::-webkit-slider-thumb]:shadow
                          [&::-webkit-slider-thumb]:cursor-pointer" />
                      <p className={hintClass}>值越低回答越确定，值越高回答越有创造性 (0.0 - 2.0)</p>
                    </div>
                    <div>
                      <label className={labelClass}>System Prompt</label>
                      <textarea className={inputClass + " min-h-[100px] resize-y"}
                        value={settings.systemPrompt}
                        onChange={e => upd("systemPrompt", e.target.value)}
                        placeholder="自定义系统提示词（可选）" />
                      <p className={hintClass}>在每次对话开始时发送给模型的指令</p>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* ════════ Vault ════════ */}
            {activeTab === "vault" && (
              <div className="space-y-6 max-w-lg">
                <div>
                  <label className={labelClass}>忽略的文件夹</label>
                  <input type="text" className={inputClass}
                    value={settings.ignoredFolders}
                    onChange={e => upd("ignoredFolders", e.target.value)}
                    placeholder="node_modules, .git" />
                  <p className={hintClass}>用逗号分隔，这些文件夹将不会被索引</p>
                </div>

                {/* Danger zone */}
                <div className="mt-10 rounded-lg border border-red-900/50 p-5">
                  <p className="text-sm font-medium text-red-500 mb-1">危险操作</p>
                  <p className="text-xs text-red-500/60 mb-4">以下操作不可撤销，请谨慎执行</p>
                  <button
                    className="border border-red-900/50 text-red-500 hover:bg-red-950/30 px-4 py-2 rounded-md text-sm cursor-pointer transition-colors">
                    重建向量索引
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* ───── Footer ───── */}
          <div className="px-8 py-4 border-t border-[#222] flex items-center justify-end gap-3">
            <button onClick={onClose}
              className="px-4 py-2 rounded-md text-sm cursor-pointer text-[#888] hover:text-[#EDEDED] hover:bg-[#1A1A1A] transition-colors">
              取消
            </button>
            <button onClick={handleSave} disabled={saving}
              className="px-5 py-2 rounded-md text-sm font-medium cursor-pointer disabled:opacity-50 transition-colors"
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
    </div>
  );
}
