import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../src/server/db";
import { createDeepSeekProvider } from "../src/server/llm/deepseek";
import type { LLMProvider } from "../src/server/llm/types";
import {
  createEmbeddingProvider,
  embedMemoriesMissing,
  type EmbeddingProvider,
} from "../src/server/embedding";
import { ensureEmbedServer } from "./helpers/ensure-embed";
import { runAgentSession } from "../src/server/agent/runtime";
import { createAgentTools } from "../src/server/agent/tools";
import { confirmAction } from "../src/server/actions";
import { executeWithTools } from "../src/server/tools";

// Task 18 (Stage B) — Agent 层的任务/日程能力（真实 LLM + 真实 DB）：
//   - task_search 决策工具（与 Schedule 页共享 queryTasks）
//   - 查询日程 → task_search + answer 直接回答（不建卡）
//   - 取消任务 → 定位 + 多候选必须 ask_user 消歧（禁止猜测）→ CANCEL_TASK
//   - 修改任务 → task_search 定位 → UPDATE_TASK（Human-in-the-loop）
// 唯一命名「王语嫣」避免并行冲突；vitest 文件级串行已开启。

describe("Task 18 Stage B: Agent 任务/日程能力", () => {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  let provider: LLMProvider | null = null;
  let embedding: EmbeddingProvider;
  const createdContacts: string[] = [];
  const createdMeetings: string[] = [];
  const createdActions: string[] = [];

  let candidate1Id = ""; // 与王语嫣的方案评审会议（10-09 15:00）
  let candidate2Id = ""; // 与王语嫣的季度会议（10-09 15:00）
  let uniqueTaskId = ""; // 唯一匹配任务（10-09 15:00）

  beforeAll(async () => {
    provider = apiKey ? createDeepSeekProvider() : null;
    if (!provider) console.warn("DEEPSEEK_API_KEY 缺失，真实 LLM 场景将跳过");
    await ensureEmbedServer();
    embedding = createEmbeddingProvider();

    const wang = await prisma.contact.create({
      data: {
        name: "王语嫣",
        phones: { create: [{ phone: "13700137000", verified: true, active: true, source: "seed" }] },
      },
    });
    createdContacts.push(wang.id);

    const mk = (title: string, date: string, time: string) => {
      const startAt = new Date(`${date}T${time}:00+08:00`);
      return prisma.meeting.create({
        data: {
          contactId: wang.id,
          title,
          taskType: "MEETING",
          startAt,
          endAt: new Date(startAt.getTime() + 30 * 60_000),
          location: "三楼会议室",
          status: "scheduled",
          source: "seed",
        },
      });
    };

    // 消歧场景：同一时间两条候选（都匹配“和王语嫣周五下午三点的会议”）
    const c1 = await mk("与王语嫣的方案评审会议", "2026-10-09", "15:00");
    const c2 = await mk("与王语嫣的季度会议", "2026-10-09", "15:00");
    candidate1Id = c1.id;
    candidate2Id = c2.id;
    createdMeetings.push(c1.id, c2.id);
    // 唯一匹配场景：不同标题、不同时间
    const u = await mk("与王语嫣的年度回顾会议", "2026-10-09", "09:00");
    uniqueTaskId = u.id;
    createdMeetings.push(u.id);
    await embedMemoriesMissing(embedding);
  }, 240_000);

  afterAll(async () => {
    for (const id of createdActions) {
      const mems = await prisma.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM memories WHERE metadata->>'actionId' = ${id}
      `;
      for (const m of mems) await prisma.memory.delete({ where: { id: m.id } }).catch(() => {});
    }
    for (const id of createdMeetings) await prisma.meeting.delete({ where: { id } }).catch(() => {});
    for (const id of createdContacts) await prisma.contact.delete({ where: { id } }).catch(() => {});
    for (const id of createdActions) await prisma.action.delete({ where: { id } }).catch(() => {});
    await prisma.$disconnect();
  });

  it("task_search 决策工具：按联系人+日期查询日程（与 Schedule 共享数据源）", async () => {
    const tools = await createAgentTools({ provider: provider!, embeddingProvider: embedding });
    const r = (await tools.task_search.execute({
      contactName: "王语嫣",
      startDate: "2026-10-09",
      endDate: "2026-10-09",
    })) as { count: number; tasks: Array<{ id: string; title: string; statusView: string }> };
    expect(r.count).toBe(3); // 两条 15:00 候选 + 一条 09:00
    const ids = r.tasks.map((t) => t.id);
    expect(ids).toEqual(expect.arrayContaining([candidate1Id, candidate2Id, uniqueTaskId]));
    expect(r.tasks.every((t) => t.statusView === "CONFIRMED")).toBe(true);
  }, 60_000);

  it("查询日程：『王语嫣周五有什么安排？』→ task_search + answer（不建卡）", async () => {
    if (!provider) return;
    const r = await runAgentSession(
      { text: "王语嫣周五（10月9日）有什么安排？" },
      { provider, embeddingProvider: embedding },
    );
    expect(r.state.trace.some((t) => t.tool === "task_search")).toBe(true);
    expect(["answer", "ask_user"]).toContain(r.outcome.kind);
    if (r.outcome.kind === "answer") {
      expect(r.outcome.content).toContain("王语嫣");
    }
    console.log("查询回答:", r.outcome.kind === "answer" ? r.outcome.content : "(非 answer)");
  }, 180_000);

  it("取消任务（消歧）：两条候选同一时间 → 必须 ask_user 让用户选择，禁止猜测", async () => {
    if (!provider) return;
    const q = "帮我取消和王语嫣周五下午三点的会议";
    let r = await runAgentSession({ text: q }, { provider, embeddingProvider: embedding });
    if (r.outcome.kind !== "ask_user") {
      r = await runAgentSession({ text: q }, { provider, embeddingProvider: embedding });
    }
    expect(r.outcome.kind).toBe("ask_user");
    if (r.outcome.kind !== "ask_user") return;
    const question = r.outcome.question;
    expect(question).toContain("王语嫣");
    // 用户选择 → 生成 CANCEL_TASK 卡片
    const r2 = await runAgentSession(
      { text: "取消第一个（方案评审会议）", sessionId: r.sessionId },
      { provider, embeddingProvider: embedding },
    );
    expect(r2.outcome.kind).toBe("action_card");
    if (r2.outcome.kind !== "action_card") return;
    expect(r2.outcome.action.type).toBe("CANCEL_TASK");
    const payload = r2.outcome.action.payload as { taskId?: string; reason?: string };
    expect([candidate1Id, candidate2Id]).toContain(payload.taskId);

    // Human-in-the-loop：确认 → 执行 → cancelled（不物理删除）
    const actionId = r2.outcome.action.id;
    createdActions.push(actionId);
    await confirmAction(actionId);
    const res = await executeWithTools(actionId, { embeddingProvider: embedding });
    expect(res.ok).toBe(true);
    const row = await prisma.meeting.findUniqueOrThrow({ where: { id: payload.taskId! } });
    expect(row.status).toBe("cancelled");
  }, 240_000);

  it("修改任务：『把和王语嫣的季度会议改到周六下午三点』→ UPDATE_TASK（唯一匹配）", async () => {
    if (!provider) return;
    const r = await runAgentSession(
      { text: "把和王语嫣的季度会议改到周六下午三点" },
      { provider, embeddingProvider: embedding },
    );
    expect(r.outcome.kind).toBe("action_card");
    if (r.outcome.kind !== "action_card") return;
    expect(r.outcome.action.type).toBe("UPDATE_TASK");
    const payload = r.outcome.action.payload as {
      taskId?: string;
      changes?: { start?: string };
    };
    expect(payload.taskId).toBe(candidate2Id); // “季度会议”唯一匹配第二条
    expect(payload.changes?.start).toBeTruthy();

    const actionId = r.outcome.action.id;
    createdActions.push(actionId);
    await confirmAction(actionId);
    const res = await executeWithTools(actionId, { embeddingProvider: embedding });
    expect(res.ok).toBe(true);
    const row = await prisma.meeting.findUniqueOrThrow({ where: { id: candidate2Id } });
    const start = new Date(row.startAt);
    // 周六 15:00（+08:00）→ UTC 07:00
    expect(start.toISOString()).toBe(new Date("2026-10-10T07:00:00Z").toISOString());
  }, 240_000);
});
