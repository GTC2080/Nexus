import type { StudyStats } from "./types";

interface StatsCardsProps {
  stats: StudyStats;
}

export function formatDuration(secs: number): string {
  if (secs <= 0) return "0s";
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m} min`;
  return `${secs}s`;
}

interface StatCardProps {
  label: string;
  value: string;
}

function StatCard({ label, value }: StatCardProps) {
  return (
    <div
      className="flex-1 rounded-xl px-5 py-5 border"
      style={{
        background: "var(--subtle-surface)",
        borderColor: "var(--separator-light)",
      }}
    >
      <div
        className="text-[10px] font-semibold uppercase tracking-wider mb-2.5"
        style={{ color: "var(--text-quaternary)" }}
      >
        {label}
      </div>
      <div
        className="font-bold leading-none tabular-nums"
        style={{ fontSize: 24, color: "var(--text-primary)" }}
      >
        {value}
      </div>
    </div>
  );
}

export default function StatsCards({ stats }: StatsCardsProps) {
  return (
    <div className="flex gap-4">
      <StatCard label="今日学习" value={formatDuration(stats.today_active_secs)} />
      <StatCard label="今日文件" value={String(stats.today_files)} />
      <StatCard label="本周累计" value={formatDuration(stats.week_active_secs)} />
      <StatCard
        label="连续学习"
        value={`${stats.streak_days} 天`}
      />
    </div>
  );
}
