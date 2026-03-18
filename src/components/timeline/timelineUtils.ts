import type { TimelineEvent } from "../../types";

export function createEmptyEvent(): TimelineEvent {
  return {
    id: crypto.randomUUID(),
    date: new Date().toISOString().slice(0, 10),
    title: "",
    description: "",
    durationMinutes: 0,
    folders: [],
  };
}

export function normalizeFolderPath(value: string): string {
  const normalized = value.trim().replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  return normalized || "根目录";
}

export function parseFolderInput(raw: string): string[] {
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

export function moveItem(events: TimelineEvent[], fromIndex: number, toIndex: number): TimelineEvent[] {
  if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0 || fromIndex >= events.length || toIndex >= events.length) {
    return events;
  }
  const next = [...events];
  const [item] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, item);
  return next;
}

export function normalizeTimelineEvent(event: TimelineEvent): TimelineEvent {
  return {
    ...event,
    durationMinutes: Number.isFinite(event.durationMinutes)
      ? Math.max(0, Math.round(event.durationMinutes))
      : 0,
    folders: Array.isArray(event.folders)
      ? Array.from(new Set(event.folders.map(folder => normalizeFolderPath(String(folder)))))
      : [],
  };
}
