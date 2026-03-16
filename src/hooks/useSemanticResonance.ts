import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { NoteInfo } from "../types";

/** 上下文截断长度：只取最后 1500 字符，聚焦用户当前注意力区域 */
const CONTEXT_TAIL_CHARS = 1500;

/** 深层防抖延迟：用户停止输入 3 秒后才触发推荐请求 */
const DEBOUNCE_MS = 3000;

/**
 * 语义共鸣 Hook：根据当前笔记内容，静默推荐语义相关的历史笔记。
 *
 * # 设计要点
 * - 截断优化：只取 content 末尾 1500 字符作为上下文
 * - 深层防抖：3 秒无输入后才触发，避免频繁 API 调用
 * - 静默失败：网络错误不影响写作体验，仅清空推荐列表
 * - 自动清理：组件卸载时取消定时器和进行中的请求标记
 */
export function useSemanticResonance(
  content: string,
  currentNoteId: string | null
) {
  const [relatedNotes, setRelatedNotes] = useState<NoteInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 用于取消过期请求：每次发起新请求时递增，回调中检查是否仍是最新请求
  const requestIdRef = useRef(0);

  useEffect(() => {
    // 清除上一次的定时器
    if (timerRef.current) clearTimeout(timerRef.current);

    // 无活跃笔记或内容为空时，清空推荐
    if (!currentNoteId || !content.trim()) {
      setRelatedNotes([]);
      setLoading(false);
      return;
    }

    // 截取末尾 1500 字符作为上下文
    const contextText =
      content.length > CONTEXT_TAIL_CHARS
        ? content.slice(-CONTEXT_TAIL_CHARS)
        : content;

    const noteId = currentNoteId;

    // 深层防抖：3 秒后触发
    timerRef.current = setTimeout(async () => {
      const thisRequestId = ++requestIdRef.current;
      setLoading(true);

      try {
        const results = await invoke<NoteInfo[]>("get_related_notes", {
          contextText,
          currentNoteId: noteId,
          limit: 5,
        });

        // 只有最新请求的结果才更新状态，丢弃过期响应
        if (thisRequestId === requestIdRef.current) {
          setRelatedNotes(results);
        }
      } catch {
        // 静默失败：API 挂了不影响写作
        if (thisRequestId === requestIdRef.current) {
          setRelatedNotes([]);
        }
      } finally {
        if (thisRequestId === requestIdRef.current) {
          setLoading(false);
        }
      }
    }, DEBOUNCE_MS);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [content, currentNoteId]);

  return { relatedNotes, loading };
}
