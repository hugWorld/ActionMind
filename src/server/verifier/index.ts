// Task 25 鈥?Verifier 鏈哄埗
//
// 鐩爣锛氬湪 Agent 鍐冲畾鎵ц?Action 鍚庛€佺湡姝ｆ墽琛屽墠澧炲姞鐙珛鏍￠獙銆?
//   Agent 鈫?Action 鈫?Verifier 鈫?閫氳繃 鈫?Execute
//                              鈫?涓嶉€氳繃 鈫?鍙?Agent 淇鏀?鈫?鍐嶆 Verify
//
// 璁捐绾︽潫锛?
//   - 鈥滃彲鐢?Agent 鑷鏀舵纭殑闂鈥濅互缁撴瀯鍖?VerifyResult 鍥炰紶 Agent 淇鏀惧悗閲嶆柊楠岃瘉锛岃€屼笉鏄洿鎺ュけ璐?  - 鏈€澶ч噸璇曟鏁?MAX_VERIFIER_RETRIES锛岄伩鍏?Verifier 鈫?Agent 鏃犻檺寰幆
//   - 澶嶇敤宸叉湁楠岃瘉锛氬瓧娈靛畬鏁存€э紙field-policy锛夈€佸啿绐佹鏌?findConflictingTasks锛?/   闃叉浣嶅鍐欎笘锛堥噸澶嶅疄鐜?Guard / Conflict Check锛?
import { prisma } from "../db";
import { requiredFieldsOf, hasFieldValue, zhName, FIELD_POLICIES, type ActionType } from "../planning/field-policy";
import { findConflictingTasks } from "../tasks";
import type { AgentSessionState } from "../agent/state";

/** Verifier 鈫?Agent 修正的最大重试次数 */
export const MAX_VERIFIER_RETRIES = 2;

export type VerifyStage = "card" | "execute";

export interface VerifyIssue {
  /** 稳定错误码：action_params / state_consistency / prereq_conflict / tool_args / evidence / state_exception */
  code: string;
  severity: "error" | "warning";
  message: string;
  /** 是否为 Agent 可自行修正的问题（可修正 鈫?回传 Agent；否则 鈫?直接阻断/提示人工） */
  fixableByAgent: boolean;
}

export interface VerifyResult {
  passed: boolean;
  issues: VerifyIssue[];
  attempts: number;
  actionId: string;
}

export interface VerifyContext {
  stage: VerifyStage;
  state?: AgentSessionState;
  now?: Date;
}

const KNOWN_ACTION_TYPES = new Set([
  "CREATE_TASK",
  "CREATE_MEETING",
  "UPDATE_TASK",
  "CANCEL_TASK",
  "CREATE_CONTACT",
  "UPDATE_CONTACT",
]);
const TASK_TYPES = new Set(["MEETING", "TODO", "REMINDER", "OTHER"]);

/**
 * 独立校验 Action（card 阶段：生成卡片前；execute 阶段：用户确认后执行前）。
 * 检查项：
 *   1) action_params      — 参数完整、合法（复用 field-policy Required 分类 + 时间可解析）
 *   2) state_consistency  — Agent State 与 Action 一致（goal / currentAction）
 *   3) prereq_conflict    — 前置冲突检查（创建类必查；复用 findConflictingTasks；用户放行豁免）
 *   4) tool_args          — Action 类型可执行、目标存在（UPDATE/CANCEL 的 taskId 必须存在）
 *   5) evidence           — Action 有必要的依据说明（缺失记 warning）
 *   6) state_exception    — 重复执行 / 状态异常（已执行成功 / 未确认 / 时间过期）
 */
