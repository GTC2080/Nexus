import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { NoteInfo } from "../types";

export const MIN_CONTEXT_CHARS = 24;
export const MAX_CONTEXT_CHARS = 2200;
const CACHE_LIMIT = 40;

export function getAdaptiveDebounceMs(contentLength: number) {
  if (contentLength < 400) return 900;
  if (contentLength < 1400) return 1500;
  if (contentLength < 3200) return 2200;
  return 2800;
}

function hashText(content: string) {
  let hash = 2166136261;
  for (let index = 0; index < content.length; index += 1) {
    hash ^= content.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `${content.length}:${hash >>> 0}`;
}

function trimToMax(text: string) {
  if (text.length <= MAX_CONTEXT_CHARS) {
    return text;
  }
  return text.slice(text.length - MAX_CONTEXT_CHARS);
}

export function buildSemanticContext(content: string) {
  const trimmed = content.trim();
  if (trimmed.length <= MAX_CONTEXT_CHARS) {
    return trimmed;
  }

  const lines = trimmed.split(/\r?\n/);
  const headings = lines
    .filter(line => /^#{1,4}\s+/.test(line.trim()))
    .slice(-4);

  const blocks = trimmed
    .split(/\n\s*\n/)
    .map(block => block.trim())
    .filter(Boolean);

  const recentBlocks = blocks.slice(-3);
  const sections = [
    headings.length > 0 ? `Headings:\n${headings.join("\n")}` : "",
    recentBlocks.length > 0 ? `Recent focus:\n${recentBlocks.join("\n\n")}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  if (sections.length >= MIN_CONTEXT_CHARS) {
    return trimToMax(sections);
  }

  return trimToMax(trimmed);
}

function cacheResult(cache: Map<string, NoteInfo[]>, key: string, value: NoteInfo[]) {
  if (cache.has(key)) {
    cache.delete(key);
  }
  cache.set(key, value);
  while (cache.size > CACHE_LIMIT) {
    const oldest = cache.keys().next().value;
    if (!oldest) {
      break;
    }
    cache.delete(oldest);
  }
}

export function useSemanticResonance(
  content: string,
  currentNoteId: string | null,
  enabled = true,
) {
  const [relatedNotes, setRelatedNotes] = useState<NoteInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestIdRef = useRef(0);
  const cacheRef = useRef(new Map<string, NoteInfo[]>());

  useEffect(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }

    const contextText = buildSemanticContext(content);
    if (!enabled || !currentNoteId || contextText.length < MIN_CONTEXT_CHARS) {
      setRelatedNotes([]);
      setLoading(false);
      return;
    }

    const cacheKey = `${currentNoteId}:${hashText(contextText)}`;
    const cached = cacheRef.current.get(cacheKey);
    if (cached) {
      setRelatedNotes(cached);
      setLoading(false);
      return;
    }

    const debounceMs = getAdaptiveDebounceMs(contextText.length);
    timerRef.current = setTimeout(async () => {
      const thisRequestId = ++requestIdRef.current;
      setLoading(true);

      try {
        const results = await invoke<NoteInfo[]>("get_related_notes", {
          contextText,
          currentNoteId,
          limit: 5,
        });

        if (thisRequestId === requestIdRef.current) {
          cacheResult(cacheRef.current, cacheKey, results);
          setRelatedNotes(results);
        }
      } catch {
        if (thisRequestId === requestIdRef.current) {
          setRelatedNotes([]);
        }
      } finally {
        if (thisRequestId === requestIdRef.current) {
          setLoading(false);
        }
      }
    }, debounceMs);

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, [content, currentNoteId, enabled]);

  return { relatedNotes, loading };
}
