import type { z } from "zod";

export type ChatRole = "system" | "user" | "assistant";

export interface TextContentPart {
  type: "text";
  text: string;
}

export interface ImageContentPart {
  type: "image_url";
  image_url: {
    url: string; // http(s) URL 或 base64 data URL（data:image/jpeg;base64,...）
    detail?: "low" | "high" | "auto";
  };
}

export type ContentPart = TextContentPart | ImageContentPart;

export interface ChatMessage {
  role: ChatRole;
  content: string | ContentPart[];
}

export interface ChatInput {
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
}

export interface StructuredInput<T> {
  messages: ChatMessage[];
  schema: z.ZodType<T>;
  temperature?: number;
  maxRetries?: number;
}

/**
 * LLM Provider 抽象：
 *  - chat: 自由文本补全
 *  - structured: JSON 结构化输出（Zod 校验，失败自动重试）
 * 多模态（图片）通过 ChatMessage.content 中的 image_url 内容块表达。
 */
export interface LLMProvider {
  chat(input: ChatInput): Promise<string>;
  structured<T>(input: StructuredInput<T>): Promise<T>;
}

export class LLMError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "LLMError";
  }
}
