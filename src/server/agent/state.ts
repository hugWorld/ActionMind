// Task 17 (Stage B) — Agent State（结构化会话状态）
//
// 用户约束：
//   - Agent State 不只是 messages，至少结构化保存：goal、extractedInfo、resolvedContacts、
//     retrievedMemories、missingRequiredInfo、currentAction、toolResults、phase、trace。
//   - “是否询问用户、何时询问用户”由 Agent Runtime 根据 State 动态决定（State 只保存事实，不保存决策）。

import type { ChatMessage } from "../llm/types";
import type { AgentTraceItem } from "./types";

export type AgentPhase =
  | "understanding" // 正在理解输入 / 提取信息
  | "gathering" // 正在补全信息（检索记忆 / 解析联系人 / 询问用户）
  | "ready" // 信息足够，已生成待确认的 Action Card
  | "done"; // 已结束（answer / unknown / 卡片已确认执行）

export interface ResolvedContact {
  contactId: string;
  name: string;
  email?: string | null;
  phone?: string | null;
  organization?: string | null;
  role?: string | null;
}

export interface MemoryHit {
  memoryId: string;
  content: string;
  score: number;
  sources?: unknown;
}

/** 结构化会话状态（持久化于内存 session store；单机自用无登录） */
export interface AgentSessionState {
  sessionId: string;
  /** 任务目标：如「CREATE_MEETING：和张三开会」；未明确时为 null */
  goal: string | null;
  /** 从输入提取的结构化信息（理解结果 / 用户在多轮中补充的事实，键值扁平化） */
  extractedInfo: Record<string, unknown>;
  /** 已通过 contact_search 解析出的联系人 */
  resolvedContacts: ResolvedContact[];
  /** 已通过 memory_search 检索到的记忆 */
  retrievedMemories: MemoryHit[];
  /** 当前仍缺失的必填字段（对照 field-policy requiredFieldsOf，动态更新） */
  missingRequiredInfo: string[];
  /** 已生成的待确认卡片（DRAFT） */
  currentAction: { id: string; type: string; payload: Record<string, unknown> } | null;
  /** 最近一轮工具结果（按工具名覆盖） */
  toolResults: Record<string, unknown>;
  /** 本会话已向用户问过的问题（避免重复询问） */
  askedQuestions: string[];
  /** 当前阶段 */
  phase: AgentPhase;
  /** 累计工具轨迹（跨轮保留） */
  trace: AgentTraceItem[];
  /** LLM 对话历史（续跑基础） */
  messages: ChatMessage[];
  turnCount: number;
  updatedAt: number;
}

let sessionSeq = 0;

export function createSessionId(): string {
  sessionSeq += 1;
  return `sess_${Date.now()}_${sessionSeq}`;
}

export function createSessionState(sessionId: string = createSessionId()): AgentSessionState {
  return {
    sessionId,
    goal: null,
    extractedInfo: {},
    resolvedContacts: [],
    retrievedMemories: [],
    missingRequiredInfo: [],
    currentAction: null,
    toolResults: {},
    askedQuestions: [],
    phase: "understanding",
    trace: [],
    messages: [],
    turnCount: 0,
    updatedAt: Date.now(),
  };
}

/** 更新时刷新 updatedAt */
export function touchState(state: AgentSessionState): AgentSessionState {
  state.updatedAt = Date.now();
  state.turnCount += 1;
  return state;
}

// ---------- 内存 session store（单机自用；进程重启即清空，MVP 可接受） ----------

const sessions = new Map<string, AgentSessionState>();
const STALE_MS = 30 * 60 * 1000; // 30 分钟无交互自动清理

export function getSession(sessionId: string): AgentSessionState | undefined {
  return sessions.get(sessionId);
}

export function setSession(state: AgentSessionState): void {
  sessions.set(state.sessionId, state);
}

export function deleteSession(sessionId: string): void {
  sessions.delete(sessionId);
}

/** 清理超时未更新的会话（幂等，可在每次对话后调用） */
export function cleanupStaleSessions(now: number = Date.now()): number {
  let removed = 0;
  for (const [id, s] of sessions) {
    if (now - s.updatedAt > STALE_MS) {
      sessions.delete(id);
      removed += 1;
    }
  }
  return removed;
}

/** 供测试/管理：当前会话数 */
export function sessionCount(): number {
  return sessions.size;
}
