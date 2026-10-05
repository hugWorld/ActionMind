// Task 17 (Stage A) — 字段策略（Field Policy）
//
// 设计约束（用户明确要求）：
//   1) 本文件只负责定义字段属性（Required / Defaultable / Optional / Conditional）与默认值规则；
//      不承载、不硬编码 Agent 决策流程。
//   2) “是否询问用户、何时询问用户”由 Agent Runtime 根据 Agent State、任务目标和已有上下文
//      动态决定 —— 本文件不提供任何决策函数，只提供字段分类与默认值规则（单一事实源）。

// Task 18：统一 Action 模型 —— CREATE / UPDATE / CANCEL × TASK / CONTACT。
// CREATE_MEETING 保留为兼容别名（等价 CREATE_TASK + type=MEETING，字段策略共享）。
export type ActionType =
  | "CREATE_TASK"
  | "CREATE_MEETING"
  | "UPDATE_TASK"
  | "CANCEL_TASK"
  | "CREATE_CONTACT"
  | "UPDATE_CONTACT";

export type FieldClass = "required" | "defaultable" | "optional" | "conditional";

export interface DefaultRule {
  /** 生成默认值的纯函数；返回 undefined 表示无默认值 */
  apply(payload: Record<string, unknown>): unknown;
  /** 默认值规则说明（供调试 / UI 透出 / 文档） */
  description: string;
}

export interface FieldPolicyDef {
  class: FieldClass;
  /** 该字段缺失对任务的影响说明（Required 为执行前置条件） */
  reason: string;
  /** 仅 class=defaultable 使用：默认值规则 */
  default?: DefaultRule;
  /** 仅 class=conditional 使用：描述“什么条件下需要关注”，是否询问由 Agent 决定 */
  conditionNote?: string;
}

/** 会议默认时长（分钟）——结束时间缺省值的来源 */
export const DEFAULT_MEETING_DURATION_MINUTES = 30;

/** 从 payload 中取嵌套 contact.name 或顶层 name（兼容两种写法） */
function contactNameOf(payload: Record<string, unknown>): string | null {
  const c =
    typeof payload.contact === "object" &&
    payload.contact !== null &&
    !Array.isArray(payload.contact)
      ? (payload.contact as Record<string, unknown>)
      : {};
  const name = typeof c.name === "string" && c.name.trim() ? c.name.trim() : null;
  return name ?? (typeof payload.name === "string" && payload.name.trim() ? payload.name.trim() : null);
}

/** 会议标题默认值：优先「与{联系人}的会议」，无联系人则「新建会议」 */
export function defaultMeetingTitle(payload: Record<string, unknown>): string {
  const name = contactNameOf(payload);
  return name ? `与${name}的会议` : "新建会议";
}

/**
 * 会议结束时间默认值规则：end = start + (durationMinutes ?? 30) 分钟。
 * - payload.end 已存在 → 不覆盖（用户明确指定结束时间优先）。
 * - payload.durationMinutes 为有效正整数 → 用它覆盖默认 30 分钟（用户明确指定时长）。
 * - 返回 ISO 8601 字符串（与 MeetingPlan.start 同格式），无法计算时返回 undefined。
 */
export function defaultMeetingEnd(payload: Record<string, unknown>): string | undefined {
  if (payload.end != null && String(payload.end).trim() !== "") return undefined; // 已有明确结束时间，不覆盖
  const start = payload.start;
  if (typeof start !== "string" || !start.trim()) return undefined;
  const startDate = new Date(start);
  if (Number.isNaN(startDate.getTime())) return undefined;

  let minutes = DEFAULT_MEETING_DURATION_MINUTES;
  const raw = payload.durationMinutes;
  if (typeof raw === "number" && Number.isInteger(raw) && raw > 0) minutes = raw;
  else if (typeof raw === "string" && raw.trim() !== "") {
    const n = Number(raw);
    if (Number.isInteger(n) && n > 0) minutes = n;
  }

  const end = new Date(startDate.getTime() + minutes * 60_000);
  return end.toISOString();
}

