import { memo, useEffect, useMemo, useState } from "react";
import type { TimelineEvent } from "../../types";
import { normalizeFolderPath, parseFolderInput } from "./timelineUtils";

interface TimelineSessionRowProps {
  index: number;
  event: TimelineEvent;
  hasIssue: boolean;
  folderOptions: string[];
  onChange: (id: string, patch: Partial<TimelineEvent>) => void;
  onMoveUp: (id: string) => void;
  onMoveDown: (id: string) => void;
  onDelete: (id: string) => void;
}

const TimelineSessionRow = memo(function TimelineSessionRow({
  index,
  event,
  hasIssue,
  folderOptions,
  onChange,
  onMoveUp,
  onMoveDown,
  onDelete,
}: TimelineSessionRowProps) {
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

export default TimelineSessionRow;
