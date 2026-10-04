import { Prisma } from "@prisma/client";
import { prisma } from "../db";
import type { EmbeddingProvider } from "./provider";
import { toPgVector } from "./provider";

// ---------- 写入 ----------

/** 为单条记忆生成 embedding 并写入 pgvector 列 */
export async function embedMemory(
  memoryId: string,
  provider: EmbeddingProvider,
): Promise<void> {
  const memory = await prisma.memory.findUniqueOrThrow({ where: { id: memoryId } });
  const [vec] = await provider.embed([memory.content]);
  await prisma.$executeRaw`
    UPDATE memories SET embedding = ${toPgVector(vec)}::vector WHERE id = ${memoryId}
  `;
}

/** 批量：为所有尚未有 embedding 的记忆生成向量（memory.embedding IS NULL） */
export async function embedMemoriesMissing(
  provider: EmbeddingProvider,
  limit = 200,
): Promise<number> {
  const rows = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM memories WHERE embedding IS NULL LIMIT ${limit}
  `;
  for (const row of rows) {
    await embedMemory(row.id, provider);
  }
  return rows.length;
}

// ---------- 查询 ----------

export interface VectorSearchHit {
  id: string;
  content: string;
  source: string;
  confidence: number;
  /** 余弦相似度（1 - 余弦距离），范围约 [-1, 1] */
  similarity: number;
}

/** 语义检索：query → embedding → pgvector 余弦距离排序取 Top-K */
export async function searchMemories(
  provider: EmbeddingProvider,
  query: string,
  options: { k?: number; minSimilarity?: number; contentIn?: string[] } = {},
): Promise<VectorSearchHit[]> {
  const k = options.k ?? 5;
  const contentFilter =
    options.contentIn && options.contentIn.length > 0
      ? Prisma.sql`AND content IN (${Prisma.join(options.contentIn)})`
      : Prisma.empty;
  const [vec] = await provider.embed([query]);
  const rows = await prisma.$queryRaw<
    Array<{
      id: string;
      content: string;
      source: string;
      confidence: number;
      similarity: number;
    }>
  >`
    SELECT
      id, content, source, confidence,
      1 - (embedding <=> ${toPgVector(vec)}::vector) AS similarity
    FROM memories
    WHERE embedding IS NOT NULL
    ${contentFilter}
    ORDER BY embedding <=> ${toPgVector(vec)}::vector
    LIMIT ${k}
  `;
  return rows
    .map((r) => ({ ...r, similarity: Number(r.similarity) }))
    .filter((r) => r.similarity >= (options.minSimilarity ?? 0));
}
