import { z } from "zod";

// Task 9 — Agent 决策的结构化输出 Schema（Zod 校验，Gate 2 教训：空串归一为 null）

const nullableString = z.preprocess((v) => (v === "" ? null : v), z.string().nullable());

export const AgentToolEnum = z.enum([
  "memory_search",
  "contact_search",
  "task_search",
  "check_task_conflict",
  "ask_user",
  "create_action",
]);

const ToolCallSchema = z.object({
  step: z.literal("call_tool"),
  tool: AgentToolEnum,
  arguments: z.record(z.string(), z.unknown()),
});

// Task 18：统一 Action 模型（CREATE / UPDATE / CANCEL × TASK / CONTACT）
// CREATE_MEETING 保留为兼容别名（= CREATE_TASK type=MEETING）。
const FinalizeActionSchema = z.object({
  type: z.enum([
    "CREATE_TASK",
    "CREATE_MEETING", // 兼容别名
    "UPDATE_TASK",
    "CANCEL_TASK",
    "CREATE_CONTACT",
    "UPDATE_CONTACT",
  ]),
  payload: z.record(z.string(), z.unknown()),
});

const FinalizeSchema = z
  .object({
    step: z.literal("finalize"),
    outcome: z.enum(["action_card", "answer", "unknown"]),
    action: FinalizeActionSchema.nullable(),
    answer: nullableString,
  })
  .superRefine((d, ctx) => {
    if (d.outcome === "action_card" && !d.action) {
      ctx.addIssue({
        code: "custom",
        message: "outcome=action_card 时必须提供 action（type 与 payload）",
      });
    }
    if (d.outcome === "answer" && !d.answer?.trim()) {
      ctx.addIssue({
        code: "custom",
        message: "outcome=answer 时必须提供非空 answer 文本",
      });
    }
  });

export const AgentDecisionSchema = z.discriminatedUnion("step", [
  ToolCallSchema,
  FinalizeSchema,
]);

export type AgentDecision = z.infer<typeof AgentDecisionSchema>;

/** 把 Zod 校验错误压缩成给 LLM 看的单行提示 */
export function zodIssueSummary(error: z.ZodError): string {
  return error.issues
    .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
    .join("; ");
}
