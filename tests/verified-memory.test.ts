import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Prisma } from "@prisma/client";
import { prisma } from "../src/server/db";
import { createEmbeddingProvider } from "../src/server/embedding";
import type { EmbeddingProvider } from "../src/server/embedding";
import { ensureEmbedServer } from "./helpers/ensure-embed";
import { confirmAction } from "../src/server/actions";
import { executeWithTools } from "../src/server/tools";
import {
  MEMORY_CONFIDENCE,
  MEMORY_SOURCE,
  createCandidateMemory,
  createVerifiedMemory,
  verifyMemory,
  MemoryPipelineError,
} from "../src/server/memory";

// Gate 13 — Verified Memory：Tool Success → source=tool_verified / confidence=1.0；失败不生成。

describe("Task 13: Verified Memory", () => {
  let embedding: EmbeddingProvider;
  const createdContacts: string[] = [];
  const createdActions: string[] = [];
  const createdMemories: string[] = [];
  const cleaned: string[] = [];

  async function makeAction(type: string, payload: Record<string, unknown>) {
    const a = await prisma.action.create({
      data: { type, status: "DRAFT", payload: payload as Prisma.InputJsonValue, source: "test" },
    });
    createdActions.push(a.id);
    return a;
  }

  /** 按 metadata->>'actionId' 读取执行沉淀的记忆 */
  async function memoriesOfAction(actionId: string): Promise<
    Array<{ id: string; source: string; confidence: number; content: string; type: string; hasEmbedding: boolean }>
  > {
    return prisma.$queryRaw`
      SELECT
        id, source, confidence, content, type,
        (embedding IS NOT NULL) AS "hasEmbedding"
      FROM memories
      WHERE metadata->>'actionId' = ${actionId}
    `;
  }

  async function countVerifiedOf(contactId: string): Promise<number> {
    const rows = await prisma.$queryRaw<Array<{ c: number }>>`
      SELECT count(*)::int AS c FROM memories
      WHERE contact_id = ${contactId} AND source = 'tool_verified'
    `;
    return Number(rows[0].c);
  }

  beforeAll(async () => {
    await ensureEmbedServer();
    embedding = createEmbeddingProvider();
  }, 180_000);

  afterAll(async () => {
    for (const id of [...new Set([...createdMemories, ...cleaned])]) {
      await prisma.memory.delete({ where: { id } }).catch(() => {});
    }
    for (const id of createdActions) await prisma.action.delete({ where: { id } }).catch(() => {});
    for (const id of createdContacts) await prisma.contact.delete({ where: { id } }).catch(() => {});
    await prisma.$disconnect();
  });

  it("create_event 成功 → Verified Memory（source=tool_verified, confidence=1.0, type=meeting, 含 embedding）", async () => {
    // 种子联系人（唯一姓名，避免并行冲突）
    const qian = await prisma.contact.create({
      data: {
        name: "钱七",
        emails: { create: [{ email: "qianqi@example.com", verified: true, active: true, source: "seed" }] },
      },
    });
    createdContacts.push(qian.id);

    const action = await makeAction("CREATE_MEETING", {
      title: "产品评审会",
      start: "2026-10-09T15:00:00+08:00",
      location: "Meeting Room 3",
      contact: { name: "钱七" },
    });
    await confirmAction(action.id);
    const result = await executeWithTools(action.id, { embeddingProvider: embedding });
    expect(result.ok).toBe(true);

    const mems = await memoriesOfAction(action.id);
    expect(mems.length).toBe(1);
    const m = mems[0];
    createdMemories.push(m.id);
    expect(m.source).toBe(MEMORY_SOURCE.VERIFIED);
    expect(m.confidence).toBe(MEMORY_CONFIDENCE.VERIFIED);
    expect(m.type).toBe("meeting");
    expect(m.content).toContain("产品评审会");
    expect(m.content).toContain("Meeting Room 3");
    expect(m.content).toContain("钱七");
    expect(m.hasEmbedding).toBe(true);

    // 联系人关联
    const row = await prisma.$queryRaw<Array<{ cid: string | null }>>`
      SELECT contact_id AS cid FROM memories WHERE id = ${m.id}
    `;
    expect(row[0].cid).toBe(qian.id);
  }, 60_000);

  it("create_contact 成功 → Verified Memory（type=contact_update，内容含姓名/邮箱/电话）", async () => {
    const action = await makeAction("CREATE_CONTACT", {
      name: "孙八",
      email: "sunba@example.com",
      phone: "13900139000",
      organization: "某某科技",
    });
    await confirmAction(action.id);
    const result = await executeWithTools(action.id, { embeddingProvider: embedding });
    expect(result.ok).toBe(true);
    const res = result.response as { contactId: string };
    createdContacts.push(res.contactId);

    const mems = await memoriesOfAction(action.id);
    expect(mems.length).toBe(1);
    const m = mems[0];
    createdMemories.push(m.id);
    expect(m.source).toBe("tool_verified");
    expect(m.confidence).toBe(1.0);
    expect(m.type).toBe("contact_update");
    expect(m.content).toContain("孙八");
    expect(m.content).toContain("sunba@example.com");
    expect(m.content).toContain("13900139000");
  }, 60_000);

  it("update_contact 成功 → Verified Memory 记录新增邮箱；重复沉淀幂等跳过", async () => {
    const wang = await prisma.contact.create({
      data: {
        name: "王九",
        emails: { create: [{ email: "wangjiu@old.com", verified: true, active: true, source: "seed" }] },
      },
    });
    createdContacts.push(wang.id);

    const action = await makeAction("UPDATE_CONTACT", {
      contactId: wang.id,
      email: "wangjiu@new.com",
      organization: "新公司",
    });
    await confirmAction(action.id);
    const result = await executeWithTools(action.id, { embeddingProvider: embedding });
    expect(result.ok).toBe(true);

    const mems = await memoriesOfAction(action.id);
    expect(mems.length).toBe(1);
    const m = mems[0];
    createdMemories.push(m.id);
    expect(m.source).toBe("tool_verified");
    expect(m.confidence).toBe(1.0);
    expect(m.content).toContain("王九");
    expect(m.content).toContain("wangjiu@new.com");
    expect(m.content).toContain("新公司");

    // 幂等：同 contact+content 再次沉淀 → created=false，不重复
    const again = await createVerifiedMemory(
      {
        type: "contact_update",
        contactId: wang.id,
        content: m.content,
      },
      { embed: (c) => embedding.embed([c]).then(([v]) => v) },
    );
    expect(again.created).toBe(false);
    expect(again.memory.id).toBe(m.id);
  }, 60_000);

  it("工具失败 → 不生成 Verified Memory（失败路径零沉淀）", async () => {
    const action = await makeAction("UPDATE_CONTACT", {
      contact: { name: "绝不存在的某人" },
      email: "ghost@example.com",
    });
    await confirmAction(action.id);
    const result = await executeWithTools(action.id, { embeddingProvider: embedding });
    expect(result.ok).toBe(false);
    // 精确断言：该 Action 未沉淀任何记忆（不依赖全库计数，避免并行文件污染）
    const mems = await memoriesOfAction(action.id);
    expect(mems.length).toBe(0);
  }, 60_000);

  it("不变式：Model Inference ≠ Verified Memory（候选不可直接验证，工具链才产生 Verified）", async () => {
    const candidate = await createCandidateMemory({
      type: "fact",
      content: "模型推断的待确认记忆",
    });
    createdMemories.push(candidate.id);
    expect(candidate.source).toBe("model_inferred");
    expect(candidate.confidence).toBeLessThan(1.0);
    // 候选记忆不能直接走 verifyMemory（必须经用户确认）
    await expect(verifyMemory(candidate.id)).rejects.toBeInstanceOf(MemoryPipelineError);
    // Verified 的唯一来源是工具成功（source=tool_verified）
    const verified = await createVerifiedMemory({
      type: "fact",
      content: "只有工具成功才能沉淀 Verified 记忆",
    });
    createdMemories.push(verified.memory.id);
    cleaned.push(verified.memory.id);
    expect(verified.memory.source).toBe("tool_verified");
    expect(verified.memory.confidence).toBe(1.0);
  }, 60_000);
});
