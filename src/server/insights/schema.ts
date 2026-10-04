import { z } from "zod";

/** 空串归一 null（与 Task 2 的 LLM 输出契约一致） */
const nullableString = z.preprocess(
  (v) => (typeof v === "string" && v.trim() === "" ? null : v),
  z.string().nullable(),
);

/** 单条 Insight：claim（事实性陈述）+ evidenceIds（引用的真实 Memory id） */
export const InsightSchema = z.object({
  claim: z.string().min(1, "claim 不能为空"),
  evidenceIds: z.array(z.string().min(1)).default([]),
});
export type Insight = z.infer<typeof InsightSchema>;

/** LLM 结构化输出：洞察列表 + 可选说明（无证据时写「暂无可靠依据。」） */
export const InsightsOutputSchema = z.object({
  insights: z.array(InsightSchema).default([]),
  note: nullableString,
});
export type InsightsOutput = z.infer<typeof InsightsOutputSchema>;
