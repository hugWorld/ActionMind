/** 检索评估指标（Task 8 / Gate 8）：Recall@K 与 MRR@K */

/** 命中相关文档占比：|relevant ∩ topK| / |relevant| */
export function recallAtK(
  predictedIds: string[],
  relevantIds: string[],
  k: number,
): number {
  if (relevantIds.length === 0) return 0;
  const topK = new Set(predictedIds.slice(0, k));
  return relevantIds.filter((r) => topK.has(r)).length / relevantIds.length;
}

/** 第一个相关文档的倒数排名；Top-K 内无命中为 0 */
export function mrrAtK(
  predictedIds: string[],
  relevantIds: string[],
  k: number,
): number {
  const topK = predictedIds.slice(0, k);
  for (let i = 0; i < topK.length; i++) {
    if (relevantIds.includes(topK[i])) return 1 / (i + 1);
  }
  return 0;
}

export interface RetrievalEvalResult {
  name: string;
  recallAtK: number;
  mrrAtK: number;
}

export interface RetrievalEvalCase {
  query: string;
  relevantIds: string[];
}

/**
 * 对一组查询评估某个检索器：返回平均 Recall@K 与平均 MRR@K。
 * retrieve: (query) => Promise<string[]>（按相关度降序的 memory id 列表）
 */
export async function evaluateRetriever(
  name: string,
  retrieve: (query: string) => Promise<string[]>,
  cases: RetrievalEvalCase[],
  k: number,
): Promise<RetrievalEvalResult> {
  let recallSum = 0;
  let mrrSum = 0;
  for (const c of cases) {
    const predicted = await retrieve(c.query);
    recallSum += recallAtK(predicted, c.relevantIds, k);
    mrrSum += mrrAtK(predicted, c.relevantIds, k);
  }
  const n = cases.length;
  return {
    name,
    recallAtK: Number((recallSum / n).toFixed(4)),
    mrrAtK: Number((mrrSum / n).toFixed(4)),
  };
}
