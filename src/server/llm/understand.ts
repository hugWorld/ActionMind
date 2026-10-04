import type { LLMProvider } from "./types";
import type { ChatUnderstanding } from "./schemas";
import { ChatUnderstandingSchema } from "./schemas";

export interface UnderstandInput {
  /** 聊天内容：截图 OCR 后的对话文本，或直接传入的聊天文字 */
  transcript?: string;
  /** 用户补充文字（可选） */
  userText?: string;
}

export interface ScreenshotInput {
  /** base64 data URL（data:image/jpeg;base64,...）或 http(s) 图片 URL */
  imageDataUrl: string;
  /** 用户补充文字（可选） */
  userText?: string;
}

const buildSystemPrompt = (now: Date): string => {
  const iso = now.toISOString();
  const cn = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "long",
    hour: "2-digit",
    minute: "2-digit",
  }).format(now);
  return `你是一个个人事务理解引擎，负责从聊天记录中提取可执行信息。

当前时间（Asia/Shanghai, UTC+8）：${cn}（ISO ${iso}）

规则：
1. intent 只能是 CREATE_MEETING / CREATE_CONTACT / UPDATE_CONTACT / UNKNOWN。
   - 无法确定任何行动意图时返回 UNKNOWN，且 meeting/contactUpdate 必须为 null，contacts 为空数组 []。
2. 提取聊天中出现的人物信息到 contacts（姓名/邮箱/电话/公司），没有的字段为 null。
   - 首次出现且提供其联系方式/公司等信息的人 → CREATE_CONTACT。
   - 对已知联系人变更联系方式（如"我换邮箱了""新号码是"）→ UPDATE_CONTACT。
3. 会议时间使用 ISO 8601 且带 +08:00 偏移（例如 2026-10-09T15:00:00+08:00）。
   - 相对时间（"周五""下周三""下午三点"）基于当前时间推算；推算不出来就是 null。
   - 千万不要编造时间。
4. 历史引用判定：当地点/安排指向历史上下文（含"上次""之前""老地方""老样子""上次那个地方""和以前一样"等词）时，needsMemory=true 且 location=null（即使原句带有地点字样也不要写入 location）。只有出现具体、明确的地点名词（如"星巴克""三楼会议室""公司楼下"）才填 location。
5. UPDATE_CONTACT 时填充 contactUpdate（contactName、field∈{email,phone,organization,role}、newValue）；否则为 null。
6. missing 只能取 "time" / "location" / "contact" 这三个值之一或多个，其他词一律不写；没有缺失就写空数组 []。
7. 无法确定的字段一律输出 null（绝不能输出空字符串 ""），不要猜测。

输出示例（严格按此结构）：
{"intent":"CREATE_MEETING","contacts":[{"name":"张三","email":null,"phone":null,"organization":null}],"meeting":{"title":null,"start":"2026-10-09T15:00:00+08:00","end":null,"location":null,"needsMemory":false},"contactUpdate":null,"missing":[]}`;
};

const buildUserContent = (input: UnderstandInput): string => {
  const parts: string[] = [];
  if (input.transcript?.trim()) {
    parts.push(`【聊天记录】\n${input.transcript.trim()}`);
  }
  if (input.userText?.trim()) {
    parts.push(`【用户补充】\n${input.userText.trim()}`);
  }
  return parts.length > 0 ? parts.join("\n\n") : "（无内容）";
};

/** 将聊天内容（文本或截图转写）结构化为 ChatUnderstanding */
export async function understandChat(
  provider: LLMProvider,
  input: UnderstandInput,
  now: Date = new Date(),
): Promise<ChatUnderstanding> {
  return provider.structured({
    messages: [
      { role: "system", content: buildSystemPrompt(now) },
      { role: "user", content: buildUserContent(input) },
    ],
    schema: ChatUnderstandingSchema,
    temperature: 0,
    maxRetries: 2,
  });
}

/** 基于聊天截图（多模态视觉输入）进行结构化理解 */
export async function understandScreenshot(
  provider: LLMProvider,
  input: ScreenshotInput,
  now: Date = new Date(),
): Promise<ChatUnderstanding> {
  const parts = [
    {
      type: "text" as const,
      text: input.userText?.trim()
        ? `请识别这张聊天截图并按规则输出 JSON。用户补充：${input.userText.trim()}`
        : "请识别这张聊天截图并按规则输出 JSON。",
    },
    {
      type: "image_url" as const,
      image_url: { url: input.imageDataUrl, detail: "high" as const },
    },
  ];
  return provider.structured({
    messages: [
      { role: "system", content: buildSystemPrompt(now) },
      { role: "user", content: parts },
    ],
    schema: ChatUnderstandingSchema,
    temperature: 0,
    maxRetries: 2,
  });
}
