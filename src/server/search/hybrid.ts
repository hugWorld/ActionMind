import { prisma } from "../db";
import type { EmbeddingProvider } from "../embedding";
import { searchMemories } from "../embedding";
import { buildBm25Index, searchBm25 } from "./bm25";

// ---------- 结构化信号（Task 8：Structured Retrieval 组件） ----------

const TYPE_KEYWORDS: Record<string, string[]> = {
  meeting: ["会议", "面试", "站会", "开会"],
  contact_update: ["邮箱", "电话", "手机号"],
  action: ["出差", "提交", "峰会", "预算"],
};

/** 从查询中检测结构化信号（记忆类型），命中则用于 Hybrid 加权 */
export function detectStructuredSignal(query: string): { type?: string } {
  for (const [type, words] of Object.entries(TYPE_KEYWORDS)) {
    if (words.some((w) => query.includes(w))) return { type };
  }
  return {};
}

// ---------- Hybrid 检索（BM25 + Embedding + Structured + Rerank） ----------

export interface HybridHit {
  memoryId: string;
  content: string;
  score: number;
  /** 该记忆被哪些通道召回 */
  sources: Array<"bm25" | "embedding">;
}

export interface HybridSearchOptions {
  k?: number;
  /** 每个通道取多少候选参与融合 */
  fusionTopK?: number;
  /**
   * RRF 常数。MVP 语料小（<100 条），取 2 让 rank 差异显著；
   * 大规模语料建议回到 60 以避免排名压平。
   */
  rrfK?: number;
  /** 双通道一致命中的加分（rerank 信号，tiebreaker 量级） */
  crossBonus?: number;
  /** 结构化类型命中的加权（tiebreaker 量级，不得主导 rank 差异） */
  structuredBoost?: number;
}

export interface HybridSearcher {
  search(query: string, options?: HybridSearchOptions): Promise<HybridHit[]>;
}

export interface HybridSearcherOptions {
  /** 限定语料（评估用）；不传则使用全部记忆 */
  contentIn?: string[];
}

/**
 * 构建 Hybrid 检索器：
 * 1) BM25 Top-N  2) Embedding Top-N  3) 结构化信号检测
 * 4) RRF 融合 + 双通道一致加分 + 结构化加权 → 重排取 Top-K
 */
export async function createHybridSearcher(
  provider: EmbeddingProvider,
  searcherOptions: HybridSearcherOptions = {},
): Promise<HybridSearcher> {
  const where =
    searcherOptions.contentIn && searcherOptions.contentIn.length > 0
      ? { content: { in: searcherOptions.contentIn } }
      : { content: { not: "" } };
  const memories = await prisma.memory.findMany({
    where,
    select: { id: true, content: true, type: true },
  });
  const index = buildBm25Index(
    memories.map((m) => ({ id: m.id, content: m.content })),
  );
  const byId = new Map(memories.map((m) => [m.id, m]));

  return {
    async search(query, options = {}) {
      const k = options.k ?? 5;
      const fusionTopK = options.fusionTopK ?? 20;
      const rrfK = options.rrfK ?? 2;
      const crossBonus = options.crossBonus ?? 0.05;
      const structuredBoost = options.structuredBoost ?? 0.03;

      const bm25Hits = searchBm25(index, query, { k: fusionTopK });
      const embedHits = await searchMemories(provider, query, {
        k: fusionTopK,
        contentIn: searcherOptions.contentIn,
      });
      const bm25Rank = new Map(bm25Hits.map((h, i) => [h.memoryId, i + 1]));
      const embedRank = new Map(embedHits.map((h, i) => [h.id, i + 1]));
      const ids = new Set([...bm25Rank.keys(), ...embedRank.keys()]);
      const signal = detectStructuredSignal(query);

      const scored: Array<{
        id: string;
        score: number;
        sources: HybridHit["sources"];
      }> = [];
      for (const id of ids) {
        let score = 0;
        const sources: HybridHit["sources"] = [];
        const br = bm25Rank.get(id);
        if (br) {
          score += 1 / (rrfK + br);
          sources.push("bm25");
        }
        const er = embedRank.get(id);
        if (er) {
          score += 1 / (rrfK + er);
          sources.push("embedding");
        }
        if (br && er) score += crossBonus; // 双通道一致 → 更可信
        const mem = byId.get(id);
        if (mem && signal.type && mem.type === signal.type) {
          score += structuredBoost;
        }
        scored.push({ id, score, sources });
      }
      scored.sort((a, b) => b.score - a.score);
      return scored.slice(0, k).map((s) => ({
        memoryId: s.id,
        content: byId.get(s.id)?.content ?? "",
        score: Number(s.score.toFixed(6)),
        sources: s.sources,
      }));
    },
  };
}
