import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useDebounce } from "../hooks/useDebounce";
import type { NoteInfo, TimelineEvent } from "../types";
import type { DisciplineProfile } from "./settings/settingsTypes";

interface TimelineEditorProps {
  initialContent: string;
  onSave: (content: string) => void;
  notes: NoteInfo[];
  activeDiscipline?: DisciplineProfile;
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

function createEmptyEvent(): TimelineEvent {
  return {
    id: crypto.randomUUID(),
    date: new Date().toISOString().slice(0, 10),
    title: "",
    description: "",
    durationMinutes: 0,
    folders: [],
  };
}

function normalizeFolderPath(value: string): string {
  const normalized = value.trim().replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  return normalized || "根目录";
}

function parseFolderInput(raw: string): string[] {
  const seen = new Set<string>();
  for (const chunk of raw.split(",")) {
    if (!chunk.trim()) {
      continue;
    }
    const next = normalizeFolderPath(chunk);
    if (next) {
      seen.add(next);
    }
  }
  return Array.from(seen);
}

function moveItem(events: TimelineEvent[], fromIndex: number, toIndex: number): TimelineEvent[] {
  if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0 || fromIndex >= events.length || toIndex >= events.length) {
    return events;
  }
  const next = [...events];
  const [item] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, item);
  return next;
}

