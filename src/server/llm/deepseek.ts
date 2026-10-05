import type { z } from "zod";
import type { ChatInput, LLMProvider, StructuredInput } from "./types";
import { LLMError } from "./types";

export interface DeepSeekConfig {
  apiKey: string;
  /** 默认 https://api.deepseek.com */
  baseUrl?: string;
  /** 默认 deepseek-flash（V4.1 Flash，支持文本+图像+结构化输出） */
  model?: string;
  /** 默认 120s */
  timeoutMs?: number;
  /** 是否发送 response_format=json_object（DeepSeek 官方支持）；u2-flash 等部分 OpenAI 兼容端点不支持，需关闭，靠提示词约束 + Zod 重试兜底 */
  jsonMode?: boolean;
}

interface ChatCompletionResponse {
  choices?: Array<{ message?: { content?: unknown } }>;
}

/** DeepSeek Chat Completions（OpenAI 兼容）实现 */
export class DeepSeekProvider implements LLMProvider {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly timeoutMs: number;
  private readonly jsonMode: boolean;

  constructor(config: DeepSeekConfig) {
    if (!config.apiKey) {
      throw new LLMError("DEEPSEEK_API_KEY 未配置");
    }
    this.apiKey = config.apiKey;
    this.baseUrl = (config.baseUrl ?? "https://api.deepseek.com").replace(/\/+$/, "");
    this.model = config.model ?? "deepseek-flash";
    this.timeoutMs = config.timeoutMs ?? 120_000;
    this.jsonMode = config.jsonMode ?? true;
  }

  async chat(input: ChatInput): Promise<string> {
    const body = {
      model: this.model,
      messages: input.messages,
      temperature: input.temperature ?? 0.3,
      ...(input.maxTokens ? { max_tokens: input.maxTokens } : {}),
      stream: false,
    };
    const data = await this.post<ChatCompletionResponse>("/chat/completions", body);
    const text = data?.choices?.[0]?.message?.content;
    if (typeof text !== "string") {
      throw new LLMError("DeepSeek 返回内容缺失", data);
    }
    return text;
  }

  async structured<T>(input: StructuredInput<T>): Promise<T> {
    const messages = [
      {
        role: "system" as const,
        content:
          "你必须只输出一个合法的 JSON 对象，不要输出任何 JSON 之外的文字、解释或代码块标记。",
      },
      ...input.messages,
    ];
    const maxRetries = input.maxRetries ?? 1;
    let lastError: unknown;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const body = {
        model: this.model,
        messages,
        temperature: input.temperature ?? 0,
        ...(this.jsonMode ? { response_format: { type: "json_object" } } : {}),
        stream: false,
      };
      const data = await this.post<ChatCompletionResponse>("/chat/completions", body);
      const raw = data?.choices?.[0]?.message?.content;
      if (typeof raw !== "string") {
        throw new LLMError("DeepSeek 返回内容缺失", data);
      }
      try {
        const json = JSON.parse(this.stripCodeFence(raw));
        return input.schema.parse(json);
      } catch (err) {
        lastError = err;
        if (attempt < maxRetries) {
          messages.push({ role: "assistant", content: raw });
          messages.push({
            role: "user",
            content:
              `你上一步的输出未通过 JSON Schema 校验：${err instanceof Error ? err.message : String(err)}。` +
              `注意枚举取值：intent∈{CREATE_MEETING,CREATE_CONTACT,UPDATE_CONTACT,UNKNOWN}；` +
              `field∈{email,phone,organization,role}；missing∈{time,location,contact}。` +
              `无法确定的字段必须为 null（不是空字符串）。请只输出一个符合要求的 JSON 对象。`,
          });
        }
      }
    }
    throw new LLMError("结构化输出多次校验失败", lastError);
  }

  /** 去除模型偶发的 ```json ... ``` 包裹 */
  private stripCodeFence(raw: string): string {
    const t = raw.trim();
    const m = t.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
    return m ? m[1] : t;
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(`${this.baseUrl}${path}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        throw new LLMError(`DeepSeek API ${res.status}: ${detail.slice(0, 300)}`);
      }
      return (await res.json()) as T;
    } catch (err) {
      if (err instanceof LLMError) throw err;
      throw new LLMError(
        `DeepSeek 请求失败: ${err instanceof Error ? err.message : String(err)}`,
        err,
      );
    } finally {
      clearTimeout(timer);
    }
  }
}

export function createDeepSeekProvider(
  env: NodeJS.ProcessEnv = process.env,
): DeepSeekProvider {
  return new DeepSeekProvider({
    apiKey: env.DEEPSEEK_API_KEY ?? "",
    baseUrl: env.DEEPSEEK_BASE_URL,
    model: env.DEEPSEEK_MODEL,
    jsonMode: env.DEEPSEEK_JSON_MODE !== "false",
  });
}
