/** EmbeddingProvider 抽象（Task 6）：文本 → 稠密向量 */
export interface EmbeddingProvider {
  readonly model: string;
  readonly dimensions: number;
  embed(texts: string[]): Promise<number[][]>;
}

export async function embedOne(
  provider: EmbeddingProvider,
  text: string,
): Promise<number[]> {
  const [vec] = await provider.embed([text]);
  return vec;
}

/** 把向量转成 pgvector 字面量（如 "[0.1,0.2,...]"），用于 ::vector 参数 */
export function toPgVector(vec: number[]): string {
  return `[${vec.join(",")}]`;
}
