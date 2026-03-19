import {
  memo,
  startTransition,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { invoke, Channel } from "@tauri-apps/api/core";
import Markdown from "react-markdown";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/contrib/mhchem";
import "katex/dist/katex.min.css";
import SmilesViewer from "./SmilesViewer";
import type { NoteInfo } from "../types";
import { useT } from "../i18n";

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
}

interface StreamingAssistantMessage {
  id: string;
  content: string;
  loading: boolean;
}

interface AIAssistantSidebarProps {
  width: number;
  relatedNotes: NoteInfo[];
  resonanceLoading: boolean;
  onSelectNote: (note: NoteInfo) => void;
  embedded?: boolean;
  activeNoteId?: string;
}

function createMessageId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

const markdownComponents = {
  code({
    className,
    children,
    ...props
  }: React.HTMLAttributes<HTMLElement> & { children?: React.ReactNode }) {
    if (/language-smiles/.test(className || "")) {
      const smiles = String(children).replace(/\n$/, "");
      return <SmilesViewer smiles={smiles} />;
    }

    return (
      <code className={className} {...props}>
        {children}
      </code>
    );
  },
};

const ChatBubble = memo(function ChatBubble({
  role,
  content,
  loading,
}: {
  role: "user" | "assistant";
  content: string;
  loading?: boolean;
}) {
  const t = useT();
  return (
    <div className={`flex ${role === "user" ? "justify-end" : "justify-start"}`}>
      <div
        className="max-w-[90%] rounded-[14px] px-3.5 py-2.5 text-[13px] leading-relaxed"
        style={
          role === "user"
            ? {
                background: "linear-gradient(135deg, #0A84FF 0%, #0070E0 100%)",
                color: "#fff",
                boxShadow: "0 2px 8px rgba(10,132,255,0.2)",
              }
            : {
                background: "var(--subtle-surface)",
                color: "var(--text-primary)",
              }
        }
      >
        {role === "assistant" && loading && !content ? (
          <div className="flex items-center gap-2 py-0.5">
            <div
              className="w-3.5 h-3.5 rounded-full border-[1.5px] animate-spin"
              style={{ borderColor: "rgba(10,132,255,0.15)", borderTopColor: "var(--accent)" }}
            />
            <span className="text-[12px]" style={{ color: "var(--text-tertiary)" }}>
              {t("ai.retrieving")}
            </span>
          </div>
        ) : role === "assistant" ? (
          <div className="ai-markdown">
            <Markdown
              remarkPlugins={[remarkMath]}
              rehypePlugins={[[rehypeKatex, { strict: false, trust: true, throwOnError: false }]]}
              components={markdownComponents}
            >
              {content}
            </Markdown>
          </div>
        ) : (
          <span>{content}</span>
        )}
      </div>
    </div>
  );
});

