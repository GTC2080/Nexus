/**
 * TRUTH_SYSTEM — 从学习时长推导经验等级
 *
 * 定期调用 truth_state_from_study 命令，
 * 从 study_sessions 数据库聚合计算等级与属性。
 */

import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { TruthState } from "../models/truth_system";
import { createDefaultState } from "../models/truth_system";

/** 刷新间隔：30 秒，与 study tracker 的 tick 间隔一致 */
const REFRESH_INTERVAL = 30_000;

interface UseTruthSystemOptions {
  /** vault 是否已加载 */
  active: boolean;
}

export function useTruthSystem({ active }: UseTruthSystemOptions) {
  const [state, setState] = useState<TruthState>(createDefaultState);

  const refresh = useCallback(async () => {
    try {
      const result = await invoke<TruthState>("truth_state_from_study");
      setState(result);
    } catch {
      // 查询失败时保持当前状态，不影响 UI
    }
  }, []);

  useEffect(() => {
    if (!active) return;
    void refresh();
    const timer = setInterval(() => void refresh(), REFRESH_INTERVAL);
    return () => clearInterval(timer);
  }, [active, refresh]);

  return { truthState: state };
}
