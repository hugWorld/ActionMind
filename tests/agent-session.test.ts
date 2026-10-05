import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
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

// Task 17 (Stage B) — 会话化 Agent Runtime（真实 LLM + 真实 DB + embedding）
// 验证：
//   1) Text-only 历史查询 → Contact/Memory Retrieval 直接回答（无需截图）
//   2) 多轮 ReAct：缺 Required 字段 → ask_user → 同会话续跑补齐 → action_card（end 默认 +30min）
//   3) Image-only：微信风格截图 → 结构化理解 → action_card
// 说明：vitest.config.ts 已开启文件级串行，避免与其它测试文件的种子数据冲突。

describe("Task 17 Stage B: 会话化 Agent Runtime", () => {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  let provider: LLMProvider | null = null;
  let embedding: EmbeddingProvider;
  const createdContacts: string[] = [];
  const createdMemories: string[] = [];
  const createdActions: string[] = [];

  beforeAll(async () => {
    provider = apiKey ? createDeepSeekProvider() : null;
    if (!provider) {
      console.warn("DEEPSEEK_API_KEY 缺失，跳过真实 LLM 场景");
    }
    await ensureEmbedServer();
    embedding = createEmbeddingProvider();

    // 种子：联系人（张三）与一条“上次和张三开会”的 Verified Memory
    // （content 与 tests/fixtures/eval-set.ts 语料保持不同字面，避免检索错位）
    const zs = await prisma.contact.create({
      data: {
        name: "张三",
        organization: "某某科技",
        role: "研究员",
        emails: { create: [{ email: "zhangsan-session@example.com", verified: true }] },
        phones: { create: [{ phone: "13900001111", verified: true }] },
      },
    });
    createdContacts.push(zs.id);

    const m = await prisma.memory.create({
      data: {
        type: "meeting",
        content: "2026-09-25 下午两点和张三在五层会议室开的项目周会，主要对齐进度",
        source: "tool_verified",
        confidence: 1,
      },
    });
    createdMemories.push(m.id);
    await embedMemoriesMissing(embedding);
  }, 240_000);

  afterAll(async () => {
    for (const id of createdActions) await prisma.action.delete({ where: { id } }).catch(() => {});
    for (const id of createdMemories) await prisma.memory.delete({ where: { id } }).catch(() => {});
    for (const id of createdContacts) await prisma.contact.delete({ where: { id } }).catch(() => {});
    await prisma.$disconnect();
  });

  it("Text-only 历史查询：直接回答（无需截图）", async () => {
    if (!provider) return;
    const r = await runAgentSession(
      { text: "我和张三上次是什么时候开的会？" },
      { provider, embeddingProvider: embedding },
    );
    expect(r.outcome.kind).toBe("answer");
    expect(r.state.trace.some((t) => t.tool === "memory_search")).toBe(true);
    if (r.outcome.kind === "answer") {
      expect(r.outcome.content.length).toBeGreaterThan(0);
      console.log("历史查询回答:", r.outcome.content);
    }
  }, 120_000);

  it("多轮 ReAct：缺时间 → ask_user → 续跑补时间 → action_card（end 默认 +30min）", async () => {
    if (!provider) return;
    const r1 = await runAgentSession(
      { text: "帮我约张三开个会" },
      { provider, embeddingProvider: embedding },
    );
    expect(r1.outcome.kind).toBe("ask_user");
    console.log("第一轮 ask_user:", r1.outcome.kind === "ask_user" ? r1.outcome.question : "(非 ask_user)");

    const r2 = await runAgentSession(
      { text: "明天下午三点", sessionId: r1.sessionId },
      { provider, embeddingProvider: embedding },
    );
    expect(r2.outcome.kind).toBe("action_card");
    if (r2.outcome.kind !== "action_card") return;
    expect(["CREATE_TASK", "CREATE_MEETING"]).toContain(r2.outcome.action.type); // 兼容别名等价

    const payload = r2.outcome.action.payload as Record<string, unknown>;
    expect(typeof payload.start === "string" && payload.start.length > 0).toBe(true);
    // Defaultable：结束时间自动补齐 start + 30 分钟
    expect(typeof payload.end === "string" && payload.end.length > 0).toBe(true);
    const start = new Date(payload.start as string).getTime();
    const end = new Date(payload.end as string).getTime();
    expect(end - start).toBe(30 * 60_000);

    // 会话状态：phase=ready，且卡片已记录
    expect(r2.state.phase).toBe("ready");
    expect(r2.state.currentAction?.id).toBe(r2.outcome.action.id);
    createdActions.push(r2.outcome.action.id);
  }, 180_000);

  it("Image-only：微信风格截图（无历史引用）→ 理解 → action_card", async () => {
    if (!provider) return;
    // 用无历史引用的微信风格截图（chat-wechat-simple.png，右绿气泡=用户本人），
    // 避免 needsMemory 依赖记忆库状态导致不稳定；微信图 + 历史引用场景在 screenshot-wechat.test.ts 单独覆盖。
    const file = fs.readFileSync(path.join(__dirname, "assets", "chat-wechat-simple.png"));
    let r = await runAgentSession(
      { imageDataUrl: `data:image/png;base64,${file.toString("base64")}` },
      { provider, embeddingProvider: embedding },
    );
    // Location 是 Conditional：LLM 偶发按上下文问「需要线上进行吗？」→ 回补一轮「不需要线上」
    if (r.outcome.kind === "ask_user") {
      r = await runAgentSession(
        { text: "不需要线上，直接创建", sessionId: r.sessionId },
        { provider, embeddingProvider: embedding },
      );
    }
    expect(r.outcome.kind).toBe("action_card");
    if (r.outcome.kind !== "action_card") return;
    expect(["CREATE_TASK", "CREATE_MEETING"]).toContain(r.outcome.action.type); // 兼容别名等价
    const payload = r.outcome.action.payload as Record<string, unknown>;
    expect(JSON.stringify(payload)).toContain("张三");
    expect(payload.start).toBeTruthy();
    createdActions.push(r.outcome.action.id);
  }, 180_000);
});