export default function AIAssistantSidebar({
  width,
  relatedNotes,
  resonanceLoading,
  onSelectNote,
  embedded,
  activeNoteId,
}: AIAssistantSidebarProps) {
  const t = useT();
  const [history, setHistory] = useState<ChatMessage[]>([]);
  const [streamingMessage, setStreamingMessage] = useState<StreamingAssistantMessage | null>(null);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [contextOpen, setContextOpen] = useState(true);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const streamingContentRef = useRef("");
  const deferredStreamingContent = useDeferredValue(streamingMessage?.content ?? "");

  const renderedMessages = useMemo(() => {
    if (!streamingMessage) {
      return history;
    }

    return [
      ...history,
      {
        id: streamingMessage.id,
        role: "assistant" as const,
        content: deferredStreamingContent,
      },
    ];
  }, [deferredStreamingContent, history, streamingMessage]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [renderedMessages, streamingMessage?.loading]);

  const clearConversation = useCallback(() => {
    setHistory([]);
    setStreamingMessage(null);
    streamingContentRef.current = "";
  }, []);

  const finalizeAssistantMessage = useCallback((content: string) => {
    setHistory(prev => [
      ...prev,
      {
        id: createMessageId("assistant"),
        role: "assistant",
        content,
      },
    ]);
    setStreamingMessage(null);
    streamingContentRef.current = "";
  }, []);

  const handleSubmit = useCallback(async () => {
    const question = input.trim();
    if (!question || streaming) {
      return;
    }

    const userMessage: ChatMessage = {
      id: createMessageId("user"),
      role: "user",
      content: question,
    };
    const streamingId = createMessageId("stream");

    setInput("");
    setStreaming(true);
    setHistory(prev => [...prev, userMessage]);
    setStreamingMessage({
      id: streamingId,
      content: "",
      loading: true,
    });
    streamingContentRef.current = "";

    try {
      const channel = new Channel<string>();
      channel.onmessage = chunk => {
        streamingContentRef.current += chunk;
        startTransition(() => {
          setStreamingMessage(prev =>
            prev
              ? {
                  ...prev,
                  content: streamingContentRef.current,
                  loading: false,
                }
              : prev
          );
        });
      };

      await invoke("ask_vault", {
        question,
        activeNoteId: activeNoteId ?? null,
        onEvent: channel,
      });

      finalizeAssistantMessage(streamingContentRef.current);
    } catch (cause) {
      const message = `${t("ai.error")}${cause instanceof Error ? cause.message : String(cause)}`;
      finalizeAssistantMessage(message);
    } finally {
      setStreaming(false);
    }
  }, [activeNoteId, finalizeAssistantMessage, input, streaming]);

  const handleKeyDown = useCallback((event: React.KeyboardEvent) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void handleSubmit();
    }
  }, [handleSubmit]);

  const handleInputChange = useCallback((event: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(event.target.value);
    const element = event.target;
    element.style.height = "auto";
    element.style.height = `${Math.min(element.scrollHeight, 96)}px`;
  }, []);

  const hasContext = relatedNotes.length > 0 || resonanceLoading;

  return (
    <aside
      className="flex flex-col workspace-panel"
      style={{
        width: `${width}px`,
        minWidth: `${width}px`,
        ...(embedded ? { margin: "0" } : { margin: "0" }),
        borderLeft: "0.5px solid var(--panel-border)",
        borderRight: "none",
        overflow: "hidden",
      }}
    >
      <div
        className="px-4 py-3 flex items-center justify-between shrink-0"
        style={{ borderBottom: "0.5px solid var(--panel-border)" }}
      >
        <div className="flex items-center gap-2">
          <svg
            className="w-4 h-4"
            style={{ color: "var(--accent)" }}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
          <span className="text-[13px] font-semibold" style={{ color: "var(--text-primary)" }}>
            {t("ai.title")}
          </span>
        </div>
        {(history.length > 0 || streamingMessage) && (
          <button
            type="button"
            onClick={clearConversation}
            className="text-[11px] px-2 py-1 rounded-[7px] transition-all duration-150 cursor-pointer hover:bg-[var(--sidebar-hover)]"
            style={{ color: "var(--text-quaternary)", background: "var(--subtle-surface-strong)" }}
          >
            {t("ai.clear")}
          </button>
        )}
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-3 space-y-3 min-h-0">
        {renderedMessages.length === 0 && (
          <div className="flex flex-col items-center py-14 gap-3">
            <div
              className="w-12 h-12 rounded-[16px] flex items-center justify-center"
              style={{ background: "var(--subtle-surface)" }}
            >
              <svg
                className="w-6 h-6"
                style={{ color: "var(--text-quinary)" }}
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              </svg>
            </div>
            <p
              className="text-[12px] text-center leading-relaxed max-w-[200px] whitespace-pre-line"
              style={{ color: "var(--text-quaternary)" }}
            >
              {t("ai.emptyHint")}
            </p>
            <p className="text-[11px] text-center" style={{ color: "var(--text-quinary)" }}>
              {t("ai.enterHint")}
            </p>
          </div>
        )}

        {renderedMessages.map(message => {
          const isStreamingBubble = streamingMessage && message.id === streamingMessage.id;
          return (
            <ChatBubble
              key={message.id}
              role={message.role}
              content={message.content}
              loading={isStreamingBubble ? streamingMessage.loading : false}
            />
          );
        })}
      </div>

      {hasContext && (
        <div className="shrink-0" style={{ borderTop: "0.5px solid var(--panel-border)" }}>
          <button
            type="button"
            onClick={() => setContextOpen(prev => !prev)}
            className="w-full px-3.5 py-2 flex items-center justify-between cursor-pointer hover:bg-[var(--sidebar-hover)] transition-colors duration-150"
          >
            <div className="flex items-center gap-2">
              <div className="relative">
                <svg
                  className="w-3 h-3"
                  style={{ color: "var(--text-quaternary)" }}
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <circle cx="12" cy="12" r="3" />
                  <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
                </svg>
                {resonanceLoading && (
                  <span
                    className="absolute -top-0.5 -right-0.5 w-[4px] h-[4px] rounded-full animate-breathe"
                    style={{ background: "var(--accent)" }}
                  />
                )}
              </div>
              <span className="text-[11px] font-medium" style={{ color: "var(--text-tertiary)" }}>
                {t("ai.resonanceContext")}
              </span>
              {relatedNotes.length > 0 && (
                <span
                  className="text-[10px] px-1.5 py-0.5 rounded-md"
                  style={{ background: "rgba(10,132,255,0.1)", color: "var(--accent)" }}
                >
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
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>

          {contextOpen && relatedNotes.length > 0 && (
            <div className="px-2.5 pb-2 flex flex-wrap gap-1.5 max-h-[18vh] overflow-y-auto">
              {relatedNotes.map((note, index) => (
                <button
                  type="button"
                  key={note.id}
                  onClick={() => onSelectNote(note)}
                  className="animate-fade-in inline-flex items-center gap-1.5 px-2.5 py-[5px] rounded-[8px] text-[11px] cursor-pointer transition-all duration-150 hover:bg-[var(--sidebar-hover)] active:scale-[0.97]"
                  title={note.name}
                  style={{
                    animationDelay: `${index * 30}ms`,
                    background: "var(--subtle-surface)",
                    color: "var(--text-secondary)",
                  }}
                >
                  <svg
                    className="w-3 h-3 shrink-0"
                    style={{ color: "var(--text-quaternary)" }}
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
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

      <div
        className="shrink-0 px-3 pb-3 pt-2"
        style={{ borderTop: hasContext ? "none" : "0.5px solid var(--panel-border)" }}
      >
        <div
          className="flex items-end gap-2 rounded-[14px] px-3.5 py-2.5 transition-all duration-200"
          style={{
            background: "var(--subtle-surface)",
            border: "0.5px solid var(--panel-border)",
            boxShadow: "inset 0 1px 3px rgba(0,0,0,0.15)",
          }}
        >
          <textarea
            ref={inputRef}
            value={input}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            placeholder={streaming ? t("ai.streaming") : t("ai.placeholder")}
            disabled={streaming}
            rows={1}
            className="flex-1 bg-transparent text-[13px] leading-relaxed outline-none resize-none disabled:opacity-50 placeholder:text-[var(--text-quaternary)]"
            style={{
              color: "var(--text-primary)",
              caretColor: "var(--accent)",
              maxHeight: "96px",
            }}
          />
          <button
            type="button"
            onClick={() => {
              void handleSubmit();
            }}
            disabled={streaming || !input.trim()}
            aria-label={t("ai.send")}
            className="apple-btn w-7 h-7 rounded-[9px] flex items-center justify-center shrink-0 transition-all cursor-pointer disabled:opacity-25"
            style={{
              background: input.trim()
                ? "linear-gradient(135deg, #0A84FF 0%, #0070E0 100%)"
                : "var(--subtle-surface-strong)",
              boxShadow: input.trim() ? "0 2px 6px rgba(10,132,255,0.3)" : "none",
            }}
          >
            <svg
              className="w-3.5 h-3.5 text-white"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="22" y1="2" x2="11" y2="13" />
              <polygon points="22 2 15 22 11 13 2 9 22 2" />
            </svg>
          </button>
        </div>
        <div className="flex items-center gap-2 mt-1.5 px-1">
          <span className="text-[10px]" style={{ color: "var(--text-quinary)" }}>
            {t("ai.enterToSend")}
          </span>
          <span className="text-[10px]" style={{ color: "var(--text-quinary)" }}>
            {t("ai.shiftEnterNewLine")}
          </span>
        </div>
      </div>
    </aside>
  );
}
