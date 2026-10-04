import type { Prisma } from "@prisma/client";
import { prisma } from "../db";
import { viewAction } from "../actions";

// Task 11 — Human-in-the-loop Guard
// 确定性安全检查：Action.status === CONFIRMED 才能执行（Gate 11：DRAFT→execute 必须失败）

export class UnauthorizedExecutionError extends Error {
  constructor(message: string, public readonly actionId: string) {
    super(message);
    this.name = "UnauthorizedExecutionError";
    this.code = "UNAUTHORIZED";
  }
  public readonly code: "UNAUTHORIZED";
}

/**
 * 执行守卫：仅 CONFIRMED 状态的 Action 允许执行。
 * 未通过时抛 UnauthorizedExecutionError —— 调用方不得产生任何副作用（Unauthorized Write = 0）。
 */
export async function assertActionConfirmed(
  action: { id: string; status: string },
): Promise<{ id: string; status: string }> {
  if (action.status !== "CONFIRMED") {
    throw new UnauthorizedExecutionError(
      `Action ${action.id} 未确认（status=${action.status}），拒绝执行`,
      action.id,
    );
  }
  return action;
}

export interface ExecuteActionOptions {
  /** 执行工具名（Task 12 起为 create_event / create_contact / update_contact） */
  toolName: string;
  /** 实际执行函数（Task 11 由调用方注入；Task 12 替换为 PostgreSQL-backed 工具） */
  run: (action: { id: string; type: string; payload: Prisma.JsonValue }) => Promise<unknown>;
}

export interface ExecutionResult {
  ok: boolean;
  actionId: string;
  executionId?: string;
  response?: unknown;
  error?: string;
}

/**
 * 统一执行入口：守卫 → Execution 记录（RUNNING）→ 执行 → SUCCESS/FAILED。
 * - DRAFT/CANCELLED/EXECUTING/SUCCESS/FAILED → 抛 UnauthorizedExecutionError，且不产生任何 DB 写入；
 * - CONFIRMED → 创建 Execution 并执行；成功置 Action=SUCCESS，失败置 Action=FAILED。
 */
export async function executeAction(
  actionId: string,
  options: ExecuteActionOptions,
): Promise<ExecutionResult> {
  const action = await viewAction(actionId);
  // 守卫在一切写操作之前
  await assertActionConfirmed(action);

  const execution = await prisma.execution.create({
    data: {
      actionId,
      toolName: options.toolName,
      request: {
        type: action.type,
        payload: action.payload,
        evidence: action.evidence,
      } as Prisma.InputJsonValue,
      status: "RUNNING",
    },
  });
  await prisma.action.update({ where: { id: actionId }, data: { status: "EXECUTING" } });

  try {
    const response = await options.run(action);
    await prisma.execution.update({
      where: { id: execution.id },
      data: { status: "SUCCESS", response: response as Prisma.InputJsonValue },
    });
    await prisma.action.update({ where: { id: actionId }, data: { status: "SUCCESS" } });
    return { ok: true, actionId, executionId: execution.id, response };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await prisma.execution.update({
      where: { id: execution.id },
      data: { status: "FAILED", response: { error: message } as Prisma.InputJsonValue },
    });
    await prisma.action.update({ where: { id: actionId }, data: { status: "FAILED" } });
    return { ok: false, actionId, executionId: execution.id, error: message };
  }
}
