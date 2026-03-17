/**
 * TRUTH_SYSTEM — 事件驱动经验结算 Hook
 *
 * 静默监听编辑器行为，防抖结算，
 * 根据文件类型 / 代码块语言路由经验到对应属性。
 */

import { useState, useEffect, useCallback, useRef } from "react";
import type { TruthState, AttributeKey } from "../models/truth_system";
import {
  loadTruthState,
  saveTruthState,
  addExp,
  createDefaultState,
} from "../models/truth_system";

/* ========== 经验路由映射 ========== */

/** 根据文件扩展名决定主属性 */
function routeByExtension(ext: string): AttributeKey {
  const lower = ext.toLowerCase();
  if (["jdx", "csv"].includes(lower)) return "science";
  if (["py", "js", "ts", "tsx", "jsx", "rs", "go", "c", "cpp", "java"].includes(lower)) return "engineering";
  if (["timeline", "canvas"].includes(lower)) return "creation";
  if (["dashboard", "base"].includes(lower)) return "finance";
  // 默认 markdown → creation
  return "creation";
}

/** 根据代码块语言决定属性 */
function routeByCodeLanguage(lang: string): AttributeKey | null {
  const lower = lang.toLowerCase();
  if (["python", "py", "rust", "go", "javascript", "js", "typescript", "ts", "java", "c", "cpp"].includes(lower)) return "engineering";
  if (["smiles", "chemical", "latex", "math"].includes(lower)) return "science";
  if (["sql", "r", "stata"].includes(lower)) return "finance";
  return null;
}

/* ========== 经验值常量 ========== */

const EXP_PER_100_CHARS = 2;     // 每100字符 → 2 EXP
const EXP_PER_CANVAS_NODE = 5;   // 每个新画布节点 → 5 EXP
const EXP_PER_CODE_BLOCK = 8;    // 每次代码块编辑 → 8 EXP
const SETTLEMENT_DELAY = 3000;   // 防抖延迟 3s

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
  const settle = useCallback(() => {
    if (!fileExtension) return;

    const prev = prevContentRef.current;
    const curr = liveContent;
    prevContentRef.current = curr;

    if (!prev || !curr) return;

    const attr = routeByExtension(fileExtension);

    // 计算字符增量
    const delta = curr.length - prev.length;
    if (delta > 10) {
      const charExp = Math.floor((delta / 100) * EXP_PER_100_CHARS);
      if (charExp > 0) {
        let newState = addExp(stateRef.current, attr, charExp);

        // 检测代码块语言，额外分配经验
        const codeBlockPattern = /```(\w+)/g;
        let match;
        const newBlocks = new Set<string>();
        while ((match = codeBlockPattern.exec(curr)) !== null) {
          newBlocks.add(match[1]);
        }
        const oldBlocks = new Set<string>();
        const oldPattern = /```(\w+)/g;
        while ((match = oldPattern.exec(prev)) !== null) {
          oldBlocks.add(match[1]);
        }
        // 新增的代码块语言
        for (const lang of newBlocks) {
          if (!oldBlocks.has(lang)) {
            const codeAttr = routeByCodeLanguage(lang);
            if (codeAttr) {
              newState = addExp(newState, codeAttr, EXP_PER_CODE_BLOCK);
            }
          }
        }

        setState(newState);
        stateRef.current = newState;
        saveTruthState(newState).catch(() => {});
      }
    }

    // 画布节点增量（简易检测 JSON 中的 nodes 数组长度变化）
    if (fileExtension === "canvas") {
      try {
        const prevNodes = (JSON.parse(prev)?.nodes?.length ?? 0) as number;
        const currNodes = (JSON.parse(curr)?.nodes?.length ?? 0) as number;
        const newNodes = currNodes - prevNodes;
        if (newNodes > 0) {
          const newState = addExp(stateRef.current, "creation", newNodes * EXP_PER_CANVAS_NODE);
          setState(newState);
          stateRef.current = newState;
          saveTruthState(newState).catch(() => {});
        }
      } catch { /* not valid JSON yet */ }
    }
  }, [liveContent, fileExtension]);

  // 防抖触发结算
  useEffect(() => {
    if (!active || !fileExtension) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(settle, SETTLEMENT_DELAY);
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
