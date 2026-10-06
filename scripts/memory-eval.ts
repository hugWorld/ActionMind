/**
 * 记忆检索评测（Task 25 增补）：
 * 在 seed:demo 的大规模数据（100 联系人 / 300 任务 / 350+ 记忆，含同主题干扰）上，
 * 用带标注的查询集评估 Hybrid 检索（BM25 + Embedding + RRF）的区分度：
 *   - Recall@1 / Recall@5 / MRR（@1 < 100% 说明同主题干扰下有真实区分度）
 *   - rrfK=2（小语料参数） vs rrfK=60（大规模语料建议参数）对比
 * 运行：bash -c 'set -a; source .env; set +a; npx tsx scripts/memory-eval.ts'
 */
import "dotenv/config";
import { prisma } from "../src/server/db";
import { createEmbeddingProvider } from "../src/server/embedding";
import { createHybridSearcher } from "../src/server/search/hybrid";

interface QueryCase {
  q: string;
  exp: string; // 命中判定：top5 任一 content 包含该子串
  tag: "exact" | "semantic" | "noise" | "contact";
}

async function main() {
  const provider = createEmbeddingProvider();
  const searcher = await createHybridSearcher(provider);

  // 静态锚点查询（子串判定，对生成器稳健；仅查 memories 表内确实存在的内容）
  const staticQueries: QueryCase[] = [
    { q: "上周和张三碰头聊了什么", exp: "毕业论文", tag: "semantic" },
    { q: "和张三打过羽毛球", exp: "羽毛球", tag: "exact" },
    { q: "王老师什么时候有空", exp: "王老师", tag: "semantic" },
    { q: "和张三在星巴克开过会吗", exp: "星巴克", tag: "semantic" },
    { q: "论文相关的会", exp: "论文", tag: "semantic" },
    { q: "健身安排", exp: "健身", tag: "noise" },
    { q: "医院复查的预约", exp: "复查", tag: "noise" },
    { q: "宽带续费的事", exp: "宽带", tag: "noise" },
    { q: "组会前要准备什么", exp: "组会", tag: "noise" },
    { q: "报销流程相关的事", exp: "报销", tag: "noise" },
  ];
  // 动态联系人查询：8 个生成联系人 × 2（会议主题 / 习惯）
  const contacts = await prisma.contact.findMany({ select: { id: true, name: true } });
  const dynamicQueries: QueryCase[] = contacts
    .filter((c) => !["张三", "李四", "王老师"].includes(c.name))
    .slice(0, 8)
    .flatMap((c) => [
      { q: `和${c.name}开会聊了什么`, exp: c.name, tag: "contact" },
      { q: `${c.name}有什么习惯`, exp: c.name, tag: "contact" },
    ]);

  const all = [...staticQueries, ...dynamicQueries];

  const runFor = async (rrfK: number) => {
    let hit1 = 0, hit5 = 0;
    let mrrSum = 0;
    const rows: Array<{ rrfK: number; tag: string; q: string; top1: string; hit1: boolean; hit5: boolean; rr: number }> = [];
    for (const { q, exp, tag } of all) {
      const res = await searcher.search(q, { k: 5, rrfK });
      const hitIdx = res.findIndex((h) => h.content.includes(exp));
      const h1 = hitIdx === 0;
      const h5 = hitIdx >= 0;
      const rr = h5 ? 1 / (hitIdx + 1) : 0;
      if (h1) hit1++;
      if (h5) hit5++;
      mrrSum += rr;
      rows.push({ rrfK, tag, q, top1: res[0]?.content.slice(0, 30) ?? "(空)", hit1: h1, hit5: h5, rr });
    }
    return { n: all.length, hit1, hit5, mrr: mrrSum / all.length, rows };
  };

  const r2 = await runFor(2);
  const r60 = await runFor(60);
  const r20 = await runFor(20);

  const fmt = (r: { n: number; hit1: number; hit5: number; mrr: number }) =>
    `Recall@1=${(r.hit1 / r.n).toFixed(2)} Recall@5=${(r.hit5 / r.n).toFixed(2)} MRR=${r.mrr.toFixed(3)} (n=${r.n})`;

  console.log("===== 记忆检索评测（seed:demo 大规模数据） =====");
  console.log(`[rrfK=2 ] ${fmt(r2)}`);
  console.log(`[rrfK=20] ${fmt(r20)}`);
  console.log(`[rrfK=60] ${fmt(r60)}`);
  console.log("\n===== 逐查询（rrfK=60，命中与否） =====");
  for (const row of r60.rows) {
    console.log(`${row.hit5 ? "✓" : "✗"} [${row.tag}] "${row.q}" → top1:${row.top1}${row.hit5 ? "" : "（未命中）"}`);
  }
  // 未命中清单（rrfK=2 与 60 差异）
  const miss2 = r2.rows.filter((x) => !x.hit5).map((x) => x.q);
  const miss60 = r60.rows.filter((x) => !x.hit5).map((x) => x.q);
  console.log(`\n[rrfK=2 未命中] ${miss2.length} 条：${miss2.join("；")}`);
  console.log(`[rrfK=60 未命中] ${miss60.length} 条：${miss60.join("；")}`);

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error("EVAL_FAIL", e);
  process.exit(1);
});
