import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useDebounce } from "../hooks/useDebounce";
import type { NoteInfo, TimelineEvent } from "../types";

interface TimelineEditorProps {
  initialContent: string;
  onSave: (content: string) => void;
  notes: NoteInfo[];
  onSelectNote: (note: NoteInfo) => void;
}

interface TimelineIssue {
  nodeId: string;
  issue: string;
  suggestion: string;
}

interface TimelineParseResult {
  events: TimelineEvent[];
  issues: TimelineIssue[];
}

interface NoteOption {
  id: string;
  name: string;
}

function createEmptyEvent(): TimelineEvent {
  return {
    id: crypto.randomUUID(),
    date: "",
    title: "新事件",
    description: "",
    linkedNoteId: "",
  };
}

function moveItem(events: TimelineEvent[], fromIndex: number, toIndex: number): TimelineEvent[] {
  if (fromIndex === toIndex) return events;
  const next = [...events];
  const [item] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, item);
  return next;
}

const TimelineCard = memo(function TimelineCard({
  event,
  side,
  hasIssue,
  linkedNote,
  noteOptions,
  onChange,
  onDragStart,
  onDropTo,
  onNavigateToNote,
}: {
  event: TimelineEvent;
  side: "left" | "right";
  hasIssue: boolean;
  linkedNote: NoteInfo | null;
  noteOptions: NoteOption[];
  onChange: (id: string, patch: Partial<TimelineEvent>) => void;
  onDragStart: (id: string) => void;
  onDropTo: (id: string) => void;
  onNavigateToNote: (note: NoteInfo) => void;
}) {
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const query = (event.linkedNoteId ?? "").trim().toLowerCase();
  const suggestions = useMemo(() => {
    const ranked = noteOptions.filter(option => {
      const id = option.id.toLowerCase();
      const name = option.name.toLowerCase();
      return !query || id.includes(query) || name.includes(query);
    });
    return ranked.slice(0, 8);
  }, [noteOptions, query]);

  const pickSuggestion = (option: NoteOption) => {
    onChange(event.id, { linkedNoteId: option.id });
    setSuggestOpen(false);
    setActiveIndex(0);
  };

  return (
    <div className={`w-[45%] ${side === "left" ? "mr-auto pr-6" : "ml-auto pl-6"}`}>
      <div
        draggable
        onDragStart={() => onDragStart(event.id)}
        onDragOver={e => e.preventDefault()}
        onDrop={() => onDropTo(event.id)}
        className={`p-5 rounded-lg transition-transform hover:-translate-y-1 ${
          hasIssue ? "animate-breathe shadow-[0_0_10px_rgba(220,38,38,0.2)]" : ""
        }`}
        style={{ background: "var(--subtle-surface)", border: "1px solid var(--separator-light)" }}
      >
        <input
          value={event.date}
          onChange={e => onChange(event.id, { date: e.target.value })}
          placeholder="例如：宇宙纪元 0079 / 危机纪元 205"
          className="w-full mb-2 bg-transparent outline-none font-mono text-sm tracking-widest text-[var(--text-secondary)]"
        />
        <input
          value={event.title}
          onChange={e => onChange(event.id, { title: e.target.value })}
          placeholder="事件标题"
          className="w-full mb-2 bg-transparent outline-none text-[17px] font-semibold text-white"
        />
        <textarea
          value={event.description}
          onChange={e => onChange(event.id, { description: e.target.value })}
          placeholder="事件描述..."
          rows={4}
          className="w-full resize-y bg-transparent outline-none text-[13px] leading-relaxed text-[var(--text-tertiary)]"
        />
        <div className="relative mt-3 border-t border-white/10 pt-2">
          <input
            value={event.linkedNoteId ?? ""}
            onFocus={() => setSuggestOpen(true)}
            onBlur={() => {
              window.setTimeout(() => setSuggestOpen(false), 120);
            }}
            onChange={e => {
              onChange(event.id, { linkedNoteId: e.target.value });
              setSuggestOpen(true);
              setActiveIndex(0);
            }}
            onKeyDown={e => {
              if (!suggestOpen || suggestions.length === 0) return;
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setActiveIndex(prev => (prev + 1) % suggestions.length);
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setActiveIndex(prev => (prev - 1 + suggestions.length) % suggestions.length);
              } else if (e.key === "Enter") {
                e.preventDefault();
                pickSuggestion(suggestions[activeIndex]);
              } else if (e.key === "Escape") {
                setSuggestOpen(false);
              }
            }}
            placeholder="关联笔记编号（支持按编号/标题搜索）"
            className="w-full bg-transparent outline-none text-[11px] text-[var(--text-tertiary)]"
          />
          {suggestOpen && suggestions.length > 0 && (
            <div className="absolute z-20 left-0 right-0 top-[calc(100%+6px)] rounded-md overflow-hidden"
              style={{ border: "1px solid var(--separator-light)", background: "var(--menu-bg)", boxShadow: "0 12px 28px rgba(0,0,0,0.35)" }}>
              {suggestions.map((option, index) => (
                <button
                  key={option.id}
                  type="button"
                  onMouseDown={e => e.preventDefault()}
                  onClick={() => pickSuggestion(option)}
                  className={`w-full text-left px-3 py-2 border-b border-white/5 last:border-b-0 ${
                    activeIndex === index ? "bg-white/10" : "hover:bg-white/6"
                  }`}
                >
                  <div className="text-[11px] text-[var(--text-secondary)] truncate">{option.id}</div>
                  <div className="text-[10px] text-[var(--text-tertiary)] truncate">{option.name}</div>
                </button>
              ))}
            </div>
          )}
        </div>
        {event.linkedNoteId?.trim() && (
          <div className="mt-2 flex items-center justify-between gap-2">
            <span className="text-[11px] text-[var(--text-tertiary)] truncate">
              {linkedNote ? `已关联: ${linkedNote.name}` : "未找到对应笔记"}
            </span>
            {linkedNote && (
              <button
                type="button"
                onClick={() => onNavigateToNote(linkedNote)}
                className="shrink-0 px-2 py-1 rounded text-[11px] hover:bg-white/10"
                style={{ border: "1px solid var(--separator-light)", color: "var(--text-secondary)" }}
              >
                跳转
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
});

export default function TimelineEditor({ initialContent, onSave, notes, onSelectNote }: TimelineEditorProps) {
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [issues, setIssues] = useState<TimelineIssue[]>([]);
  const [validationIssues, setValidationIssues] = useState<TimelineIssue[]>([]);
  const [analyzing, setAnalyzing] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const parseFromRust = async () => {
      try {
        const parsed = await invoke<TimelineParseResult>("parse_timeline_content", { content: initialContent });
        if (cancelled) return;
        setEvents(Array.isArray(parsed.events) ? parsed.events : []);
        setValidationIssues(Array.isArray(parsed.issues) ? parsed.issues : []);
      } catch {
        if (cancelled) return;
        setEvents([]);
        setValidationIssues([{
          nodeId: "",
          issue: "本地时间轴解析失败，已回退为空。",
          suggestion: "请检查文件 JSON 格式。",
        }]);
      }
    };
    void parseFromRust();
    return () => {
      cancelled = true;
    };
  }, [initialContent]);

  const debouncedSave = useDebounce((payload: string) => onSave(payload), 700);

  useEffect(() => {
    const payload = JSON.stringify({ events }, null, 2);
    debouncedSave(payload);
  }, [events, debouncedSave]);

  const mergedIssues = useMemo(
    () => [...validationIssues, ...issues],
    [validationIssues, issues]
  );
  const issueNodeIds = useMemo(() => new Set(mergedIssues.map(i => i.nodeId)), [mergedIssues]);
  const notesById = useMemo(() => {
    const map = new Map<string, NoteInfo>();
    for (const note of notes) {
      map.set(note.id, note);
      map.set(note.path, note);
    }
    return map;
  }, [notes]);
  const noteOptions = useMemo<NoteOption[]>(
    () => notes.map(note => ({ id: note.id, name: note.name })),
    [notes]
  );

  const updateEvent = useCallback((id: string, patch: Partial<TimelineEvent>) => {
    setEvents(prev => prev.map(ev => (ev.id === id ? { ...ev, ...patch } : ev)));
  }, []);

  const insertEventAt = useCallback((index: number) => {
    setEvents(prev => {
      const next = [...prev];
      next.splice(index, 0, createEmptyEvent());
      return next;
    });
  }, []);

  const dropToEvent = useCallback((targetId: string) => {
    if (!draggingId || draggingId === targetId) return;
    setEvents(prev => {
      const fromIndex = prev.findIndex(e => e.id === draggingId);
      const toIndex = prev.findIndex(e => e.id === targetId);
      if (fromIndex < 0 || toIndex < 0) return prev;
      return moveItem(prev, fromIndex, toIndex);
    });
    setDraggingId(null);
  }, [draggingId]);

  const analyzeTimeline = useCallback(async () => {
    setAnalyzing(true);
    try {
      const timelineData = JSON.stringify({ events });
      const raw = await invoke<string>("analyze_timeline", { timelineData });
      const parsed = JSON.parse(raw);
      const normalized: TimelineIssue[] = Array.isArray(parsed)
        ? parsed
          .filter(item => item && typeof item === "object")
          .map(item => ({
            nodeId: String(item.nodeId ?? ""),
            issue: String(item.issue ?? ""),
            suggestion: String(item.suggestion ?? ""),
          }))
          .filter(item => item.nodeId && item.issue)
        : [];
      setIssues(normalized);
      setDrawerOpen(true);
    } catch {
      setIssues([{
        nodeId: "",
        issue: "分析失败：返回格式无效或请求错误。",
        suggestion: "请检查模型配置后重试。",
      }]);
      setDrawerOpen(true);
    } finally {
      setAnalyzing(false);
    }
  }, [events]);

  return (
    <div className="flex-1 overflow-auto relative" style={{ background: "var(--surface-0)", color: "var(--text-primary)" }}>
      <div className="sticky top-0 z-20 backdrop-blur-sm px-6 py-3 flex justify-end"
        style={{ background: "var(--surface-0)", borderBottom: "1px solid var(--separator-light)" }}>
        <button
          type="button"
          onClick={() => void analyzeTimeline()}
          disabled={analyzing}
          className="px-3 py-1.5 rounded-md border border-white/15 text-[12px] hover:bg-white/10 disabled:opacity-50"
        >
          {analyzing ? "正在分析..." : "分析时间轴"}
        </button>
      </div>

      <div className="relative max-w-6xl mx-auto py-10 px-6">
        <div className="absolute top-0 bottom-0 left-1/2 -translate-x-1/2 w-px" style={{ background: "var(--separator)" }} />

        {Array.from({ length: events.length + 1 }).map((_, slotIndex) => (
          <div key={`slot-${slotIndex}`} className="relative">
            <div className="h-7 group flex items-center justify-center">
              <button
                type="button"
                onClick={() => insertEventAt(slotIndex)}
                className="opacity-0 group-hover:opacity-100 transition-opacity w-6 h-6 rounded-full text-sm"
                style={{ border: "1px solid var(--separator-light)", background: "var(--subtle-surface)", color: "var(--text-tertiary)" }}
                title="在此插入事件"
              >
                +
              </button>
            </div>

            {slotIndex < events.length && (
              <div className="relative min-h-[140px] py-2">
                <div className="absolute left-1/2 top-8 -translate-x-1/2 w-3 h-3 rounded-full"
                  style={{ border: "1px solid var(--separator)", background: "var(--subtle-surface)" }} />
                <TimelineCard
                  event={events[slotIndex]}
                  side={slotIndex % 2 === 0 ? "left" : "right"}
                  hasIssue={issueNodeIds.has(events[slotIndex].id)}
                  linkedNote={events[slotIndex].linkedNoteId ? notesById.get(events[slotIndex].linkedNoteId) ?? null : null}
                  noteOptions={noteOptions}
                  onChange={updateEvent}
                  onDragStart={setDraggingId}
                  onDropTo={dropToEvent}
                  onNavigateToNote={onSelectNote}
                />
              </div>
            )}
          </div>
        ))}
      </div>

      <div
        className={`fixed right-0 top-[34px] bottom-[28px] w-[360px] transform transition-transform ${
          drawerOpen ? "translate-x-0" : "translate-x-full"
        }`}
        style={{ background: "var(--surface-1)", borderLeft: "1px solid var(--separator-light)" }}
      >
        <div className="px-4 py-3 flex items-center justify-between" style={{ borderBottom: "1px solid var(--separator-light)" }}>
          <h3 className="text-[13px] font-semibold">时间轴分析结果</h3>
          <button type="button" onClick={() => setDrawerOpen(false)} className="text-white/60 hover:text-white">
            关闭
          </button>
        </div>
        <div className="p-4 space-y-3 overflow-auto h-full pb-16">
          {mergedIssues.length === 0 ? (
            <p className="text-[12px] text-white/55">暂无冲突或建议。</p>
          ) : (
            mergedIssues.map((issue, idx) => (
              <div key={`${issue.nodeId}-${idx}`} className="rounded-md border border-red-500/30 bg-red-500/5 p-3">
                <p className="text-[11px] text-red-200 mb-1">节点: {issue.nodeId || "未知"}</p>
                <p className="text-[12px] text-white/90">{issue.issue}</p>
                <p className="text-[12px] text-white/65 mt-1">{issue.suggestion}</p>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