/** 各 Action 类型的字段策略（单一事实源；后续阶段可扩展） */
export const FIELD_POLICIES: Record<ActionType, Record<string, FieldPolicyDef>> = {
  CREATE_TASK: {
    type: {
      class: "defaultable",
      reason: "任务类型缺省为 MEETING（会议是 Task 的一种类型）；明确提到 TODO/REMINDER 等才覆盖",
      default: { description: "MEETING", apply: () => "MEETING" },
    },
    title: {
      class: "defaultable",
      reason: "任务标题缺失时可用默认标题兜底，不应阻塞建卡",
      default: {
        description: "「与{联系人}的{任务}」，无联系人时「新建任务」",
        apply: (payload) => {
          const name = contactNameOf(payload);
          return name ? `与${name}的${(payload.type as string) === "TODO" ? "待办" : "任务"}` : "新建任务";
        },
      },
    },
    start: {
      class: "required",
      reason: "没有开始时间无法创建日程项（Required）",
    },
    end: {
      class: "defaultable",
      reason: "结束时间缺失时默认开始时间 + 30 分钟；用户明确指定时长/结束时间时才覆盖",
      default: {
        description: "end = start + (durationMinutes ?? 30) 分钟",
        apply: defaultMeetingEnd,
      },
    },
    location: {
      class: "conditional",
      reason: "地点是否必需取决于任务与上下文（线上会议/待办无需地点，不应一律要求填写）",
      conditionNote:
        "普通会议缺地点时，可向用户询问「需要线上进行吗？」；是否询问、何时询问由 Agent 根据上下文决定",
    },
    contact: {
      class: "required",
      reason: "个人日程任务通常需要明确对象（Required）；工具层对解析失败保持宽容，但 Agent 决策层应确认联系人",
    },
    notes: {
      class: "optional",
      reason: "备注/描述可有可无，缺失不询问（Optional）",
    },
  },
  CREATE_MEETING: {
    title: {
      class: "defaultable",
      reason: "会议标题缺失时可用默认标题兜底，不应阻塞建卡",
      default: {
        description: "「与{联系人}的会议」，无联系人时「新建会议」",
        apply: defaultMeetingTitle,
      },
    },
    start: {
      class: "required",
      reason: "没有开始时间无法创建日历事件（Required）",
    },
    end: {
      class: "defaultable",
      reason: "结束时间缺失时默认开始时间 + 30 分钟；用户明确指定时长/结束时间时才覆盖",
      default: {
        description: "end = start + (durationMinutes ?? 30) 分钟",
        apply: defaultMeetingEnd,
      },
    },
    location: {
      class: "conditional",
      reason: "地点是否必需取决于任务与上下文（线上会议无需地点，不应一律要求填写）",
      conditionNote:
        "普通会议缺地点时，可向用户询问「需要线上进行吗？」；是否询问、何时询问由 Agent 根据上下文决定",
    },
    contact: {
      class: "required",
      reason: "必须明确与谁开会（Required）；工具层对解析失败保持宽容，但 Agent 决策层应确认联系人",
    },
    notes: {
      class: "optional",
      reason: "备注/描述可有可无，缺失不询问（Optional）",
    },
  },
  CREATE_CONTACT: {
    name: { class: "required", reason: "联系人必须有姓名（Required）" },
    email: { class: "optional", reason: "邮箱缺失不询问（Optional）" },
    phone: { class: "optional", reason: "电话缺失不询问（Optional）" },
    organization: { class: "optional", reason: "公司缺失不询问（Optional）" },
    role: { class: "optional", reason: "职位缺失不询问（Optional）" },
  },
  UPDATE_CONTACT: {
    contactName: { class: "required", reason: "必须定位要更新的联系人（Required）" },
    field: { class: "required", reason: "必须指明更新哪个字段（Required）" },
    newValue: { class: "required", reason: "必须提供新值（Required）" },
  },
  UPDATE_TASK: {
    taskId: { class: "required", reason: "必须定位要修改的任务（Required；由 task_search 确认唯一）" },
    changes: {
      class: "required",
      reason: "必须提供修改内容（Required；title/start/end/location/notes 中至少一项）",
    },
  },
  CANCEL_TASK: {
    taskId: { class: "required", reason: "必须定位要取消的任务（Required；由 task_search 确认唯一）" },
    reason: { class: "optional", reason: "取消原因可选，缺失不询问（Optional）" },
  },
};

/** 取某个 Action 类型下字段的分类 */
export function classifyField(type: ActionType, field: string): FieldClass | null {
  return FIELD_POLICIES[type]?.[field]?.class ?? null;
}

/** 某 Action 类型的全部 Required 字段 */
export function requiredFieldsOf(type: ActionType): string[] {
  return Object.entries(FIELD_POLICIES[type] ?? {})
    .filter(([, def]) => def.class === "required")
    .map(([field]) => field);
}

/** 某 Action 类型的全部 Defaultable 字段 */
export function defaultableFieldsOf(type: ActionType): string[] {
  return Object.entries(FIELD_POLICIES[type] ?? {})
    .filter(([, def]) => def.class === "defaultable")
    .map(([field]) => field);
}

/**
 * 对一个 payload 应用全部 Defaultable 默认值（纯函数，返回新对象，不修改入参）。
 * 仅处理“缺失 → 补默认值”；Required/Optional/Conditional 的处理不在本函数职责内
 * （Required 校验与 Conditional 询问由 Agent Runtime 决定）。
 */
export function applyFieldDefaults(
  type: ActionType,
  payload: Record<string, unknown>,
): Record<string, unknown> {
  const defs = FIELD_POLICIES[type] ?? {};
  const out: Record<string, unknown> = { ...payload };
  for (const [field, def] of Object.entries(defs)) {
    if (def.class !== "defaultable" || !def.default) continue;
    const hasValue =
      out[field] != null && !(typeof out[field] === "string" && out[field].trim() === "");
    if (hasValue) continue;
    const value = def.default.apply(payload);
    if (value !== undefined) out[field] = value;
  }
  return out;
}
