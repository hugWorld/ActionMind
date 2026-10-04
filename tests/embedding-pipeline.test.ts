import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import { prisma } from "../src/server/db";
import { createEmbeddingProvider, embedMemoriesMissing, searchMemories } from "../src/server/embedding";
import type { EmbeddingProvider } from "../src/server/embedding";
import { ensureEmbedServer } from "./helpers/ensure-embed";
import { EVAL_MEMORIES, EVAL_QUERIES } from "./fixtures/eval-set";

// Gate 6 — Embedding Pipeline（本地 CPU：fastembed + bge-small-zh-v1.5 → pgvector）
// 至少 20 条记忆、10 个查询，能够完成 Vector Search。（数据与 Gate 8 共用同一批）

function memoryType(content: string): string {
  if (content.includes("邮箱") || content.includes("手机号")) return "contact_update";
  if (content.includes("会议") || content.includes("面试") || content.includes("站会")) return "meeting";
  if (content.includes("出差") || content.includes("提交") || content.includes("峰会") || content.includes("预算")) return "action";
  return "fact";
}

describe("Task 6: Embedding Pipeline（Vector Search）", () => {
  let provider: EmbeddingProvider;
  const created: string[] = [];
  let idByContent = new Map<string, string>();

  beforeAll(async () => {
    await ensureEmbedServer();
    provider = createEmbeddingProvider();
    for (const content of EVAL_MEMORIES) {
      const m = await prisma.memory.create({
        data: {
          type: memoryType(content),
          content,
          source: "model_inferred",
          confidence: 0.3,
        },
      });
      created.push(m.id);
      idByContent.set(content, m.id);
    }
  }, 180_000);

  afterAll(async () => {
    for (const id of created) {
      await prisma.memory.delete({ where: { id } }).catch(() => {});
    }
    await prisma.$disconnect();
  });

  it("写入 20 条记忆并全部生成 embedding", async () => {
    // 记忆已在 beforeAll 创建；这里只为它们补 embedding 并做精确断言
    const n = await embedMemoriesMissing(provider);
    // 并行测试文件（hybrid-rag）也会触发全量 backfill，故只断言下限
    expect(n).toBeGreaterThanOrEqual(EVAL_MEMORIES.length);
    // 精确断言：本测试写入的记忆全部已有 embedding
    const rows = await prisma.$queryRaw<Array<{ c: number }>>`
      SELECT count(*)::int AS c FROM memories
      WHERE id IN (${Prisma.join(created)}) AND embedding IS NOT NULL
    `;
    expect(Number(rows[0].c)).toBe(EVAL_MEMORIES.length);
  }, 60_000);

  it("10 个查询均可完成 Vector Search 且 Top-5 命中预期记忆", async () => {
    for (const { query, expectedContent } of EVAL_QUERIES) {
      // contentIn 限定本数据集语料，避免并行测试文件（agent-runtime）的记忆污染检索
      const hits = await searchMemories(provider, query, { k: 5, contentIn: EVAL_MEMORIES });
      expect(hits.length).toBeGreaterThan(0);
      expect(hits[0].similarity).toBeGreaterThan(-1);
      expect(hits[0].similarity).toBeLessThanOrEqual(1);
      // 用本测试创建的 id 精确定位，避免与其他测试文件同 content 记忆歧义
      const expectedId = idByContent.get(expectedContent);
      expect(expectedId).toBeTruthy();
      const rank = hits.findIndex((h) => h.id === expectedId!);
      expect(rank, `查询「${query}」应命中「${expectedContent}」`).toBeGreaterThanOrEqual(0);
      expect(rank, `查询「${query}」命中排名过高`).toBeLessThan(5);
    }
  }, 120_000);
});
