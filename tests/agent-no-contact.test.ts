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
import type { AgentOutcome } from "../src/server/agent/types";

// 问题①②：日程创建不依赖联系人 —— 真实 LLM + 真实 DB：
//   场景 1：无联系人任务（"我要上课"）→ 直接建卡，不询问联系方式
//   场景 2：提到人名但库里没有该联系人（"帮我约张三开会"）→ 不阻塞，标题体现人名直接建卡
// 断言关键点：全程不得出现询问「联系人/电话/邮箱/和谁」类问题。
const CONTACT_ASK_KEYWORDS = ["联系人", "电话", "邮箱", "手机号", "和谁", "跟谁", "联系方式"];

describe("Task 19: 日程创建不依赖联系人", () => {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  let provider: LLMProvider | null = null;
  let embedding: EmbeddingProvider;
  const createdMeetings: string[] = [];
  const createdActions: string[] = [];
  const createdContacts: string[] = [];

  beforeAll(async () => {
    provider = apiKey ? createDeepSeekProvider() : null;
    if (!provider) console.warn("DEEPSEEK_API_KEY 缺失，真实 LLM 场景将跳过");
    await ensureEmbedServer();
    embedding = createEmbeddingProvider();
  });

  afterAll(async () => {
    for (const id of createdActions) {
      const mems = await prisma.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM memories WHERE metadata->>'actionId' = ${id}
      `;
      for (const m of mems) await prisma.memory.delete({ where: { id: m.id } }).catch(() => {});
    }
    for (const id of createdMeetings) await prisma.meeting.delete({ where: { id } }).catch(() => {});
    for (const id of createdContacts) await prisma.contact.delete({ where: { id } }).catch(() => {});
  });

  // 补信息最多 2 轮；若询问联系方式类问题则立即断言失败
  async function settle(userText: string, test: { expectNotAsked: (q: string) => void }) {
    let r = await runAgentSession({ text: userText }, { provider: provider!, embeddingProvider: embedding });
    let rounds = 0;
    while (r.outcome.kind === "ask_user" && rounds < 2) {
      const q = r.outcome.question ?? "";
      test.expectNotAsked(q);
      r = await runAgentSession(
        { text: "都可以，按默认来", sessionId: r.sessionId },
        { provider: provider!, embeddingProvider: embedding },
      );
      rounds += 1;
    }
    return r;
  }

  it("无联系人任务（我要上课）→ 直接生成卡片，不询问联系方式", async () => {
    if (!provider) return;
    const r = await settle("我要上课，周六上午十点开始", {
      expectNotAsked: (q) => {
        expect(
          CONTACT_ASK_KEYWORDS.some((k) => q.includes(k)),
          `不应询问联系方式类问题，实际问题：${q}`,
        ).toBe(false);
      },
    });
    expect(r.outcome.kind).toBe("action_card");
    if (r.outcome.kind !== "action_card") return;
    const action = r.outcome.action!;
    expect(["CREATE_TASK", "CREATE_MEETING"]).toContain(action.type);
    const payload = action.payload as { start?: string; contactId?: string; title?: string };
    expect(payload.start).toBeTruthy();
    console.log("上课场景卡片:", action.type, JSON.stringify(payload));
  }, 180_000);

  it("提到人名但库里没有该联系人（与张三开会）→ 标题体现人名直接建卡，不强制问联系方式", async () => {
    if (!provider) return;
    const r = await settle("帮我约张三，周六下午三点开会", {
      expectNotAsked: (q) => {
        expect(
          CONTACT_ASK_KEYWORDS.some((k) => q.includes(k)),
          `不应询问联系方式类问题，实际问题：${q}`,
        ).toBe(false);
      },
    });
    expect(r.outcome.kind).toBe("action_card");
    if (r.outcome.kind !== "action_card") return;
    const action = r.outcome.action!;
    expect(["CREATE_TASK", "CREATE_MEETING"]).toContain(action.type);
    const payload = action.payload as { start?: string; title?: string };
    expect(payload.start).toBeTruthy();
    expect(payload.title ?? "").toContain("张三");
    // LLM 若自动创建了仅含名字的联系人，测试结束后回收
    const contact = (payload as { contact?: { id?: string } }).contact;
    if (contact?.id) createdContacts.push(contact.id);
    console.log("未知联系人场景卡片:", action.type, JSON.stringify(payload));
  }, 180_000);
});
