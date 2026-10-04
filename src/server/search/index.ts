import { prisma } from "../db";
import {
  buildBm25Index,
  searchBm25,
  tokenize,
  type Bm25Hit,
  type Bm25SearchOptions,
} from "./bm25";

export * from "./bm25";

/** 便捷入口：从数据库加载全部记忆 → 构建索引 → BM25 检索 */
export async function keywordSearchMemories(
  query: string,
  options: Bm25SearchOptions = {},
): Promise<Bm25Hit[]> {
  const memories = await prisma.memory.findMany({
    where: { content: { not: "" } },
    select: { id: true, content: true },
  });
  const index = buildBm25Index(memories.map((m) => ({ id: m.id, content: m.content })));
  return searchBm25(index, query, options);
}

export { tokenize };
