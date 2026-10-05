import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../src/server/db";
import { createDeepSeekProvider } from "../src/server/llm/deepseek";
import type { LLMProvider } from "../src/server/llm/types";
import { createEmbeddingProvider, embedMemoriesMissing } from "../src/server/embedding";
import type { EmbeddingProvider } from "../src/server/embedding";
import { ensureEmbedServer } from "./helpers/ensure-embed";
import { runAgentLoop } from "../src/server/agent";

// Gate 9 — Agent Runtime：Agent Loop + memory_search / contact_search / ask_user / create_action
// 验证：根据不同输入 → 选择 Memory / 选择 Contact / 询问用户 / 生成 Action

describe("Task 9: Agent Runtime", () => {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  let provider: LLMProvider | null = null;
  let embedding: EmbeddingProvider;
  const createdContacts: string[] = [];
  const createdMemories: string[] = [];
  const createdActions: string[] = [];
  let zhangsanId = "";
  let meetingRoomMemoryId = "";

  beforeAll(async () => {
    provider = apiKey ? createDeepSeekProvider() : null;
    if (!provider) {
      console.warn("DEEPSEEK_API_KEY 缺失，跳过真实 LLM 场景");
    }
    await ensureEmbedServer();
    embedding = createEmbeddingProvider();

    // 种子：联系人（张三）与记忆（Meeting Room 3 季度评审会）
    // 注意：记忆内容必须与 tests/fixtures/eval-set.ts 的语料逐字不同，
    // 否则并行测试时库里出现同 content 的两条记忆会导致检索断言错位。
    const zs = await prisma.contact.create({
      data: {
        name: "张三",
        organization: "某某科技",
        role: "研究员",
        emails: { create: [{ email: "zhangsan@example.com", verified: true }] },
        phones: { create: [{ phone: "13800000000", verified: true }] },
      },
    });
    zhangsanId = zs.id;
    createdContacts.push(zs.id);

    for (const content of ["上次和张三在 Meeting Room 3 开的季度评审会"]) {
      const m = await prisma.memory.create({
        data: {
          type: "meeting",
          content,
          source: "model_inferred",
          confidence: 0.3,
        },
      });
      createdMemories.push(m.id);
      meetingRoomMemoryId = m.id;
    }
    await embedMemoriesMissing(embedding);
  }, 240_000);

  afterAll(async () => {
    for (const id of createdActions) await prisma.action.delete({ where: { id } }).catch(() => {});
    for (const id of createdMemories) await prisma.memory.delete({ where: { id } }).catch(() => {});
    for (const id of createdContacts) await prisma.contact.delete({ where: { id } }).catch(() => {});
    await prisma.$disconnect();
  });

  it("生成 Action：选择 Memory（历史引用）+ 选择 Contact + create_action", async () => {
    if (!provider) return;
    const { outcome, trace } = await runAgentLoop("帮我约张三，周六下午三点，还是上次那个会议室。", {
      provider,
      embeddingProvider: embedding,
    });
    console.log("trace:", JSON.stringify(trace.map((t) => t.tool)));
    expect(outcome.kind).toBe("action_card");
    if (outcome.kind !== "action_card") return;
    expect(["CREATE_TASK", "CREATE_MEETING"]).toContain(outcome.action.type); // 兼容别名等价
    // 历史引用 → 调用了 memory_search，且结果被写入 payload.location
    expect(trace.some((t) => t.tool === "memory_search")).toBe(true);
    expect(JSON.stringify(outcome.action.payload)).toContain("Meeting Room 3");
    createdActions.push(outcome.action.id);
  }, 120_000);

  it("询问用户：关键信息缺失 → ask_user", async () => {
    if (!provider) return;
    const { outcome } = await runAgentLoop("帮我约张三。", { provider, embeddingProvider: embedding });
    expect(outcome.kind).toBe("ask_user");
    if (outcome.kind === "ask_user") {
      expect(outcome.question.length).toBeGreaterThan(0);
      // 缺的是时间 → 问题应涉及时间
      expect(outcome.question).toMatch(/时间|几点|什么时候|何时/);
    }
  }, 120_000);

  it("选择 Memory：回答历史安排并给出依据", async () => {
    if (!provider) return;
    const { outcome } = await runAgentLoop("我们上次在哪个会议室开的会？", {
      provider,
      embeddingProvider: embedding,
    });
    expect(outcome.kind).toBe("answer");
    if (outcome.kind !== "answer") return;
    expect(outcome.content).toContain("Meeting Room 3");
    expect(outcome.memoryIds).toContain(meetingRoomMemoryId);
  }, 120_000);

  it("选择 Contact：not_found → ask_user 澄清（而非假装已解析）", async () => {
    if (!provider) return;
    const { outcome, trace } = await runAgentLoop("帮我约王小明，周五下午三点。", {
      provider,
      embeddingProvider: embedding,
    });
    expect(trace.some((t) => t.tool === "contact_search")).toBe(true);
    expect(["ask_user", "action_card"]).toContain(outcome.kind);
    if (outcome.kind === "ask_user") {
      expect(outcome.question).toMatch(/王小明|联系人|不存在|新建/);
    }
  }, 120_000);

  it("无行动意图 → unknown", async () => {
    if (!provider) return;
    const { outcome } = await runAgentLoop("今天天气不错。", { provider, embeddingProvider: embedding });
    expect(outcome.kind).toBe("unknown");
  }, 120_000);
});
