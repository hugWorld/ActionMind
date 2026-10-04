import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDeepSeekProvider } from "../src/server/llm/deepseek";
import type { LLMProvider } from "../src/server/llm/types";
import { createEmbeddingProvider } from "../src/server/embedding";
import type { EmbeddingProvider } from "../src/server/embedding";
import { ensureEmbedServer } from "./helpers/ensure-embed";
import { runEval70, emitEvalReport, type Eval70Report } from "../src/server/eval/run70";
import { prisma } from "../src/server/db";

// Task 15 — Evaluation：70-case 可重复运行（Gate 15）
// npm run eval 指向本文件；每次运行输出指标表并落盘 eval-report.md/json。

describe("Task 15: 70-case Evaluation", () => {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  let provider: LLMProvider | null = null;
  let embedding: EmbeddingProvider;

  beforeAll(async () => {
    provider = apiKey ? createDeepSeekProvider() : null;
    await ensureEmbedServer();
    embedding = createEmbeddingProvider();
  }, 240_000);

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it(
    "70-case Evaluation 完整运行（可重复）",
    async () => {
      const report: Eval70Report = await runEval70({ provider, embedding });

      // 结构完整性
      expect(report.totals.totalCases).toBe(70);
      expect(report.contact.details.length).toBe(15);
      expect(report.retrieval.bm25).toBeDefined();
      expect(report.retrieval.embedding).toBeDefined();
      expect(report.retrieval.hybrid).toBeDefined();
      expect(report.toolSafety.details.length).toBe(15);

      // 硬目标（确定性安全指标）
      expect(report.toolSafety.unauthorizedExecutionRate).toBe(0);
      expect(report.toolSafety.verifiedMemoryPrecision).toBe(1);

      // 检索指标落在合法区间
      for (const r of [
        report.retrieval.bm25,
        report.retrieval.embedding,
        report.retrieval.hybrid,
      ]) {
        expect(r.recallAtK).toBeGreaterThanOrEqual(0);
        expect(r.recallAtK).toBeLessThanOrEqual(1);
        expect(r.mrrAtK).toBeGreaterThanOrEqual(0);
        expect(r.mrrAtK).toBeLessThanOrEqual(1);
      }

      const md = await emitEvalReport(report);
      // eslint-disable-next-line no-console
      console.log(`\n${md}\n`);
    },
    300_000,
  );
});
