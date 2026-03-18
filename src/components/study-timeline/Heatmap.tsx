import { useMemo, useState } from "react";
import { formatDuration } from "./StatsCards";
import type { HeatmapEntry } from "./types";

interface HeatmapProps {
  data: HeatmapEntry[];
}

interface TooltipState {
  x: number;
  y: number;
  date: string;
  secs: number;
}

const CELL = 12;
const GAP = 2;
const STEP = CELL + GAP;
const WEEKS = 26;
const DAYS_PER_WEEK = 7;

function cellColor(secs: number, maxSecs: number): string {
  if (secs <= 0 || maxSecs <= 0) return "rgba(255,255,255,0.04)";
  const ratio = secs / maxSecs;
  if (ratio < 0.15) return "rgba(10,132,255,0.20)";
  if (ratio < 0.35) return "rgba(10,132,255,0.42)";
  if (ratio < 0.65) return "rgba(10,132,255,0.65)";
  return "rgba(10,132,255,0.90)";
}

function formatDisplayDate(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

export default function Heatmap({ data }: HeatmapProps) {
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);

  const { cells, maxSecs } = useMemo(() => {
    const map = new Map<string, number>();
    for (const entry of data) {
      map.set(entry.date, entry.active_secs);
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const totalDays = WEEKS * DAYS_PER_WEEK;

    const result: { date: string; secs: number; col: number; row: number }[] = [];
    let max = 0;

    // Start from the Monday of the week that is (totalDays) days ago
    const startDate = new Date(today);
    startDate.setDate(startDate.getDate() - (totalDays - 1));
    // Align to Monday
    const dayOfWeek = startDate.getDay(); // 0=Sun
    const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
    startDate.setDate(startDate.getDate() + mondayOffset);

    for (let w = 0; w < WEEKS; w++) {
      for (let d = 0; d < DAYS_PER_WEEK; d++) {
        const cur = new Date(startDate);
        cur.setDate(cur.getDate() + w * 7 + d);
        const key = `${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, "0")}-${String(
          cur.getDate()
        ).padStart(2, "0")}`;
        const secs = map.get(key) ?? 0;
        if (secs > max) max = secs;
        result.push({ date: key, secs, col: w, row: d });
      }
    }

    return { cells: result, maxSecs: max };
  }, [data]);

  const svgWidth = WEEKS * STEP - GAP;
  const svgHeight = DAYS_PER_WEEK * STEP - GAP;

  return (
    <div className="relative">
      <div className="text-[11px] mb-2 font-medium" style={{ color: "var(--text-quaternary)" }}>
        活跃热力图（近半年）
      </div>
      <svg
        width={svgWidth}
        height={svgHeight}
        style={{ display: "block", overflow: "visible" }}
      >
        {cells.map((cell) => (
          <rect
            key={cell.date}
            x={cell.col * STEP}
            y={cell.row * STEP}
            width={CELL}
            height={CELL}
            rx={2}
            fill={cellColor(cell.secs, maxSecs)}
            style={{ cursor: "default" }}
            onMouseEnter={(e) => {
              setTooltip({
                x: e.clientX,
                y: e.clientY,
                date: cell.date,
                secs: cell.secs,
              });
            }}
            onMouseMove={(e) => {
              setTooltip((prev) =>
                prev ? { ...prev, x: e.clientX, y: e.clientY } : null
              );
            }}
            onMouseLeave={() => setTooltip(null)}
          />
        ))}
      </svg>

      {tooltip && (
        <div
          className="fixed z-50 px-2.5 py-1.5 rounded-lg text-[11px] pointer-events-none"
          style={{
            left: tooltip.x + 12,
            top: tooltip.y - 36,
            background: "var(--surface-2)",
            border: "1px solid var(--separator-light)",
            color: "var(--text-secondary)",
            boxShadow: "0 4px 16px rgba(0,0,0,0.4)",
          }}
        >
          <span style={{ color: "var(--text-primary)" }}>{formatDisplayDate(tooltip.date)}</span>
          <span className="ml-2">{formatDuration(tooltip.secs)}</span>
        </div>
      )}
    </div>
  );
}
