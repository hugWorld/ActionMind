import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../src/server/db";
import { createDeepSeekProvider } from "../src/server/llm/deepseek";
import type { LLMProvider } from "../src/server/llm/types";
import { createEmbeddingProvider, embedMemoriesMissing, type EmbeddingProvider } from "../src/server/embedding";
import { ensureEmbedServer } from "./helpers/ensure-embed";
import { runAgentSession } from "../src/server/agent/runtime";
import { confirmAction } from "../src/server/actions";
import { executeWithTools } from "../src/server/tools";

// Task 18 增补 — 时间冲突检测（真实 LLM + 真实 DB）：
//   创建/修改任务前 Agent 先 check_task_conflict；
//   有冲突 → ask_user 让用户选择（调整时间 / 仍然创建 / 放弃），禁止静默创建。
// 唯一命名「乔峰」避免并行冲突；vitest 文件级串行已开启。

describe("Task 18 增补: 时间冲突检测与用户选择", () => {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  let provider: LLMProvider | null = null;
  let embedding: EmbeddingProvider;
  const createdContacts: string[] = [];
  const createdMeetings: string[] = [];
  const createdActions: string[] = [];

  let conflictTaskId = ""; // 与乔峰的季度评审（2026-10-09 15:00，已确认）

  beforeAll(async () => {
    // 隔离：清空任务/动作/记忆表（本文件为冲突场景专用库，串行运行），保证冲突源唯一（乔峰 15:00）
    await prisma.meeting.deleteMany({});
    await prisma.action.deleteMany({});
    await prisma.memory.deleteMany({});
    await prisma.execution.deleteMany({});
    provider = apiKey ? createDeepSeekProvider() : null;
    if (!provider) console.warn("DEEPSEEK_API_KEY 缺失，真实 LLM 场景将跳过");
    await ensureEmbedServer();
    embedding = createEmbeddingProvider();

    const qiao = await prisma.contact.create({
      data: {
        name: "乔峰",
        phones: { create: [{ phone: "13900139000", verified: true, active: true, source: "seed" }] },
      },
    });
    createdContacts.push(qiao.id);

    const startAt = new Date("2026-10-09T15:00:00+08:00");
    const t = await prisma.meeting.create({
      data: {
        contactId: qiao.id,
        title: "与乔峰的季度评审",
        taskType: "MEETING",
        startAt,
        endAt: new Date(startAt.getTime() + 30 * 60_000),
        location: "三楼会议室",
        status: "scheduled",
        source: "seed",
      },
    });
    conflictTaskId = t.id;
    createdMeetings.push(t.id);
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

  it("check_task_conflict 工具（确定性）：重叠判定与 excludeTaskId（用自建任务隔离，不依赖库干净度）", async () => {
    const tools = await (await import("../src/server/agent/tools")).createAgentTools({
      provider: provider!,
      embeddingProvider: embedding,
    });
    // 自建一条 18:00-18:30 任务，验证工具对该任务的判定（避免受历史遗留数据影响）
    const yStart = new Date("2026-10-09T18:00:00+08:00");
    const y = await prisma.meeting.create({
      data: {
        title: "冲突单测专用任务",
        taskType: "MEETING",
        startAt: yStart,
        endAt: new Date(yStart.getTime() + 30 * 60_000),
        status: "scheduled",
        source: "seed",
      },
    });
    createdMeetings.push(y.id);

    // 同一时段重叠 → conflicted=true 且列出该任务
    const hit = (await tools.check_task_conflict.execute({
      startAt: "2026-10-09T18:00:00+08:00",
    })) as { conflicted: boolean; conflicts: Array<{ id: string; title: string }> };
    expect(hit.conflicted).toBe(true);
    expect(hit.conflicts.some((c) => c.id === y.id)).toBe(true);

    // 排除自身（修改场景）→ 不再视为冲突
    const self = (await tools.check_task_conflict.execute({
      startAt: "2026-10-09T18:00:00+08:00",
      endAt: "2026-10-09T18:30:00+08:00",
      excludeTaskId: y.id,
    })) as { conflicted: boolean; conflicts: Array<{ id: string }> };
    expect(self.conflicts.some((c) => c.id === y.id)).toBe(false);

    // 完全不重叠的时段 → 结果不含该任务
    const miss = (await tools.check_task_conflict.execute({
      startAt: "2026-10-09T20:00:00+08:00",
    })) as { conflicted: boolean; conflicts: Array<{ id: string }> };
    expect(miss.conflicts.some((c) => c.id === y.id)).toBe(false);
  }, 30_000);

  it("同时间创建：先 check_task_conflict → 冲突时 ask_user → 用户『仍然创建』→ 卡片并执行（两任务并存）", async () => {
    if (!provider) return;
    const q = "帮我约乔峰，周五下午三点开个会，乔峰电话 13900139000";
    let r = await runAgentSession({ text: q }, { provider, embeddingProvider: embedding });

    // LLM 应调用 check_task_conflict 发现冲突并 ask_user；若未询问（偶发）重试一次
    if (r.outcome.kind !== "ask_user") {
      r = await runAgentSession({ text: q }, { provider, embeddingProvider: embedding });
    }
    // 冲突存在于既有已确认任务时，Agent 必须 ask_user（不允许直接建卡）
    expect(r.outcome.kind).toBe("ask_user");
    if (r.outcome.kind !== "ask_user") return;

    const trace = r.state.trace;
    expect(trace.some((t) => t.tool === "check_task_conflict")).toBe(true);
    expect(r.outcome.question).toContain("乔峰");

    // 用户选择「仍然创建」→ 直接生成卡片（不再询问），确认后执行
    let r2 = await runAgentSession(
      { text: "仍然创建", sessionId: r.sessionId },
      { provider, embeddingProvider: embedding },
    );
    // LLM 偶发再次确认（重问冲突）→ 再回一轮「仍然创建」
    if (r2.outcome.kind === "ask_user") {
      r2 = await runAgentSession(
        { text: "仍然创建", sessionId: r2.sessionId },
        { provider, embeddingProvider: embedding },
      );
    }
    expect(r2.outcome.kind).toBe("action_card");
    if (r2.outcome.kind !== "action_card") return;
    // CREATE_TASK 与兼容别名 CREATE_MEETING 均合法（等价 type=MEETING）
    expect(["CREATE_TASK", "CREATE_MEETING"]).toContain(r2.outcome.action.type);

    const payload = r2.outcome.action.payload as { start?: string; contact?: { name?: string } };
    expect(payload.contact?.name).toBe("乔峰");

    const actionId = r2.outcome.action.id;
    createdActions.push(actionId);
    await confirmAction(actionId);
    const res = await executeWithTools(actionId, { embeddingProvider: embedding });
    expect(res.ok).toBe(true);

    // 用户明确选择仍然创建 → 同一时间两任务并存
    const rows = await prisma.meeting.findMany({
      where: { contactId: (await prisma.contact.findFirst({ where: { name: "乔峰" } }))!.id, startAt: new Date("2026-10-09T07:00:00Z") },
    });
    expect(rows.length).toBeGreaterThanOrEqual(2);
  }, 300_000);

  it("同时间冲突 → 用户『改到下午四点』→ 无冲突新时间建卡", async () => {
    if (!provider) return;
    const q = "帮我约乔峰，周五下午三点开会，乔峰电话 13900139000";
    let r = await runAgentSession({ text: q }, { provider, embeddingProvider: embedding });
    if (r.outcome.kind !== "ask_user") {
      r = await runAgentSession({ text: q }, { provider, embeddingProvider: embedding });
    }
    expect(r.outcome.kind).toBe("ask_user");
    if (r.outcome.kind !== "ask_user") return;

    // 用户回复「改到下午四点」→ Agent 可能直接建卡，或再确认一轮（ReAct 动态决策），容错续跑
    let r2 = await runAgentSession(
      { text: "改到下午四点", sessionId: r.sessionId },
      { provider, embeddingProvider: embedding },
    );
    if (r2.outcome.kind === "ask_user") {
      r2 = await runAgentSession(
        { text: "对，就下午四点，没有其他信息了", sessionId: r2.sessionId },
        { provider, embeddingProvider: embedding },
      );
    }
    expect(r2.outcome.kind).toBe("action_card");
    if (r2.outcome.kind !== "action_card") return;
    const payload = r2.outcome.action.payload as { start?: string };
    // 16:00（Asia/Shanghai）→ ISO 应包含 16:00+08:00 或等价 08:00Z
    const start = payload.start ?? "";
    expect(start.includes("16:00") || start.includes("08:00")).toBe(true);
    console.log("调整后时间:", start);
  }, 300_000);
});
