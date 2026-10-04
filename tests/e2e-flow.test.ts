import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDeepSeekProvider } from "../src/server/llm/deepseek";
import type { LLMProvider } from "../src/server/llm/types";
import { understandChat } from "../src/server/llm/understand";
import { createActionCard, confirmAction } from "../src/server/actions";
import { executeWithTools } from "../src/server/tools";
import { UnauthorizedExecutionError } from "../src/server/execution";
import { createEmbeddingProvider } from "../src/server/embedding";
import { createHybridSearcher } from "../src/server/search/hybrid";
import { keywordSearchMemories } from "../src/server/search";
import { prisma } from "../src/server/db";
import { ensureEmbedServer } from "./helpers/ensure-embed";

// Task 16 / Gate 16 — 三个完整场景（API 级完整链路）：
// Understanding → Action Card(DRAFT) → 未确认拒绝 → Confirm → Tool → Verified Memory → Future Query(Hybrid RAG)
// 联系人/记忆语料使用独特前缀，避免与并行测试文件（eval-70 / tool-executor 等）互相污染。

const apiKey = process.env.DEEPSEEK_API_KEY;
let provider: LLMProvider | null = null;

describe("Task 16 E2E Flow（API 级完整链路）", () => {
  beforeAll(async () => {
    provider = apiKey ? createDeepSeekProvider() : null;
    if (apiKey) await ensureEmbedServer();
  }, 240_000);

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it(
    "场景1 CREATE_MEETING：上传理解 → 卡片 → 未确认拒绝 → 确认 → 执行 → Verified Memory → Future Query 命中",
    async () => {
      if (!provider) throw new Error("缺少 DEEPSEEK_API_KEY，无法跑真实 LLM 场景");
      const u = await understandChat(provider, {
        transcript: "张三：10月9日周五下午三点在星巴克见？\n李四：可以。",
      });
      expect(u.intent).toBe("CREATE_MEETING");
      expect(u.meeting?.start).toBeTruthy();

      const action = await createActionCard("CREATE_MEETING", {
        title: u.meeting?.title ?? "与张三的会议",
        start: u.meeting?.start,
        end: u.meeting?.end ?? null,
        location: u.meeting?.location ?? null,
        contact: u.contacts[0] ? { name: u.contacts[0].name ?? undefined } : null,
        missing: u.missing,
      });

      // 未确认 → 拒绝且零副作用
      await expect(executeWithTools(action.id)).rejects.toThrow(UnauthorizedExecutionError);

      // 确认 → 执行
      await confirmAction(action.id);
      const result = await executeWithTools(action.id, {
        embeddingProvider: createEmbeddingProvider(),
      });
      expect(result.ok).toBe(true);

      const meeting = await prisma.meeting.findUnique({
        where: { id: (result.response as { meetingId: string }).meetingId },
      });
      expect(meeting).not.toBeNull();
      expect(meeting?.eventId?.startsWith("mock:")).toBe(true);

      // Verified Memory（tool_verified / 1.0 / 可溯源）
      const mems = await prisma.$queryRaw<Array<{ id: string; source: string; confidence: number }>>`
        SELECT id, source, confidence FROM memories WHERE metadata->>'actionId' = ${action.id} LIMIT 5
      `;
      expect(mems.length).toBeGreaterThan(0);
      expect(mems[0].source).toBe("tool_verified");
      expect(mems[0].confidence).toBe(1);

      // Future Query → Hybrid RAG 命中该 Verified Memory
      const hybrid = await createHybridSearcher(createEmbeddingProvider(), {});
      const hits = await hybrid.search("和张三约的会议在哪里", { k: 5 });
      expect(hits.some((h) => h.memoryId === mems[0].id)).toBe(true);
      // 关键词通道也应命中
      const kw = await keywordSearchMemories("张三 星巴克", { k: 5 });
      expect(kw.some((h) => h.memoryId === mems[0].id)).toBe(true);

      // 清理
      for (const m of mems) await prisma.memory.delete({ where: { id: m.id } }).catch(() => {});
      if (meeting) await prisma.meeting.delete({ where: { id: meeting.id } }).catch(() => {});
      await prisma.action.delete({ where: { id: action.id } }).catch(() => {});
    },
    120_000,
  );

  it(
    "场景2 CREATE_CONTACT：理解 → 卡片 → 确认 → 执行 → 联系人落库 + Verified Memory",
    async () => {
      if (!provider) throw new Error("缺少 DEEPSEEK_API_KEY，无法跑真实 LLM 场景");
      const u = await understandChat(provider, {
        transcript: "我是陈晨，我的电话是 13800001234，在评测科技做前端。",
      });
      expect(u.intent).toBe("CREATE_CONTACT");

      const contact0 = u.contacts[0];
      const action = await createActionCard("CREATE_CONTACT", {
        name: contact0?.name ?? "陈晨",
        email: contact0?.email ?? null,
        phone: contact0?.phone ?? "13800001234",
        organization: contact0?.organization ?? null,
      });
      await confirmAction(action.id);
      const result = await executeWithTools(action.id, {
        embeddingProvider: createEmbeddingProvider(),
      });
      expect(result.ok).toBe(true);
      const contactId = (result.response as { contactId: string }).contactId;
      const contact = await prisma.contact.findUnique({
        where: { id: contactId },
        include: { emails: true, phones: true },
      });
      expect(contact).not.toBeNull();
      expect(contact?.name).toBe("陈晨");

      const mems = await prisma.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM memories WHERE metadata->>'actionId' = ${action.id} LIMIT 5
      `;
      expect(mems.length).toBeGreaterThan(0);

      for (const m of mems) await prisma.memory.delete({ where: { id: m.id } }).catch(() => {});
      if (contact) await prisma.contact.delete({ where: { id: contact.id } }).catch(() => {});
      await prisma.action.delete({ where: { id: action.id } }).catch(() => {});
    },
    120_000,
  );

  it(
    "场景3 UPDATE_CONTACT：理解 → 卡片 → 确认 → 执行 → 新邮箱落库 + Verified Memory",
    async () => {
      if (!provider) throw new Error("缺少 DEEPSEEK_API_KEY，无法跑真实 LLM 场景");
      // 预置一个已有联系人（独特名）
      const seed = await prisma.contact.create({
        data: {
          name: "评测E2E李娜",
          emails: { create: [{ email: "lina-old@example.com", verified: true, active: true, source: "e2e-seed" }] },
        },
      });
      try {
        const u = await understandChat(provider, {
          transcript: "李娜：我换邮箱了，以后用 lina-new@example.com 联系我。",
        });
        expect(u.intent).toBe("UPDATE_CONTACT");
        expect(u.contactUpdate?.contactName).toBe("李娜");
        expect(u.contactUpdate?.newValue).toContain("lina-new@example.com");

        // 定位到预置联系人（按 name 解析）
        const action = await createActionCard("UPDATE_CONTACT", {
          name: "评测E2E李娜",
          email: u.contactUpdate?.newValue,
        });
        await confirmAction(action.id);
        const result = await executeWithTools(action.id, {
          embeddingProvider: createEmbeddingProvider(),
        });
        expect(result.ok).toBe(true);

        const updated = await prisma.contact.findUnique({
          where: { id: seed.id },
          include: { emails: true },
        });
        const emails = (updated?.emails ?? []).map((e) => e.email.toLowerCase());
        expect(emails).toContain("lina-new@example.com");

        const mems = await prisma.$queryRaw<Array<{ id: string }>>`
          SELECT id FROM memories WHERE metadata->>'actionId' = ${action.id} LIMIT 5
        `;
        expect(mems.length).toBeGreaterThan(0);
        for (const m of mems) await prisma.memory.delete({ where: { id: m.id } }).catch(() => {});
        await prisma.action.delete({ where: { id: action.id } }).catch(() => {});
      } finally {
        await prisma.contact.delete({ where: { id: seed.id } }).catch(() => {});
      }
    },
    120_000,
  );
});
