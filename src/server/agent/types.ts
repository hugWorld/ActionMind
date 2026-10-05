// Task 9 — Agent Runtime：类型定义

export type AgentToolName =
  | "memory_search"
  | "contact_search"
  | "task_search"
  | "check_task_conflict"
  | "ask_user"
  | "create_action";

export interface AgentTraceItem {
  /** 工具名（含内部校验步骤 verifier 等，不限于 Agent 工具） */
  tool: string;
  args: unknown;
  result: unknown;
}

export interface ActionCardResult {
  id: string;
  type: string;
  status: "DRAFT";
  payload: unknown;
  source: string | null;
}

export type AgentOutcome =
  | { kind: "action_card"; action: ActionCardResult; toolTrace: AgentTraceItem[] }
  | { kind: "ask_user"; question: string; toolTrace: AgentTraceItem[] }
  | {
      kind: "answer";
      content: string;
      /** 回答所依据的记忆 id（来自 memory_search 工具结果） */
      memoryIds: string[];
      toolTrace: AgentTraceItem[];
    }
  | { kind: "unknown"; toolTrace: AgentTraceItem[] };

export interface AgentResult {
  outcome: AgentOutcome;
  trace: AgentTraceItem[];
}
