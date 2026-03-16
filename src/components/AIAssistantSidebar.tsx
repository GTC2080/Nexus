import { useState, useRef, useEffect, useCallback } from "react";
import { invoke, Channel } from "@tauri-apps/api/core";
import Markdown from "react-markdown";
import type { NoteInfo } from "../types";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  loading?: boolean;
}

interface AIAssistantSidebarProps {
  width: number;
  /** 语义共鸣推荐的相关笔记 */
  relatedNotes: NoteInfo[];
  /** 语义共鸣是否正在加载 */
  resonanceLoading: boolean;
  /** 点击笔记跳转 */
  onSelectNote: (note: NoteInfo) => void;
  /** 内嵌模式（如 PDF 视图内） */
  embedded?: boolean;
}

export default function AIAssistantSidebar({
  width, relatedNotes, resonanceLoading, onSelectNote, embedded,
}: AIAssistantSidebarProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [contextOpen, setContextOpen] = useState(true);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // 自动滚动到底部
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  // 提交问题，发起流式 RAG 问答
  const handleSubmit = useCallback(async () => {
    const question = input.trim();
    if (!question || streaming) return;

    setInput("");
    setStreaming(true);

    // 添加用户消息 + 空的 AI 占位消息
    setMessages(prev => [
      ...prev,
      { role: "user", content: question },
      { role: "assistant", content: "", loading: true },
    ]);

    try {
      // 创建 Tauri IPC Channel 接收流式 chunk
      const channel = new Channel<string>();

      channel.onmessage = (chunk: string) => {
        setMessages(prev => {
          const updated = [...prev];
          const last = updated[updated.length - 1];
          if (last && last.role === "assistant") {
            updated[updated.length - 1] = {
              ...last,
              content: last.content + chunk,
              loading: false,
            };
          }
          return updated;
        });
      };

      await invoke("ask_vault", { question, onEvent: channel });
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      setMessages(prev => {
        const updated = [...prev];
        const last = updated[updated.length - 1];
        if (last && last.role === "assistant") {
          updated[updated.length - 1] = {
            ...last,
            content: `抱歉，发生了错误：${errMsg}`,
            loading: false,
          };
        }
        return updated;
      });
    } finally {
      setStreaming(false);
    }
  }, [input, streaming]);

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  }

  // textarea 自动调整高度（最多 4 行）
  function handleInputChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    setInput(e.target.value);
    const el = e.target;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 96) + "px";
  }

  const hasContext = relatedNotes.length > 0 || resonanceLoading;

  return (
    <aside
      className="flex flex-col"
      style={{
        width: `${width}px`,
        minWidth: `${width}px`,
        background: "rgba(28,28,30,0.82)",
        backdropFilter: "blur(40px) saturate(1.8)",
        WebkitBackdropFilter: "blur(40px) saturate(1.8)",
        ...(embedded
          ? {
              margin: "10px 10px 10px 6px",
              borderRadius: "16px",
              border: "0.5px solid rgba(255,255,255,0.06)",
              boxShadow: "inset 0 0.5px 0 rgba(255,255,255,0.05), 0 10px 24px rgba(0,0,0,0.2)",
            }
          : {
              margin: "10px 10px 10px 0",
              borderRadius: "16px",
              border: "0.5px solid rgba(255,255,255,0.06)",
              boxShadow: "inset 0 0.5px 0 rgba(255,255,255,0.05), 0 10px 24px rgba(0,0,0,0.2)",
            }),
        overflow: "hidden",
      }}
    >
      {/* ===== Header ===== */}
      <div
        className="px-4 py-3 flex items-center justify-between shrink-0"
        style={{ borderBottom: "0.5px solid rgba(255,255,255,0.04)" }}
      >
        <div className="flex items-center gap-2">
          <svg className="w-4 h-4" style={{ color: "var(--accent)" }}
            viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
            strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
          <span className="text-[13px] font-semibold" style={{ color: "var(--text-primary)" }}>
            AI 助手
          </span>
        </div>
        {messages.length > 0 && (
          <button
            type="button"
            onClick={() => setMessages([])}
            className="text-[11px] px-2 py-1 rounded-[7px] transition-all duration-150 cursor-pointer
              hover:bg-white/[0.08]"
            style={{ color: "var(--text-quaternary)", background: "rgba(118,118,128,0.08)" }}
          >
            清空
          </button>
        )}
      </div>

      {/* ===== Chat History ===== */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-3 space-y-3 min-h-0">
        {messages.length === 0 && (
          <div className="flex flex-col items-center py-14 gap-3">
            <div className="w-12 h-12 rounded-[16px] flex items-center justify-center"
              style={{ background: "rgba(118,118,128,0.06)" }}>
              <svg className="w-6 h-6" style={{ color: "var(--text-quinary)" }}
                viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"
                strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              </svg>
            </div>
            <p className="text-[12px] text-center leading-relaxed max-w-[200px]"
              style={{ color: "var(--text-quaternary)" }}>
              基于笔记内容的<br />智能问答助手
            </p>
            <p className="text-[11px] text-center" style={{ color: "var(--text-quinary)" }}>
              按 Enter 发送问题
            </p>
          </div>
        )}

        {messages.map((msg, i) => (
          <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
            <div
              className={`max-w-[90%] rounded-[14px] px-3.5 py-2.5 text-[13px] leading-relaxed ${
                msg.role === "user" ? "" : ""
              }`}
              style={
                msg.role === "user"
                  ? {
                      background: "linear-gradient(135deg, #0A84FF 0%, #0070E0 100%)",
                      color: "#fff",
                      boxShadow: "0 2px 8px rgba(10,132,255,0.2)",
                    }
                  : {
                      background: "rgba(118,118,128,0.08)",
                      color: "var(--text-primary)",
                    }
              }
            >
              {msg.role === "assistant" && msg.loading && !msg.content ? (
                <div className="flex items-center gap-2 py-0.5">
                  <div className="w-3.5 h-3.5 rounded-full border-[1.5px] animate-spin"
                    style={{ borderColor: "rgba(10,132,255,0.15)", borderTopColor: "var(--accent)" }} />
                  <span className="text-[12px]" style={{ color: "var(--text-tertiary)" }}>
                    检索笔记中…
                  </span>
                </div>
              ) : msg.role === "assistant" ? (
                <div className="ai-markdown"><Markdown>{msg.content}</Markdown></div>
              ) : (
                <span>{msg.content}</span>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* ===== Context Panel (语义共鸣) ===== */}
      {hasContext && (
        <div className="shrink-0" style={{ borderTop: "0.5px solid rgba(255,255,255,0.04)" }}>
          <button
            type="button"
            onClick={() => setContextOpen(prev => !prev)}
            className="w-full px-3.5 py-2 flex items-center justify-between cursor-pointer
              hover:bg-white/[0.03] transition-colors duration-150"
          >
            <div className="flex items-center gap-2">
              <div className="relative">
                <svg className="w-3 h-3" style={{ color: "var(--text-quaternary)" }}
                  viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                  strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="3" />
                  <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
                </svg>
                {resonanceLoading && (
                  <span className="absolute -top-0.5 -right-0.5 w-[4px] h-[4px] rounded-full animate-breathe"
                    style={{ background: "var(--accent)" }} />
                )}
              </div>
              <span className="text-[11px] font-medium" style={{ color: "var(--text-tertiary)" }}>
                共鸣上下文
              </span>
              {relatedNotes.length > 0 && (
                <span className="text-[10px] px-1.5 py-0.5 rounded-md"
                  style={{ background: "rgba(10,132,255,0.1)", color: "var(--accent)" }}>
                  {relatedNotes.length}
                </span>
              )}
            </div>
            <svg
              className="w-3 h-3 transition-transform duration-200"
              style={{
                color: "var(--text-quaternary)",
                transform: contextOpen ? "rotate(0deg)" : "rotate(-90deg)",
              }}
              viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
              strokeLinecap="round" strokeLinejoin="round"
            >
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>

          {contextOpen && relatedNotes.length > 0 && (
            <div className="px-2.5 pb-2 flex flex-wrap gap-1.5 max-h-[18vh] overflow-y-auto">
              {relatedNotes.map((note, i) => (
                <button
                  type="button"
                  key={note.id}
                  onClick={() => onSelectNote(note)}
                  className="animate-fade-in inline-flex items-center gap-1.5 px-2.5 py-[5px] rounded-[8px]
                    text-[11px] cursor-pointer transition-all duration-150
                    hover:bg-white/[0.08] active:scale-[0.97]"
                  title={note.name}
                  style={{
                    animationDelay: `${i * 30}ms`,
                    background: "rgba(118,118,128,0.06)",
                    color: "var(--text-secondary)",
                  }}
                >
                  <svg className="w-3 h-3 shrink-0" style={{ color: "var(--text-quaternary)" }}
                    viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"
                    strokeLinecap="round" strokeLinejoin="round">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                    <polyline points="14 2 14 8 20 8" />
                  </svg>
                  <span className="truncate max-w-[120px]">{note.name}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ===== Input Area ===== */}
      <div className="shrink-0 px-3 pb-3 pt-2" style={{ borderTop: hasContext ? "none" : "0.5px solid rgba(255,255,255,0.04)" }}>
        <div
          className="flex items-end gap-2 rounded-[14px] px-3.5 py-2.5 transition-all duration-200"
          style={{
            background: "rgba(118,118,128,0.08)",
            border: "0.5px solid rgba(255,255,255,0.06)",
            boxShadow: "inset 0 1px 3px rgba(0,0,0,0.15)",
          }}
        >
          <textarea
            ref={inputRef}
            value={input}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            placeholder={streaming ? "AI 正在回答…" : "向知识库提问…"}
            disabled={streaming}
            rows={1}
            className="flex-1 bg-transparent text-[13px] leading-relaxed outline-none resize-none
              disabled:opacity-50 placeholder:text-[var(--text-quaternary)]"
            style={{
              color: "var(--text-primary)",
              caretColor: "var(--accent)",
              maxHeight: "96px",
            }}
          />
          <button
            type="button"
            onClick={handleSubmit}
            disabled={streaming || !input.trim()}
            aria-label="发送"
            className="apple-btn w-7 h-7 rounded-[9px] flex items-center justify-center shrink-0
              transition-all cursor-pointer disabled:opacity-25"
            style={{
              background: input.trim()
                ? "linear-gradient(135deg, #0A84FF 0%, #0070E0 100%)"
                : "rgba(118,118,128,0.12)",
              boxShadow: input.trim() ? "0 2px 6px rgba(10,132,255,0.3)" : "none",
            }}
          >
            <svg className="w-3.5 h-3.5 text-white" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="22" y1="2" x2="11" y2="13" />
              <polygon points="22 2 15 22 11 13 2 9 22 2" />
            </svg>
          </button>
        </div>
        <div className="flex items-center gap-2 mt-1.5 px-1">
          <span className="text-[10px] flex items-center gap-1" style={{ color: "var(--text-quinary)" }}>
            <kbd className="px-1 py-[1px] rounded text-[9px] font-mono"
              style={{ background: "rgba(118,118,128,0.08)" }}>Enter</kbd>
            发送
          </span>
          <span className="text-[10px] flex items-center gap-1" style={{ color: "var(--text-quinary)" }}>
            <kbd className="px-1 py-[1px] rounded text-[9px] font-mono"
              style={{ background: "rgba(118,118,128,0.08)" }}>Shift+Enter</kbd>
            换行
          </span>
        </div>
      </div>
    </aside>
  );
}
