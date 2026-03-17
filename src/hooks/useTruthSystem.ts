/**
 * TRUTH_SYSTEM — 事件驱动经验结算 Hook
 *
 * 静默监听编辑器行为，防抖结算，
 * 根据文件类型 / 代码块语言路由经验到对应属性。
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { TruthState, AttributeKey } from "../models/truth_system";
import {
  loadTruthState,
  saveTruthState,
  addExp,
  createDefaultState,
} from "../models/truth_system";

const SETTLEMENT_DELAY = 3000;   // 防抖延迟 3s

interface TruthExpAward {
  attr: AttributeKey;
  amount: number;
  reason: string;
}

interface TruthDiffResult {
  awards: TruthExpAward[];
}

/* ========== Hook 接口 ========== */

interface UseTruthSystemOptions {
  /** 当前编辑器的实时文本内容 */
  liveContent: string;
  /** 当前活跃笔记的文件扩展名 */
  fileExtension: string | null;
  /** vault 是否已加载 */
  active: boolean;
}

export function useTruthSystem({ liveContent, fileExtension, active }: UseTruthSystemOptions) {
  const [state, setState] = useState<TruthState>(createDefaultState);
  const prevContentRef = useRef<string>("");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stateRef = useRef<TruthState>(state);
  stateRef.current = state;

  // 加载持久化状态
  useEffect(() => {
    if (!active) return;
    loadTruthState().then(s => {
      setState(s);
      stateRef.current = s;
    });
  }, [active]);

  // 防抖结算：当 liveContent 变化时，延迟结算 delta
  const settle = useCallback(async () => {
    if (!fileExtension) return;

    const prev = prevContentRef.current;
    const curr = liveContent;
    prevContentRef.current = curr;

    if (!prev || !curr) return;

    try {
      const result = await invoke<TruthDiffResult>("compute_truth_diff", {
        prevContent: prev,
        currContent: curr,
        fileExtension,
      });
      if (!result || !Array.isArray(result.awards) || result.awards.length === 0) return;

      let newState = stateRef.current;
      for (const award of result.awards) {
        if (!award || award.amount <= 0) continue;
        newState = addExp(newState, award.attr, award.amount);
      }

      if (newState !== stateRef.current) {
        setState(newState);
        stateRef.current = newState;
        saveTruthState(newState).catch(() => {});
      }
    } catch {
      // 忽略结算失败，避免影响编辑流程
    }
  }, [liveContent, fileExtension]);

  // 防抖触发结算
  useEffect(() => {
    if (!active || !fileExtension) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      void settle();
    }, SETTLEMENT_DELAY);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [liveContent, active, fileExtension, settle]);

  // 切换笔记时重置 prevContent 基线
  useEffect(() => {
    prevContentRef.current = liveContent;
  }, [fileExtension]);

  return { truthState: state };
}
