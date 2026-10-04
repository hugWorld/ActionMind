import { z } from "zod";

/** 行动意图：PRD §9 只支持三种 Action，其余为 UNKNOWN */
export const IntentSchema = z.enum([
  "CREATE_MEETING",
  "CREATE_CONTACT",
  "UPDATE_CONTACT",
  "UNKNOWN",
]);
export type Intent = z.infer<typeof IntentSchema>;

/**
 * 可空字符串：模型可能输出 "" 表示"无"，统一归一为 null。
 * 确保"无法确定 → null"这一契约在数据层成立。
 */
const nullableString = z.preprocess(
  (v) => (typeof v === "string" && v.trim() === "" ? null : v),
  z.string().nullable(),
);

export const ExtractedContactSchema = z.object({
  name: nullableString,
  email: nullableString,
  phone: nullableString,
  organization: nullableString,
});
export type ExtractedContact = z.infer<typeof ExtractedContactSchema>;

export const MeetingPlanSchema = z.object({
  title: nullableString,
  /** ISO 8601（含 +08:00 偏移），无法确定时为 null */
  start: nullableString,
  end: nullableString,
  location: nullableString,
  /** 是否引用了历史记忆（如"上次那个地方"），需要后续 Memory 检索 */
  needsMemory: z.boolean().default(false),
});
export type MeetingPlan = z.infer<typeof MeetingPlanSchema>;

export const ContactUpdateSchema = z.object({
  contactName: nullableString,
  field: z.enum(["email", "phone", "organization", "role"]).nullable(),
  newValue: nullableString,
});
export type ContactUpdate = z.infer<typeof ContactUpdateSchema>;

/** 缺失的必要参数（供 Agent 决定是否 ask_user） */
export const MissingFieldSchema = z.enum(["time", "location", "contact"]);

export const ChatUnderstandingSchema = z.object({
  intent: IntentSchema,
  contacts: z.array(ExtractedContactSchema).default([]),
  meeting: MeetingPlanSchema.nullable(),
  contactUpdate: ContactUpdateSchema.nullable(),
  missing: z.array(MissingFieldSchema).default([]),
});
export type ChatUnderstanding = z.infer<typeof ChatUnderstandingSchema>;
