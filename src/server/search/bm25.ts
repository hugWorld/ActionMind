/**
 * BM25 关键词检索（Task 7 / Gate 7）
 * 纯 TS 实现，无外部依赖。
 * 分词：中文按单字 + 双字 bigram（无词典基线），拉丁/数字按连续串。
 * 打分：BM25(k1=1.5, b=0.75)，idf = ln(1 + (N - df + 0.5)/(df + 0.5))。
 */

const CJK = /[\u4e00-\u9fff\u3400-\u4dbf]/;
const LATIN = /[a-z0-9]/;

/** 分词：CJK 输出单字+bigram，拉丁/数字输出连续 token */
export function tokenize(text: string): string[] {
  const tokens: string[] = [];
  let prevCjk = "";
  let latin = "";
  for (const ch of text.toLowerCase()) {
    if (CJK.test(ch)) {
      if (latin) {
        tokens.push(latin);
        latin = "";
      }
      tokens.push(ch); // 单字
      if (prevCjk) tokens.push(prevCjk + ch); // bigram
      prevCjk = ch;
    } else if (LATIN.test(ch)) {
      prevCjk = "";
      latin += ch;
    } else {
      if (latin) {
        tokens.push(latin);
        latin = "";
      }
      prevCjk = "";
    }
  }
  if (latin) tokens.push(latin);
  return tokens;
}

export interface IndexedDoc {
  id: string;
  content: string;
  tokens: string[];
  length: number;
}

export interface Bm25Index {
  docs: IndexedDoc[];
  /** token -> 出现该 token 的文档数 */
  df: Map<string, number>;
  avgdl: number;
  n: number;
}

export interface Bm25Hit {
  memoryId: string;
  content: string;
  score: number;
}

/** 从记忆构建关键词索引 */
export function buildBm25Index(
  docs: Array<{ id: string; content: string }>,
): Bm25Index {
  const indexed: IndexedDoc[] = docs.map((d) => {
    const tokens = tokenize(d.content);
    return { id: d.id, content: d.content, tokens, length: tokens.length };
  });
  const df = new Map<string, number>();
  for (const doc of indexed) {
    for (const t of new Set(doc.tokens)) {
      df.set(t, (df.get(t) ?? 0) + 1);
    }
  }
  const n = indexed.length;
  const avgdl =
    n === 0 ? 0 : indexed.reduce((s, d) => s + d.length, 0) / n;
  return { docs: indexed, df, avgdl, n };
}

export interface Bm25SearchOptions {
  k?: number;
  /** 返回 score > minScore 的结果（默认 0：只返回至少命中一个 query token 的文档） */
  minScore?: number;
  k1?: number;
  b?: number;
}

export function searchBm25(
  index: Bm25Index,
  query: string,
  options: Bm25SearchOptions = {},
): Bm25Hit[] {
  if (index.n === 0) return [];
  const k = options.k ?? 5;
  const minScore = options.minScore ?? 0;
  const k1 = options.k1 ?? 1.5;
  const b = options.b ?? 0.75;

  const queryTokens = [...new Set(tokenize(query))];
  if (queryTokens.length === 0) return [];

  const scores: Array<{ doc: IndexedDoc; score: number }> = [];
  for (const doc of index.docs) {
    const tf = new Map<string, number>();
    for (const t of doc.tokens) tf.set(t, (tf.get(t) ?? 0) + 1);
    let score = 0;
    for (const t of queryTokens) {
      const f = tf.get(t);
      if (!f) continue;
      const df = index.df.get(t) ?? 0;
      const idf = Math.log(1 + (index.n - df + 0.5) / (df + 0.5));
      const denom = f + k1 * (1 - b + b * (doc.length / index.avgdl));
      score += idf * ((f * (k1 + 1)) / denom);
    }
    if (score > minScore) scores.push({ doc, score });
  }

  scores.sort((a, b) => b.score - a.score);
  return scores.slice(0, k).map((s) => ({
    memoryId: s.doc.id,
    content: s.doc.content,
    score: Number(s.score.toFixed(6)),
  }));
}