export async function verifyAction(
  action: { id: string; type: string; payload: unknown; status?: string; evidence?: unknown },
  ctx: VerifyContext,
): Promise<VerifyResult> {
  const issues: VerifyIssue[] = [];
  const now = ctx.now ?? new Date();
  const payload = (action.payload ?? {}) as Record<string, unknown>;

  // 1) 参数完整、合法
  if (KNOWN_ACTION_TYPES.has(action.type) && FIELD_POLICIES[action.type as ActionType]) {
    const missing = requiredFieldsOf(action.type as ActionType).filter((f) => !hasFieldValue(payload, f));
    if (missing.length > 0) {
      issues.push({
        code: "action_params",
        severity: "error",
        message: `缺少必填字段：${missing.map(zhName).join("、")}`,
        fixableByAgent: true,
      });
    }
    const start = payload.start as string | undefined;
    if (start && typeof start === "string" && Number.isNaN(new Date(start).getTime())) {
      issues.push({ code: "action_params", severity: "error", message: `开始时间不是有效日期：${start}`, fixableByAgent: true });
    }
    if (payload.type != null && !TASK_TYPES.has(String(payload.type))) {
      issues.push({
        code: "action_params",
        severity: "warning",
        message: `任务类型非法：${payload.type}（应为 MEETING/TODO/REMINDER/OTHER）`,
        fixableByAgent: true,
      });
    }
  } else {
    issues.push({ code: "tool_args", severity: "error", message: `未知 Action 类型：${action.type}`, fixableByAgent: true });
  }

  // 2) Agent State 与 Action 一致（card 阶段）
  if (ctx.stage === "card" && ctx.state) {
    const cur = ctx.state.currentAction;
    if (cur && cur.id !== action.id) {
      issues.push({
        code: "state_consistency",
        severity: "warning",
        message: "Agent State.currentAction 与本次生成的卡片不一致（存在旧卡片未清理）",
        fixableByAgent: true,
      });
    }
    const g = ctx.state.goal;
    if (g) {
      if (action.type.startsWith("CANCEL") && !g.includes("取消")) {
        issues.push({ code: "state_consistency", severity: "warning", message: "goal 未体现取消意图，但生成了取消卡片", fixableByAgent: true });
      }
      if (action.type.startsWith("UPDATE") && !/改|修改|调整/.test(g)) {
        issues.push({ code: "state_consistency", severity: "warning", message: "goal 未体现修改意图，但生成了修改卡片", fixableByAgent: true });
      }
    }
  }

  // 3) 前置检查（不重复实现冲突判定：冲突检测是 check_task_conflict 工具 + conflictGuard 护栏的职责）
  //    Verifier 只验证「创建类 Action 在生成卡片前是否已调用过冲突检查」，缺失记 warning（不阻塞），
  //    避免与 Guard / Conflict Check 重复判定导致双重拦截。
  if (
    ctx.stage === "card" &&
    ctx.state &&
    (action.type === "CREATE_TASK" || action.type === "CREATE_MEETING")
  ) {
    const checked = ctx.state.trace.some((t) => t.tool === "check_task_conflict");
    if (!checked) {
      issues.push({
        code: "prereq_conflict",
        severity: "warning",
        message: "创建类 Action 未调用 check_task_conflict 做前置冲突检查（Guard 将在执行前兜底）",
        fixableByAgent: true,
      });
    }
  }

  // 4) tool 与 arguments 合法
  if (!KNOWN_ACTION_TYPES.has(action.type)) {
    issues.push({ code: "tool_args", severity: "error", message: `无法匹配执行工具：${action.type}`, fixableByAgent: true });
  }
  if (action.type === "UPDATE_TASK" || action.type === "CANCEL_TASK") {
    const taskId = payload.taskId as string | undefined;
    if (typeof taskId !== "string" || !taskId.trim()) {
      issues.push({ code: "tool_args", severity: "error", message: "缺少目标任务 id（taskId）", fixableByAgent: true });
    } else {
      const task = await prisma.meeting.findUnique({ where: { id: taskId } });
      if (!task) {
        issues.push({ code: "tool_args", severity: "error", message: `目标任务不存在：${taskId}`, fixableByAgent: true });
      } else if (action.type === "CANCEL_TASK" && task.status === "cancelled") {
        issues.push({ code: "state_exception", severity: "error", message: "目标任务已取消，无需重复取消", fixableByAgent: false });
      } else if (task.status === "completed") {
        issues.push({ code: "state_exception", severity: "warning", message: "目标任务已完成，取消可能不合理，请确认", fixableByAgent: false });
      }
    }
  }

  // 5) evidence 依据
  const ev = action.evidence;
  const hasEvidence =
    ev != null && (typeof ev === "object" ? Object.keys(ev as Record<string, unknown>).length > 0 : String(ev).trim() !== "");
  if (!hasEvidence) {
    issues.push({ code: "evidence", severity: "warning", message: "Action 缺少 evidence（依据说明），建议在生成卡片时补充来源", fixableByAgent: true });
  }

  // 6) 重复执行 / 状态异常
  if (ctx.stage === "execute") {
    if (action.status !== "CONFIRMED") {
      issues.push({ code: "state_exception", severity: "error", message: `Action 未确认（status=${action.status}），拒绝执行`, fixableByAgent: false });
    }
    const dup = await prisma.execution.findFirst({ where: { actionId: action.id, status: "SUCCESS" } });
    if (dup) {
      issues.push({ code: "state_exception", severity: "error", message: "该 Action 已执行成功，禁止重复执行", fixableByAgent: false });
    }
  }
  const start = payload.start as string | undefined;
  if (typeof start === "string" && !Number.isNaN(new Date(start).getTime()) && new Date(start).getTime() < now.getTime() - 5 * 60_000) {
    issues.push({ code: "state_exception", severity: "warning", message: "开始时间已过期，请确认意图", fixableByAgent: true });
  }

  const errors = issues.filter((i) => i.severity === "error");
  return { passed: errors.length === 0, issues, attempts: 1, actionId: action.id };
}

/** 结构化反馈给 Agent（可修正问题）：JSON 摘要 + 中文修正指引 */
export function verifierFeedbackMessage(result: VerifyResult): string {
  const lines = result.issues.map(
    (i, idx) => `${idx + 1}. [${i.code}] ${i.severity === "error" ? "错误" : "提示"}：${i.message}（Agent 可修正：${i.fixableByAgent ? "是" : "否"}）`,
  );
  return `【校验反馈】上轮 Action Card 未通过 Verifier，共 ${result.issues.length} 项问题：\n${lines.join("\n")}\n请根据反馈修正 payload（如调整时间、补齐必填字段、补充依据、修正目标），修正后重新生成 Action Card；不要重复同样的错误。若某问题标注「Agent 可修正：否」，请改用 ask_user 向用户说明并请求处理。`;
}

export function verifierTrace(actionId: string, stage: VerifyStage, result: VerifyResult) {
  return {
    tool: "verifier" as const,
    args: { actionId, stage },
    result: { passed: result.passed, issues: result.issues.map((i) => ({ code: i.code, severity: i.severity, message: i.message })) },
  };
}