const SessionRow = memo(function SessionRow({
  index,
  event,
  hasIssue,
  folderOptions,
  onChange,
  onMoveUp,
  onMoveDown,
  onDelete,
}: {
  index: number;
  event: TimelineEvent;
  hasIssue: boolean;
  folderOptions: string[];
  onChange: (id: string, patch: Partial<TimelineEvent>) => void;
  onMoveUp: (id: string) => void;
  onMoveDown: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const [foldersText, setFoldersText] = useState((event.folders ?? []).join(", "));
  const selectedFolders = useMemo(
    () => new Set((event.folders ?? []).map(folder => normalizeFolderPath(folder))),
    [event.folders]
  );

  useEffect(() => {
    setFoldersText((event.folders ?? []).join(", "));
  }, [event.folders]);

  const quickFolders = useMemo(
    () => folderOptions.filter(folder => !selectedFolders.has(folder)).slice(0, 6),
    [folderOptions, selectedFolders]
  );

  const applyFolders = () => {
    onChange(event.id, { folders: parseFolderInput(foldersText) });
  };

  return (
    <div
      className={`rounded-md border p-4 ${
        hasIssue ? "border-red-500/50 shadow-[0_0_0_1px_rgba(239,68,68,0.25)]" : "border-[#2F2F2F]"
      }`}
      style={{ background: "var(--subtle-surface)" }}
    >
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="text-[11px] font-mono tracking-wider text-[var(--text-quaternary)]">
          SESSION #{index + 1}
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            className="px-2 py-1 rounded border border-white/15 text-[11px] text-[var(--text-secondary)] hover:bg-white/10"
            onClick={() => onMoveUp(event.id)}
            title="上移"
          >
            ↑
          </button>
          <button
            type="button"
            className="px-2 py-1 rounded border border-white/15 text-[11px] text-[var(--text-secondary)] hover:bg-white/10"
            onClick={() => onMoveDown(event.id)}
            title="下移"
          >
            ↓
          </button>
          <button
            type="button"
            className="px-2 py-1 rounded border border-red-500/30 text-[11px] text-red-200 hover:bg-red-500/10"
            onClick={() => onDelete(event.id)}
            title="删除"
          >
            删除
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[180px_1fr_150px] gap-2.5">
        <input
          value={event.date}
          onChange={e => onChange(event.id, { date: e.target.value })}
          placeholder="学习日期"
          className="h-9 px-3 rounded bg-black/20 border border-white/10 outline-none text-sm text-[var(--text-secondary)] focus:border-white/30"
        />
        <input
          value={event.title}
          onChange={e => onChange(event.id, { title: e.target.value })}
          placeholder="学习主题（例如：亲核取代反应）"
          className="h-9 px-3 rounded bg-black/20 border border-white/10 outline-none text-sm text-white focus:border-white/30"
        />
        <div className="relative">
          <input
            type="number"
            min={0}
            step={5}
            value={event.durationMinutes}
            onChange={e => {
              const raw = e.target.value;
              const next = raw === "" ? 0 : Number(raw);
              onChange(event.id, {
                durationMinutes: Number.isFinite(next) ? Math.max(0, Math.round(next)) : 0,
              });
            }}
            className="h-9 w-full px-3 pr-11 rounded bg-black/20 border border-white/10 outline-none text-sm text-white focus:border-white/30"
          />
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[11px] text-[var(--text-quaternary)]">
            min
          </span>
        </div>
      </div>

      <div className="mt-2.5">
        <input
          value={foldersText}
          onChange={e => setFoldersText(e.target.value)}
          onBlur={applyFolders}
          placeholder="学习文件夹（逗号分隔，例如：Organic/Chapter-2, Lab/Week-3）"
          className="h-9 w-full px-3 rounded bg-black/20 border border-white/10 outline-none text-sm text-[var(--text-secondary)] focus:border-white/30"
        />
        <div className="mt-2 flex flex-wrap gap-1.5">
          {(event.folders ?? []).map(folder => (
            <span
              key={`${event.id}-folder-${folder}`}
              className="inline-flex items-center rounded px-2 py-1 text-[11px] font-mono"
              style={{ background: "rgba(30,58,138,0.18)", color: "#93C5FD", border: "1px solid rgba(59,130,246,0.3)" }}
            >
              {folder}
            </span>
          ))}
          {quickFolders.map(folder => (
            <button
              key={`${event.id}-suggest-${folder}`}
              type="button"
              onClick={() => {
                const merged = Array.from(new Set([...(event.folders ?? []), folder]));
                onChange(event.id, { folders: merged });
              }}
              className="rounded px-2 py-1 text-[11px] border border-white/15 text-[var(--text-quaternary)] hover:bg-white/10"
            >
              + {folder}
            </button>
          ))}
        </div>
      </div>

      <textarea
        value={event.description}
        onChange={e => onChange(event.id, { description: e.target.value })}
        rows={3}
        placeholder="学习内容摘要（反应机理、例题、实验要点等）"
        className="mt-2.5 w-full resize-y px-3 py-2 rounded bg-black/20 border border-white/10 outline-none text-sm text-[var(--text-secondary)] leading-relaxed focus:border-white/30"
      />
    </div>
  );
});

export default function TimelineEditor({
  initialContent,
  onSave,
  notes,
  activeDiscipline = "chemistry",
}: TimelineEditorProps) {
  const [events, setEvents] = useState<TimelineEvent[]>([]);
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
        const normalized = Array.isArray(parsed.events)
          ? parsed.events.map(event => ({
            ...event,
            durationMinutes: Number.isFinite(event.durationMinutes)
              ? Math.max(0, Math.round(event.durationMinutes))
              : 0,
            folders: Array.isArray(event.folders)
              ? Array.from(new Set(event.folders.map(folder => normalizeFolderPath(String(folder)))))
              : [],
          }))
          : [];
        setEvents(normalized);
        setValidationIssues(Array.isArray(parsed.issues) ? parsed.issues : []);
      } catch {
        if (cancelled) return;
        setEvents([]);
        setValidationIssues([{
          nodeId: "",
          issue: "学习时间线解析失败，已回退为空。",
          suggestion: "请检查文件 JSON 格式。",
        }]);
      }
    };
    void parseFromRust();
    return () => {
      cancelled = true;
    };
  }, [initialContent]);

  const debouncedSave = useDebounce((nextEvents: TimelineEvent[]) => {
    onSave(JSON.stringify({ events: nextEvents }, null, 2));
  }, 700);

  useEffect(() => {
    debouncedSave(events);
  }, [events, debouncedSave]);

  const mergedIssues = useMemo(() => [...validationIssues, ...issues], [validationIssues, issues]);
  const issueNodeIds = useMemo(() => new Set(mergedIssues.map(i => i.nodeId)), [mergedIssues]);
  const folderOptions = useMemo(() => {
    const folders = new Set<string>();
    for (const note of notes) {
      const raw = (note.id || note.path || "").replace(/\\/g, "/");
      const index = raw.lastIndexOf("/");
      folders.add(index > 0 ? normalizeFolderPath(raw.slice(0, index)) : "根目录");
    }
    return Array.from(folders).sort((a, b) => a.localeCompare(b, "zh-CN"));
  }, [notes]);

  const totalMinutes = useMemo(
    () => events.reduce((sum, item) => sum + (Number.isFinite(item.durationMinutes) ? Math.max(0, item.durationMinutes) : 0), 0),
    [events]
  );
  const uniqueFolders = useMemo(
    () => new Set(events.flatMap(item => item.folders ?? []).map(folder => normalizeFolderPath(folder))).size,
    [events]
  );

  const updateEvent = useCallback((id: string, patch: Partial<TimelineEvent>) => {
    setEvents(prev => prev.map(ev => {
      if (ev.id !== id) return ev;
      const merged: TimelineEvent = { ...ev, ...patch };
      const duration = Number.isFinite(merged.durationMinutes) ? Math.max(0, Math.round(merged.durationMinutes)) : 0;
      const folders = Array.isArray(merged.folders)
        ? Array.from(new Set(merged.folders.map(folder => normalizeFolderPath(folder))))
        : [];
      return {
        ...merged,
        durationMinutes: duration,
        folders,
      };
    }));
  }, []);

  const insertEventAt = useCallback((index: number) => {
    setEvents(prev => {
      const next = [...prev];
      next.splice(index, 0, createEmptyEvent());
      return next;
    });
  }, []);

  const removeEvent = useCallback((id: string) => {
    setEvents(prev => prev.filter(event => event.id !== id));
  }, []);

  const moveEventUp = useCallback((id: string) => {
    setEvents(prev => {
      const index = prev.findIndex(item => item.id === id);
      return moveItem(prev, index, index - 1);
    });
  }, []);

  const moveEventDown = useCallback((id: string) => {
    setEvents(prev => {
      const index = prev.findIndex(item => item.id === id);
      return moveItem(prev, index, index + 1);
    });
  }, []);

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
          .filter(item => item.issue)
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

  if (activeDiscipline !== "chemistry") {
    return (
      <div className="flex-1 flex items-center justify-center text-sm text-[var(--text-quaternary)]">
        学习轨迹时间线仅在化学模式下启用。
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-auto relative" style={{ background: "var(--surface-0)", color: "var(--text-primary)" }}>
      <div
        className="sticky top-0 z-20 px-6 py-3 backdrop-blur-sm"
        style={{ background: "var(--surface-0)", borderBottom: "1px solid var(--separator-light)" }}
      >
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="rounded-md border border-white/10 px-3 py-1.5">
            <p className="text-[10px] font-mono tracking-wider text-[var(--text-quaternary)]">SESSIONS</p>
            <p className="text-sm text-white">{events.length}</p>
          </div>
          <div className="rounded-md border border-white/10 px-3 py-1.5">
            <p className="text-[10px] font-mono tracking-wider text-[var(--text-quaternary)]">TOTAL STUDY</p>
            <p className="text-sm text-white">{totalMinutes} min / {(totalMinutes / 60).toFixed(1)} h</p>
          </div>
          <div className="rounded-md border border-white/10 px-3 py-1.5">
            <p className="text-[10px] font-mono tracking-wider text-[var(--text-quaternary)]">FOLDERS TOUCHED</p>
            <p className="text-sm text-white">{uniqueFolders}</p>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              onClick={() => insertEventAt(events.length)}
              className="px-3 py-1.5 rounded-md border border-white/15 text-[12px] hover:bg-white/10"
            >
              新增学习记录
            </button>
            <button
              type="button"
              onClick={() => void analyzeTimeline()}
              disabled={analyzing}
              className="px-3 py-1.5 rounded-md border border-white/15 text-[12px] hover:bg-white/10 disabled:opacity-50"
            >
              {analyzing ? "正在分析..." : "分析学习轨迹"}
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto py-6 px-6 space-y-3">
        {events.length === 0 ? (
          <div className="rounded-md border border-dashed border-white/15 p-8 text-center text-sm text-[var(--text-quaternary)]">
            还没有学习记录，点击上方「新增学习记录」开始追踪化学学习进度。
          </div>
        ) : (
          events.map((event, index) => (
            <SessionRow
              key={event.id}
              index={index}
              event={event}
              hasIssue={issueNodeIds.has(event.id)}
              folderOptions={folderOptions}
              onChange={updateEvent}
              onMoveUp={moveEventUp}
              onMoveDown={moveEventDown}
              onDelete={removeEvent}
            />
          ))
        )}
      </div>

      <div
        className={`fixed right-0 top-[34px] bottom-[28px] w-[360px] transform transition-transform ${
          drawerOpen ? "translate-x-0" : "translate-x-full"
        }`}
        style={{ background: "var(--surface-1)", borderLeft: "1px solid var(--separator-light)" }}
      >
        <div className="px-4 py-3 flex items-center justify-between" style={{ borderBottom: "1px solid var(--separator-light)" }}>
          <h3 className="text-[13px] font-semibold">学习轨迹分析结果</h3>
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
