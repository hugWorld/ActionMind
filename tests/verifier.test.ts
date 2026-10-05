import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../src/server/db";
import { createDeepSeekProvider } from "../src/server/llm/deepseek";
import { createEmbeddingProvider, type EmbeddingProvider } from "../src/server/embedding";
import { ensureEmbedServer } from "./helpers/ensure-embed";
import {
  MAX_VERIFIER_RETRIES,
  verifierFeedbackMessage,
  verifyAction,
  type VerifyResult,
} from "../src/server/verifier";
import { executeWithTools } from "../src/server/tools";
import { UnauthorizedExecutionError } from "../src/server/execution";
import { createSessionState } from "../src/server/agent/state";
import type { AgentSessionState } from "../src/server/agent/state";

// Task 25 — Verifier 机制（确定性测试，不依赖 LLM）：
//   Agent → Action → Verifier → 通过 → Execute；不通过 →（可修正）返回 Agent /（不可修正）阻断
describe("Task 25: Verifier 独立校验", () => {
  let provider: ReturnType<typeof createDeepSeekProvider> | null = null;
  let embedding: EmbeddingProvider;
  const createdMeetings: string[] = [];
  const createdActions: string[] = [];
  const createdExecutions: string[] = [];

  const FUTURE = "2026-11-20T15:00:00+08:00"; // 未来时间（避免过期 warning 干扰）

  beforeAll(async () => {
    const apiKey = process.env.DEEPSEEK_API_KEY;
    provider = apiKey ? createDeepSeekProvider() : null;
    await ensureEmbedServer();
    embedding = createEmbeddingProvider();
  }, 120_000);

  afterAll(async () => {
    for (const id of createdExecutions) await prisma.execution.delete({ where: { id } }).catch(() => {});
    for (const id of createdActions) await prisma.action.delete({ where: { id } }).catch(() => {});
    for (const id of createdMeetings) await prisma.meeting.delete({ where: { id } }).catch(() => {});
    await prisma.$disconnect();
  });

  async function seedAction(type: string, payload: Record<string, unknown>, status = "DRAFT") {
    const a = await prisma.action.create({
      data: { type, status, payload: payload as object, source: "verifier-test" },
    });
    createdActions.push(a.id);
    return a;
  }

  it("1) 缺必填字段（CREATE_TASK 缺 start）→ action_params 错误且可修正", async () => {
    const a = await seedAction("CREATE_TASK", { title: "上课" });
    const r: VerifyResult = await verifyAction(a, { stage: "card", state: createSessionState() });
    expect(r.passed).toBe(false);
    const p = r.issues.find((i) => i.code === "action_params");
    expect(p?.severity).toBe("error");
    expect(p?.fixableByAgent).toBe(true);
    expect(p?.message).toContain("开始时间");
  });

  it("2) 创建类未调用 check_task_conflict → prereq_conflict warning（不阻塞，Guard 兜底）", async () => {
    const a = await seedAction("CREATE_TASK", { title: "上数学课", start: FUTURE });
    const state = createSessionState();
    const r = await verifyAction(a, { stage: "card", state });
    // warning 不阻断 passed
    expect(r.passed).toBe(true);
    const p = r.issues.find((i) => i.code === "prereq_conflict");
    expect(p?.severity).toBe("warning");
    expect(p?.message).toContain("check_task_conflict");
  });

  it("3) 已调用 check_task_conflict（trace 有记录）→ 无 prereq_conflict 提示", async () => {
    const a = await seedAction("CREATE_TASK", { title: "上数学课", start: FUTURE });
    const state = createSessionState();
    state.trace.push({ tool: "check_task_conflict", args: {}, result: { conflicted: false, conflicts: [] } });
    const r = await verifyAction(a, { stage: "card", state });
    expect(r.issues.some((i) => i.code === "prereq_conflict")).toBe(false);
    expect(r.passed).toBe(true);
  });

  it("4) 合法 CREATE_TASK（无重叠）→ passed", async () => {
    const a = await seedAction("CREATE_TASK", { title: "数据结构课", start: "2026-11-21T09:00:00+08:00", type: "TODO" });
    const r = await verifyAction(a, { stage: "card", state: createSessionState() });
    expect(r.passed).toBe(true);
  });

  it("5) execute 阶段 status≠CONFIRMED → state_exception 错误（不可修正）", async () => {
    const a = await seedAction("CREATE_TASK", { title: "上课", start: FUTURE }, "DRAFT");
    const r = await verifyAction(a, { stage: "execute" });
    const p = r.issues.find((i) => i.code === "state_exception");
    expect(p?.severity).toBe("error");
    expect(p?.fixableByAgent).toBe(false);
  });

  it("6) 已执行成功 → 重复执行错误（不可修正）", async () => {
    const a = await seedAction("CREATE_TASK", { title: "上课", start: FUTURE }, "CONFIRMED");
    const ex = await prisma.execution.create({
      data: {
        actionId: a.id,
        toolName: "create_event",
        request: { type: a.type, payload: a.payload },
        status: "SUCCESS",
      },
    });
    createdExecutions.push(ex.id);
    const r = await verifyAction(a, { stage: "execute" });
    const p = r.issues.find((i) => i.code === "state_exception");
    expect(p?.severity).toBe("error");
    expect(p?.message).toContain("重复执行");
  });

  it("7) CANCEL_TASK 目标不存在 → tool_args 错误", async () => {
    const a = await seedAction("CANCEL_TASK", { taskId: "no-such-task" }, "CONFIRMED");
    const r = await verifyAction(a, { stage: "execute" });
    const p = r.issues.find((i) => i.code === "tool_args");
    expect(p?.severity).toBe("error");
    expect(p?.message).toContain("不存在");
  });

  it("8) MAX_VERIFIER_RETRIES=2 且反馈消息包含错误码", () => {
    expect(MAX_VERIFIER_RETRIES).toBe(2);
    const r: VerifyResult = {
      passed: false,
      issues: [{ code: "action_params", severity: "error", message: "缺少必填字段：开始时间", fixableByAgent: true }],
      attempts: 1,
      actionId: "x",
    };
    const msg = verifierFeedbackMessage(r);
    expect(msg).toContain("action_params");
    expect(msg).toContain("校验反馈");
  });

  it("9) 集成语义：execute 阶段验证状态异常（重复执行拦截）；DRAFT 由 Guard 拦截；直连 executeWithTools 不二次拦截", async () => {
    // 合法 CONFIRMED 创建类 → execute passed
    const okAction = await seedAction("CREATE_TASK", { title: "上课", start: "2026-11-23T09:00:00+08:00" }, "CONFIRMED");
    const r0 = await verifyAction(okAction, { stage: "execute" });
    expect(r0.passed).toBe(true);
    // execute 阶段重复执行拦截（已存在 SUCCESS execution）
    const ex = await prisma.execution.create({
      data: {
        actionId: okAction.id,
        toolName: "create_event",
        request: { type: okAction.type, payload: okAction.payload },
        status: "SUCCESS",
      },
    });
    createdExecutions.push(ex.id);
    const r2 = await verifyAction(okAction, { stage: "execute" });
    expect(r2.passed).toBe(false);
    expect(r2.issues.some((i) => i.code === "state_exception" && i.message.includes("重复执行"))).toBe(true);
    // DRAFT → 复用 Guard（UnauthorizedExecutionError 不变，executeWithTools 直连不被 Verifier 二次拦截）
    const draftAction = await seedAction("CREATE_TASK", { title: "上课", start: "2026-11-23T09:00:00+08:00" }, "DRAFT");
    await expect(executeWithTools(draftAction.id, { embeddingProvider: embedding })).rejects.toThrow(
      UnauthorizedExecutionError,
    );
    void provider;
  }, 60_000);
});
