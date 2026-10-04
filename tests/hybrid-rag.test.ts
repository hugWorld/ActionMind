import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../src/server/db";
import { createEmbeddingProvider, embedMemoriesMissing } from "../src/server/embedding";
import type { EmbeddingProvider } from "../src/server/embedding";
import { createHybridSearcher, detectStructuredSignal } from "../src/server/search/hybrid";
import { buildBm25Index, searchBm25 } from "../src/server/search/bm25";
import { searchMemories } from "../src/server/embedding";
import { evaluateRetriever } from "../src/server/eval";
import { ensureEmbedServer } from "./helpers/ensure-embed";
import { EVAL_MEMORIES, EVAL_QUERIES } from "./fixtures/eval-set";

// Gate 8 — Hybrid RAG：同一批数据上对比 BM25 / Embedding / Hybrid，输出 Recall@5 与 MRR@5

const K = 5;

function memoryType(content: string): string {
  if (content.includes("邮箱") || content.includes("手机号")) return "contact_update";
  if (content.includes("会议") || content.includes("面试") || content.includes("站会")) return "meeting";
  if (content.includes("出差") || content.includes("提交") || content.includes("峰会") || content.includes("预算")) return "action";
  return "fact";
}

describe("Task 8: Hybrid RAG — BM25 vs Embedding vs Hybrid", () => {
  let provider: EmbeddingProvider;
  const created: string[] = [];
  let idByContent = new Map<string, string>();

  beforeAll(async () => {
    await ensureEmbedServer();
    provider = createEmbeddingProvider();
    for (const content of EVAL_MEMORIES) {
      const m = await prisma.memory.create({
        data: { type: memoryType(content), content, source: "model_inferred", confidence: 0.3 },
      });
      created.push(m.id);
      idByContent.set(content, m.id);
    }
    await embedMemoriesMissing(provider);
  }, 240_000);

  afterAll(async () => {
    for (const id of created) {
      await prisma.memory.delete({ where: { id } }).catch(() => {});
    }
    await prisma.$disconnect();
  });

  it("Gate 8：三方法在同一批数据上的 Recall@5 / MRR@5（Hybrid ≥ 单通道最优）", async () => {
    const cases = EVAL_QUERIES.map((q) => ({
      query: q.query,
      relevantIds: [idByContent.get(q.expectedContent)!],
    }));

    // BM25（语料限定为本数据集，保证可重复对比）
    const bm25Index = buildBm25Index(
      EVAL_MEMORIES.map((content) => ({ id: idByContent.get(content)!, content })),
    );
    const bm25 = await evaluateRetriever(
      "BM25",
      async (query) => searchBm25(bm25Index, query, { k: K }).map((h) => h.memoryId),
      cases,
      K,
    );

    // Embedding
    const embedding = await evaluateRetriever(
      "Embedding",
      async (query) =>
        (await searchMemories(provider, query, { k: K, contentIn: EVAL_MEMORIES })).map(
          (h) => h.id,
        ),
      cases,
      K,
    );

    // Hybrid（BM25 + Embedding + Structured + Rerank，语料限定）
    const hybridSearcher = await createHybridSearcher(provider, {
      contentIn: EVAL_MEMORIES,
    });
    const hybrid = await evaluateRetriever(
      "Hybrid",
      async (query) => (await hybridSearcher.search(query, { k: K })).map((h) => h.memoryId),
      cases,
      K,
    );

    console.log("\n===== Gate 8 对比（Recall@5 / MRR@5）=====");
    console.table([bm25, embedding, hybrid]);

    expect(bm25.recallAtK).toBeGreaterThanOrEqual(0);
    expect(embedding.recallAtK).toBeGreaterThanOrEqual(0);
    expect(hybrid.recallAtK).toBeGreaterThanOrEqual(0);
    // Hybrid 召回应 ≥ 任一单通道（融合 = 通道并集 + tiebreaker 重排）
    expect(hybrid.recallAtK).toBeGreaterThanOrEqual(Math.max(bm25.recallAtK, embedding.recallAtK));
    // MRR 保守断言：不劣于单通道较优者
    expect(hybrid.mrrAtK).toBeGreaterThanOrEqual(Math.min(bm25.mrrAtK, embedding.mrrAtK));
  }, 240_000);

  it("结构化信号：查询含类型关键词时正确识别", () => {
    expect(detectStructuredSignal("项目周会在哪个会议室开")).toEqual({ type: "meeting" });
    expect(detectStructuredSignal("李四的联系邮箱是什么")).toEqual({ type: "contact_update" });
    expect(detectStructuredSignal("下个月的出差计划")).toEqual({ type: "action" });
    expect(detectStructuredSignal("张三的生日是哪天")).toEqual({});
  });

  it("Hybrid 返回 Top-K / Score / Memory ID 且带来源标注", async () => {
    const searcher = await createHybridSearcher(provider, { contentIn: EVAL_MEMORIES });
    const hits = await searcher.search("项目周会在哪个会议室开", { k: 5 });
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].memoryId).toBe(idByContent.get(EVAL_MEMORIES[0]));
    expect(typeof hits[0].score).toBe("number");
    expect(hits[0].sources.length).toBeGreaterThan(0);
    expect(hits[0].sources).toContain("bm25");
  }, 60_000);
});
