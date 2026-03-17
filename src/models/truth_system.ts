/**
 * TRUTH_SYSTEM — 全维度个人成长数据模型与存储引擎
 *
 * 使用 Tauri LazyStore 持久化至本地 JSON。
 * 升级算法：nextLevelExp = 100 × 1.5^(level-1)
 */

import { LazyStore } from "@tauri-apps/plugin-store";

/* ========== 核心类型 ========== */

export interface Attributes {
  science: number;      // 科研与理论推演
  engineering: number;  // 编程与系统架构
  creation: number;     // 宏大叙事与文字创作
  finance: number;      // 量化与逻辑分析
}

export type AttributeKey = keyof Attributes;

export interface TruthState {
  level: number;
  totalExp: number;
  nextLevelExp: number;
  attributes: Attributes;
  /** 各属性累计经验 */
  attributeExp: Attributes;
  /** 上次结算时间戳 (ms) */
  lastSettlement: number;
}

/* ========== 常量 ========== */

const STORE_KEY = "truth_state";
const BASE_EXP = 100;
const GROWTH_RATE = 1.5;

/** 计算指定等级所需经验 */
export function calcNextLevelExp(level: number): number {
  return Math.floor(BASE_EXP * Math.pow(GROWTH_RATE, level - 1));
}

/* ========== 默认状态 ========== */

export function createDefaultState(): TruthState {
  return {
    level: 1,
    totalExp: 0,
    nextLevelExp: calcNextLevelExp(1),
    attributes: { science: 1, engineering: 1, creation: 1, finance: 1 },
    attributeExp: { science: 0, engineering: 0, creation: 0, finance: 0 },
    lastSettlement: Date.now(),
  };
}

/* ========== 存储引擎 ========== */

let store: LazyStore | null = null;

function getStore(): LazyStore {
  if (!store) store = new LazyStore("truth_system.json");
  return store;
}

export async function loadTruthState(): Promise<TruthState> {
  try {
    const s = getStore();
    const saved = await s.get<TruthState>(STORE_KEY);
    if (saved && typeof saved.level === "number") return saved;
  } catch { /* first run */ }
  return createDefaultState();
}

export async function saveTruthState(state: TruthState): Promise<void> {
  const s = getStore();
  await s.set(STORE_KEY, state);
  await s.save();
}

/* ========== 经验结算逻辑 ========== */

/** 属性等级 = 1 + floor(attributeExp / 50) ，上限99 */
function attrLevel(exp: number): number {
  return Math.min(99, 1 + Math.floor(exp / 50));
}

/**
 * 给指定属性增加经验并处理升级。
 * 返回新的 TruthState（不可变更新）。
 */
export function addExp(
  state: TruthState,
  attr: AttributeKey,
  amount: number,
): TruthState {
  if (amount <= 0) return state;

  let { level, totalExp, nextLevelExp } = state;
  const attributeExp = { ...state.attributeExp };
  attributeExp[attr] += amount;
  totalExp += amount;

  // 连续升级检查
  while (totalExp >= nextLevelExp) {
    totalExp -= nextLevelExp;
    level += 1;
    nextLevelExp = calcNextLevelExp(level);
  }

  const attributes: Attributes = {
    science: attrLevel(attributeExp.science),
    engineering: attrLevel(attributeExp.engineering),
    creation: attrLevel(attributeExp.creation),
    finance: attrLevel(attributeExp.finance),
  };

  return {
    level,
    totalExp,
    nextLevelExp,
    attributes,
    attributeExp,
    lastSettlement: Date.now(),
  };
}
