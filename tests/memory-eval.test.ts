import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../src/server/db";
import { createEmbeddingProvider, type EmbeddingProvider } from "../src/server/embedding";
import { ensureEmbedServer } from "./helpers/ensure-embed";
import { createHybridSearcher } from "../src/server/search/hybrid";

// Task 25 增补 — 记忆检索评测（需先 npm run seed:demo；数据不足时整组跳过，不影响全量回归）
// 数据规模（100 联系人 / 300 任务 / 350+ 记忆，含同主题干扰）下：
//   - Recall@5 应保持高（≥0.85）且 MRR ≥ 0.75 → 大规模语料下检索仍然可靠
//   - Recall@1 < 1.0 → 同主题干扰下存在真实区分度（数据太少时指标虚高为 100%，无意义）
describe("Task 25 增补: 记忆检索评测（seed:demo 大规模数据）", () => {
  let embedding: EmbeddingProvider;
  let enoughData = false;

  // 与 scripts/memory-eval.ts 一致的标注查询集（子串命中判定；仅查 memories 内确实存在的内容）
  const QUERIES: Array<{ q: string; exp: string }> = [
    { q: "上周和张三碰头聊了什么", exp: "毕业论文" },
    { q: "和张三打过羽毛球", exp: "羽毛球" },
    { q: "王老师什么时候有空", exp: "王老师" },
    { q: "和张三在星巴克开过会吗", exp: "星巴克" },
    { q: "论文相关的会", exp: "论文" },
    { q: "健身安排", exp: "健身" },
    { q: "医院复查的预约", exp: "复查" },
    { q: "宽带续费的事", exp: "宽带" },
    { q: "组会前要准备什么", exp: "组会" },
    { q: "报销流程相关的事", exp: "报销" },
  ];

  beforeAll(async () => {
    await ensureEmbedServer();
    embedding = createEmbeddingProvider();
    const [c, t, m] = await Promise.all([
      prisma.contact.count(),
      prisma.meeting.count(),
      prisma.memory.count(),
    ]);
    enoughData = c >= 100 && t >= 250 && m >= 300;
  }, 120_000);

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("seed 规模达标：联系人≥100 / 任务≥250 / 记忆≥300", ({ skip }) => {
    if (!enoughData) skip("数据不足，请先运行 npm run seed:demo");
    expect(enoughData).toBe(true);
  });

  it("混合查询（精确/语义/噪声）在 350+ 记忆上 Recall@5≥0.85、MRR≥0.75", async ({ skip }) => {
    if (!enoughData) skip("数据不足，请先运行 npm run seed:demo");
    const searcher = await createHybridSearcher(embedding);
    let hit5 = 0;
    let mrrSum = 0;
    for (const { q, exp } of QUERIES) {
      const res = await searcher.search(q, { k: 5 });
      const idx = res.findIndex((h) => h.content.includes(exp));
      if (idx >= 0) {
        hit5 += 1;
        mrrSum += 1 / (idx + 1);
      }
    }
    const recall5 = hit5 / QUERIES.length;
    const mrr = mrrSum / QUERIES.length;
    console.log(`[memory-eval] n=${QUERIES.length} Recall@5=${recall5.toFixed(3)} MRR=${mrr.toFixed(3)}`);
    expect(recall5).toBeGreaterThanOrEqual(0.85);
    expect(mrr).toBeGreaterThanOrEqual(0.75);
  });

  it("区分度：Recall@1 < 1.0（同主题干扰下非全命中，避免数据过少导致的指标虚高）", async ({ skip }) => {
    if (!enoughData) skip("数据不足，请先运行 npm run seed:demo");
    const searcher = await createHybridSearcher(embedding);
    let hit1 = 0;
    for (const { q, exp } of QUERIES) {
      const res = await searcher.search(q, { k: 1 });
      if (res.length > 0 && res[0].content.includes(exp)) hit1 += 1;
    }
    const recall1 = hit1 / QUERIES.length;
    console.log(`[memory-eval] Recall@1=${recall1.toFixed(3)}`);
    expect(recall1).toBeLessThan(1.0);
    expect(recall1).toBeGreaterThanOrEqual(0.7);
  });
});
