import type { EmbeddingProvider } from "./provider";

interface EmbedResponse {
  ok: boolean;
  vectors?: number[][];
  dimensions?: number;
  model?: string;
  error?: string;
}

/** 调用本地 Python embedding 服务（scripts/embed_server.py） */
export class HttpEmbeddingProvider implements EmbeddingProvider {
  readonly model: string;
  readonly dimensions: number;
  constructor(
    private readonly baseUrl: string,
    private readonly timeoutMs = 60_000,
  ) {
    this.model = "BAAI/bge-small-zh-v1.5";
    this.dimensions = 512;
  }

  async embed(texts: string[]): Promise<number[][]> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(`${this.baseUrl}/embed`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ texts }),
        signal: controller.signal,
      });
      const body = (await res.json()) as EmbedResponse;
      if (!res.ok || !body.ok || !body.vectors) {
        throw new Error(`embedding 服务错误: ${body.error ?? res.status}`);
      }
      if (body.vectors.length !== texts.length) {
        throw new Error(`embedding 返回数量不符: ${body.vectors.length} != ${texts.length}`);
      }
      return body.vectors;
    } finally {
      clearTimeout(timer);
    }
  }
}

export function createEmbeddingProvider(
  env: NodeJS.ProcessEnv = process.env,
): HttpEmbeddingProvider {
  return new HttpEmbeddingProvider(
    env.EMBEDDING_URL ?? "http://127.0.0.1:8765",
  );
}
