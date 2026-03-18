import { useCallback, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useDebounce } from "../hooks/useDebounce";
import type { NoteInfo, TimelineEvent } from "../types";
import type { DisciplineProfile } from "./settings/settingsTypes";
import TimelineSessionRow from "./timeline/TimelineSessionRow";
import {
  createEmptyEvent,
  moveItem,
  normalizeFolderPath,
  normalizeTimelineEvent,
} from "./timeline/timelineUtils";

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
          ? parsed.events.map(normalizeTimelineEvent)
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
      return normalizeTimelineEvent(merged);
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
            <TimelineSessionRow
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
