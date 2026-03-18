import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import StatsCards from "./StatsCards";
import Heatmap from "./Heatmap";
import FolderRanking from "./FolderRanking";
import DailyRecords from "./DailyRecords";
import type { StudyStats } from "./types";

export interface StudyTimelineProps {
  onClose: () => void;
}

type Range = 7 | 30 | 90 | 9999;

const RANGE_LABELS: { value: Range; label: string }[] = [
  { value: 7, label: "7天" },
  { value: 30, label: "30天" },
  { value: 90, label: "90天" },
  { value: 9999, label: "全部" },
];

function ClockIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0 }}>
      <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.3" />
      <path d="M8 4.5V8L10.5 10" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <path d="M2 2L12 12M12 2L2 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function Spinner() {
  return (
    <div className="flex items-center justify-center h-40">
      <div
        className="w-6 h-6 rounded-full border-2 border-t-transparent animate-spin"
        style={{ borderColor: "var(--separator-light)", borderTopColor: "transparent" }}
      />
    </div>
  );
}

export default function StudyTimeline({ onClose }: StudyTimelineProps) {
  const [range, setRange] = useState<Range>(30);
  const [stats, setStats] = useState<StudyStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (daysBack: Range) => {
    setLoading(true);
    setError(null);
    try {
      const result = await invoke<StudyStats>("study_stats_query", { daysBack });
      setStats(result);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(range);
  }, [range, load]);

  return (
    <div
      className="flex flex-col h-full"
      style={{ background: "var(--bg-primary, var(--surface-0))" }}
    >
      {/* Header */}
      <div
        className="flex items-center gap-2.5 px-4 py-3 shrink-0"
        style={{
          borderBottom: "1px solid var(--panel-border)",
          background: "var(--subtle-surface)",
        }}
      >
        <span style={{ color: "var(--text-quaternary)" }}>
          <ClockIcon />
        </span>
        <span
          className="text-[13px] font-semibold flex-1"
          style={{ color: "var(--text-primary)" }}
        >
          学习时间轴
        </span>

        {/* Range selector */}
        <div
          className="flex items-center gap-0.5 rounded-lg p-0.5"
          style={{ background: "var(--surface-2)" }}
        >
          {RANGE_LABELS.map(({ value, label }) => (
            <button
              key={value}
              type="button"
              className="px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors"
              style={{
                background: range === value ? "var(--accent-soft)" : "transparent",
                color: range === value ? "var(--accent)" : "var(--text-quaternary)",
              }}
              onClick={() => setRange(value)}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Close button */}
        <button
          type="button"
          className="flex items-center justify-center w-7 h-7 rounded-lg transition-colors"
          style={{ color: "var(--text-quaternary)" }}
          onMouseEnter={(e) =>
            ((e.currentTarget as HTMLButtonElement).style.background = "var(--sidebar-hover)")
          }
          onMouseLeave={(e) =>
            ((e.currentTarget as HTMLButtonElement).style.background = "transparent")
          }
          onClick={onClose}
          title="关闭"
        >
          <CloseIcon />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-4 py-4 flex flex-col gap-5 min-h-0">
        {loading && <Spinner />}

        {error && !loading && (
          <div
            className="rounded-xl px-4 py-3 text-[12px]"
            style={{
              background: "rgba(239,68,68,0.08)",
              border: "1px solid rgba(239,68,68,0.2)",
              color: "rgba(252,165,165,0.9)",
            }}
          >
            加载失败：{error}
          </div>
        )}

        {stats && !loading && (
          <>
            {/* Stats cards */}
            <StatsCards stats={stats} />

            {/* Heatmap + Folder ranking */}
            <div className="flex gap-4 min-w-0">
              <div
                className="rounded-xl p-4 border"
                style={{
                  flex: "0 0 60%",
                  background: "var(--subtle-surface)",
                  borderColor: "var(--separator-light)",
                  overflow: "hidden",
                }}
              >
                <Heatmap data={stats.heatmap} />
              </div>
              <div
                className="rounded-xl p-4 border flex-1 min-w-0"
                style={{
                  background: "var(--subtle-surface)",
                  borderColor: "var(--separator-light)",
                }}
              >
                <FolderRanking data={stats.folder_ranking} />
              </div>
            </div>

            {/* Daily records */}
            <DailyRecords data={stats.daily_details} />
          </>
        )}

        {!stats && !loading && !error && (
          <div
            className="text-[12px] py-8 text-center"
            style={{ color: "var(--text-quaternary)" }}
          >
            暂无数据
          </div>
        )}
      </div>
    </div>
  );
}
