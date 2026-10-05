import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../src/server/db";
import { createDeepSeekProvider } from "../src/server/llm/deepseek";
import type { LLMProvider } from "../src/server/llm/types";
import { createEmbeddingProvider, type EmbeddingProvider } from "../src/server/embedding";
import { ensureEmbedServer } from "./helpers/ensure-embed";
import { createAgentTools } from "../src/server/agent/tools";
import { conflictGuard } from "../src/server/agent/runtime";
import { createSessionState } from "../src/server/agent/state";

// 问题①：确定性冲突护栏 —— LLM 忘记调用 check_task_conflict 时，生成卡片前兜底强制查重叠；
// 用户最近消息明确「仍然创建/照旧」等才放行。纯确定性测试（不依赖 LLM）。
describe("Task 20: 确定性冲突护栏 conflictGuard", () => {
  let provider: LLMProvider | null = null;
  let embedding: EmbeddingProvider;
  const createdMeetings: string[] = [];
  let conflictTaskId = "";

  beforeAll(async () => {
    const apiKey = process.env.DEEPSEEK_API_KEY;
    provider = apiKey ? createDeepSeekProvider() : null;
    await ensureEmbedServer();
    embedding = createEmbeddingProvider();
    const startAt = new Date("2026-11-06T15:00:00+08:00"); // 周五 15:00（11月6日）
    const t = await prisma.meeting.create({
      data: {
        title: "与张三见面",
        taskType: "MEETING",
        startAt,
        endAt: new Date(startAt.getTime() + 30 * 60_000),
        status: "scheduled",
        source: "seed",
      },
    });
    conflictTaskId = t.id;
    createdMeetings.push(t.id);
  }, 120_000);

  afterAll(async () => {
    for (const id of createdMeetings) await prisma.meeting.delete({ where: { id } }).catch(() => {});
    await prisma.$disconnect();
  });

  it("同一时段创建任务 → 护栏阻断并提示冲突任务（即使 LLM 未查冲突）", async () => {
    const tools = await createAgentTools({ provider: provider!, embeddingProvider: embedding });
    const state = createSessionState();
    const r = await conflictGuard(
      { type: "CREATE_TASK", payload: { start: "2026-11-06T15:00:00+08:00" } },
      tools,
      state,
    );
    expect(r.blocked).toBe(true);
    expect(r.question).toContain("与张三见面");
  }, 30_000);

  it("用户最近消息明确「仍然创建」→ 放行；无重叠时段 → 放行", async () => {
    const tools = await createAgentTools({ provider: provider!, embeddingProvider: embedding });
    // 用户明确放行
    const s1 = createSessionState();
    s1.messages.push({ role: "user", content: "仍然创建" });
    const r1 = await conflictGuard(
      { type: "CREATE_TASK", payload: { start: "2026-11-06T15:00:00+08:00" } },
      tools,
      s1,
    );
    expect(r1.blocked).toBe(false);
    // 无重叠时段
    const s2 = createSessionState();
    const r2 = await conflictGuard(
      { type: "CREATE_TASK", payload: { start: "2026-11-06T17:00:00+08:00" } },
      tools,
      s2,
    );
    expect(r2.blocked).toBe(false);
    void conflictTaskId;
  }, 30_000);
});
