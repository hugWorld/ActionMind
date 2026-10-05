import type { ChatMessage, LLMProvider } from "../llm/types";
import type { EmbeddingProvider } from "../embedding";
import { AgentDecisionSchema, zodIssueSummary } from "./schema";
import { createAgentTools, toolsDescription, type AgentToolMap } from "./tools";
import { understandScreenshot } from "../llm/understand";
import {
  applyFieldDefaults,
  requiredFieldsOf,
  FIELD_POLICIES,
  type ActionType,
} from "../planning/field-policy";
import {
  cleanupStaleSessions,
  createSessionState,
  getSession,
  setSession,
  touchState,
  type AgentSessionState,
  type MemoryHit,
} from "./state";
import type {
  ActionCardResult,
  AgentOutcome,
  AgentResult,
  AgentTraceItem,
} from "./types";

// Task 9 — Agent Runtime：Agent → Tool Selection → Tool Result → Agent → Next Decision
// Task 17 (Stage B)：新增 runAgentSession（对话式多轮 ReAct）——
//   - 结构化 Agent State（goal/extractedInfo/resolvedContacts/retrievedMemories/
//     missingRequiredInfo/currentAction/toolResults/phase/trace/messages）
//   - ask_user 后同会话续跑（多轮），Human Feedback（用户回答/修改）作为新用户消息回喂
//   - finalize/create_action 的 Required 校验与 Defaultable 默认值由 Runtime 护栏兜底（field-policy）
//   - 原有 runAgentLoop（单轮）保持不变，继续可用。

export interface AgentRuntimeOptions {
  provider: LLMProvider;
  embeddingProvider: EmbeddingProvider;
  maxTurns?: number;
  now?: Date;
}

const buildSystemPrompt = (now: Date, tools: AgentToolMap): string => {
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
  return `你是 ActionMind 的个人事务 Agent，负责根据用户输入调用工具、补全信息并生成行动。

当前时间（Asia/Shanghai, UTC+8）：${cn}（ISO ${iso}）

可用工具：
${toolsDescription(tools)}

决策规则：
1. 输入含历史引用（“上次”“之前”“老地方”“和以前一样”等）或询问历史安排 → 先调用 memory_search。
2. 用户询问过去/历史信息（“在哪”“什么时候”“是谁”等）时：调用 memory_search 检索记忆后，用 finalize(answer) 直接回答（answer 里引用记忆内容），不要调用 create_action。
3. 需要联系人信息（姓名/邮箱/电话/公司）→ 先调用 contact_search；工具返回 not_found 或 ambiguous 时，调用 ask_user 向用户澄清，不要假装已解析。
4. 仅当 Required 字段（如开始时间）缺失时才 ask_user，一次只问最关键的一个；Optional/Conditional 缺失不因此询问（地点是否问由上下文决定，如普通会议缺地点时可问「需要线上进行吗？」）。
5. 信息齐全、可执行 → 调用 create_action 生成行动卡片（payload 必须包含完整、具体的字段，如 title/start/location/contact 等）。
6. 纯闲聊、无任何行动意图且不涉及历史安排 → finalize(unknown)。
7. 禁止编造：记忆与联系人一律以工具结果为准，工具结果里没有的信息不得写入 payload。
8. 每一步只能输出一个决策：call_tool（调用工具）或 finalize（结束）。

输出示例：
{"step":"call_tool","tool":"memory_search","arguments":{"query":"上次开会的会议室"}}
{"step":"finalize","outcome":"answer","action":null,"answer":"根据记忆，上次和张三在 Meeting Room 3 开项目周会。"}
{"step":"call_tool","tool":"ask_user","arguments":{"question":"会议安排在什么时间？"}}
{"step":"finalize","outcome":"action_card","action":{"type":"CREATE_MEETING","payload":{"title":"和张三开会","start":"2026-10-09T15:00:00+08:00","location":"Meeting Room 3"}},"answer":null}`;
};

/** 从工具轨迹中提取 memory_search 命中的记忆 id */
function collectMemoryIds(trace: AgentTraceItem[]): string[] {
  const ids: string[] = [];
  for (const item of trace) {
    if (item.tool !== "memory_search") continue;
    const result = item.result as { memories?: Array<{ memoryId: string }> };
    for (const m of result.memories ?? []) ids.push(m.memoryId);
  }
  return [...new Set(ids)];
}

/**
 * 运行 Agent Loop（有轮数上限兜底）。
 * 返回最终产物（Action Card / ask_user 问题 / 直接回答 / unknown）+ 完整工具轨迹。
 * 注：单轮、无状态；多轮会话请使用 runAgentSession。
 */
export async function runAgentLoop(
  userInput: string,
  options: AgentRuntimeOptions,
): Promise<AgentResult> {
  const maxTurns = options.maxTurns ?? 5;
  const now = options.now ?? new Date();
  const tools = await createAgentTools({
    provider: options.provider,
    embeddingProvider: options.embeddingProvider,
  });

  const messages: ChatMessage[] = [
    { role: "system", content: buildSystemPrompt(now, tools) },
    { role: "user", content: userInput },
  ];
  const trace: AgentTraceItem[] = [];

  for (let turn = 1; turn <= maxTurns; turn++) {
    const decision = await options.provider.structured({
      messages,
      schema: AgentDecisionSchema,
      temperature: 0,
      maxRetries: 1,
    });

    if (decision.step === "finalize") {
      if (decision.outcome === "action_card" && decision.action) {
        const tool = tools.create_action;
        const action = (await tool.execute(decision.action)) as ActionCardResult;
        trace.push({ tool: tool.name, args: decision.action, result: action });
        return {
          outcome: { kind: "action_card", action, toolTrace: trace },
          trace,
        };
      }
      if (decision.outcome === "answer" && decision.answer) {
        const memoryIds = collectMemoryIds(trace);
        return {
          outcome: {
            kind: "answer",
            content: decision.answer,
            memoryIds,
            toolTrace: trace,
          },
          trace,
        };
      }
      return { outcome: { kind: "unknown", toolTrace: trace }, trace };
    }

    // call_tool
    const tool = tools[decision.tool];
    if (!tool) {
      messages.push({
        role: "assistant",
        content: `工具 ${decision.tool} 不存在，请从可用工具中选择。`,
      });
      continue;
    }
    const parsed = tool.schema.safeParse(decision.arguments);
    if (!parsed.success) {
      messages.push({
        role: "assistant",
        content: `工具 ${tool.name} 参数校验失败：${zodIssueSummary(parsed.error)}。请修正后重试。`,
      });
      continue;
    }

    const result = await tool.execute(parsed.data);
    trace.push({ tool: tool.name, args: parsed.data, result });

    if (tool.name === "ask_user") {
      const question = (result as { question: string }).question;
      return {
        outcome: { kind: "ask_user", question, toolTrace: trace },
        trace,
      };
    }
    if (tool.name === "create_action") {
      return {
        outcome: { kind: "action_card", action: result as ActionCardResult, toolTrace: trace },
        trace,
      };
    }

    messages.push({
      role: "assistant",
      content: `【工具结果 ${tool.name}】\n${JSON.stringify(result)}`,
    });
  }

  return { outcome: { kind: "unknown", toolTrace: trace }, trace };
}

// =====================================================================
// Task 17 (Stage B) — 会话化 Agent Runtime
// =====================================================================

/** Required 字段的中文名（护栏提示用） */
const FIELD_ZH: Record<string, string> = {
  start: "开始时间",
  contact: "联系人",
  contactName: "联系人",
  field: "要更新的字段",
  newValue: "新值",
  name: "姓名",
  taskId: "目标任务",
  changes: "修改内容",
  reason: "取消原因",
  title: "任务标题",
  location: "地点",
};

const zhName = (f: string): string => FIELD_ZH[f] ?? f;

/** 判断 payload 是否具备某字段的有效值（contact 支持嵌套/contactId 两种写法） */
function hasFieldValue(payload: Record<string, unknown>, field: string): boolean {
  const v = payload[field];
  if (field === "contact") {
    if (typeof payload.contactId === "string" && payload.contactId.trim()) return true;
    if (typeof v === "object" && v !== null && !Array.isArray(v)) {
      const c = v as Record<string, unknown>;
      return typeof c.name === "string" && c.name.trim() !== "";
    }
    return false;
  }
  if (v == null) return false;
  if (typeof v === "string" && v.trim() === "") return false;
  return true;
}

/**
 * Action 卡片护栏（Runtime 动态决定；field-policy 只提供分类与默认值）：
 *   1) 对 Defaultable 字段应用默认值（applyFieldDefaults）；
 *   2) 校验 Required 字段，缺失 → 返回需要询问的缺口（由 Runtime 决定转 ask_user）。
 */
/** 用户明确放行冲突的词（选择「仍然创建」等） */
const CONFLICT_OVERRIDE_RE = /(仍然创建|照旧|不管冲突|继续创建|直接创建|就这样|没关系|可以创建|创建吧)/;

/** 时间显示：ISO → 「10月9日 15:00」（UTC+8 展示） */
function formatConflictRange(startAt?: string | null, endAt?: string | null): string {
  const fmt = (iso?: string | null): string => {
    if (!iso) return "";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    const bj = new Date(d.getTime() + 8 * 3600_000);
    return `${bj.getUTCMonth() + 1}月${bj.getUTCDate()}日 ${String(bj.getUTCHours()).padStart(2, "0")}:${String(bj.getUTCMinutes()).padStart(2, "0")}`;
  };
  const s = fmt(startAt);
  if (!s) return "";
  const e = fmt(endAt);
  const tail = e ? e.split(" ")[1] : "";
  return tail ? `${s}-${tail}` : s;
}

/**
 * 确定性冲突护栏（兜底）：即使 LLM 忘记调用 check_task_conflict，
 * 生成「创建任务」卡片前也强制检查时间重叠；有冲突且用户未明确放行时阻断卡片、返回询问。
 * 放行条件：会话中最近一条用户消息包含「仍然创建/照旧/不管冲突」等明确选择。
 */
export async function conflictGuard(
  action: { type: string; payload: Record<string, unknown> },
  tools: AgentToolMap,
  state: AgentSessionState,
): Promise<{ blocked: boolean; question?: string }> {
  if (!["CREATE_TASK", "CREATE_MEETING"].includes(action.type)) return { blocked: false };
  const start = action.payload.start as string | undefined;
  if (typeof start !== "string" || !start.trim()) return { blocked: false };
  const lastUser = [...state.messages].reverse().find((m) => m.role === "user");
  const lastText = typeof lastUser?.content === "string" ? lastUser.content : "";
  if (CONFLICT_OVERRIDE_RE.test(lastText)) return { blocked: false };
  const res = (await tools.check_task_conflict.execute({
    startAt: start,
    ...(typeof action.payload.end === "string" && action.payload.end
      ? { endAt: action.payload.end }
      : {}),
  })) as { conflicted: boolean; conflicts: Array<{ title?: string; startAt?: string; endAt?: string }> };
  if (!res.conflicted || res.conflicts.length === 0) return { blocked: false };
  const names = res.conflicts
    .slice(0, 3)
    .map((c) => `「${c.title ?? "未命名任务"}」（${formatConflictRange(c.startAt, c.endAt)}）`)
    .join("、");
  const question = `该时段已有任务${names}，时间重叠。仍然创建、调整时间还是放弃？`;
  return { blocked: true, question };
}

async function guardAction(
  decision: { type: string; payload: Record<string, unknown> },
  tools: AgentToolMap,
): Promise<
  | { ok: true; action: ActionCardResult }
  | { ok: false; message: string; missing: string[] }
> {
  const type = decision.type as string;
  if (!(type in FIELD_POLICIES)) {
    return { ok: false, message: `不支持的 Action 类型：${type}`, missing: [] };
  }
  const actionType = type as ActionType;
  const payload = applyFieldDefaults(actionType, decision.payload ?? {});
  const missing = requiredFieldsOf(actionType).filter((f) => !hasFieldValue(payload, f));
  if (missing.length > 0) {
    return {
      ok: false,
      message: `系统校验：行动卡片缺少必填字段（${missing.map(zhName).join("、")}）。请用 ask_user 向用户询问后再生成卡片。`,
      missing,
    };
  }
  const action = (await tools.create_action.execute({ type, payload })) as ActionCardResult;
  return { ok: true, action };
}

export interface SessionInput {
  /** 用户文字输入（Text-only 时必填；与图片组合时可作为补充说明） */
  text?: string;
  /** 截图 data URL（可选；Image-only / Text+Image 输入） */
  imageDataUrl?: string;
  /** 续跑时传入上一轮返回的 sessionId */
  sessionId?: string;
}

export interface AgentSessionOptions extends AgentRuntimeOptions {
  sessionId?: string;
}

export interface AgentSessionResult {
  outcome: AgentOutcome;
  /** 更新后的会话状态（前端可据此渲染；messages 通常不直接展示） */
  state: AgentSessionState;
  sessionId: string;
}

/** 构建带会话状态的 system prompt（State 摘要 → 动态决策依据） */
function buildSessionPrompt(now: Date, tools: AgentToolMap, state: AgentSessionState): string {
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

  const contacts = state.resolvedContacts.length
    ? state.resolvedContacts
        .map((c) => `${c.name}${c.contactId ? `(id=${c.contactId.slice(0, 8)})` : ""}`)
        .join("、")
    : "（无）";
  const memories = state.retrievedMemories.length
    ? state.retrievedMemories
        .slice(0, 3)
        .map((m) => m.content)
        .join("；")
    : "（无）";
  const asked = state.askedQuestions.length
    ? state.askedQuestions.join("；")
    : "（尚未问过）";

  return `你是 ActionMind 的个人事务 Agent，负责根据用户输入调用工具、补全信息并生成行动。

当前时间（Asia/Shanghai, UTC+8）：${cn}（ISO ${iso}）

【当前会话状态】
- 任务目标：${state.goal ?? "尚未明确"}
- 已提取信息：${JSON.stringify(state.extractedInfo)}
- 已解析联系人：${contacts}
- 已检索到的记忆：${memories}
- 缺失的必填字段：${state.missingRequiredInfo.length ? state.missingRequiredInfo.map(zhName).join("、") : "（无）"}
- 已向用户问过的问题：${asked}
- 待确认卡片：${state.currentAction ? `${state.currentAction.type} ${JSON.stringify(state.currentAction.payload)}` : "（无）"}

可用工具：
${toolsDescription(tools)}

字段规则（重要）：
- Required：缺失会导致任务无法执行（如任务开始时间）。只有 Required 缺失才 ask_user，一次只问最关键的一个。
- Defaultable：结束时间缺省 = 开始时间 + 30 分钟，**不要询问结束时间**；标题缺省可由系统生成，不要因此阻塞。
- Optional：备注、描述等可有可无，**缺失不要询问**。
- Conditional：地点按任务与上下文决定——若可线上/无需地点，不要问；对普通线下会议缺地点，可问一句「需要线上进行吗？」。

决策规则：
1. 用户询问当前/未来日程（“我周五有什么安排”“我和张三下次什么时候见”“我明天下午有空吗”）→ 先调用 task_search（带 startDate/endDate/contactName 等范围），再用 finalize(answer) 直接回答；不要 create_action。
2. 用户询问过去/历史信息（“在哪”“什么时候”“是谁”“上次…几次”等）→ 先 memory_search，再用 finalize(answer) 直接回答，不要 create_action。
3. 输入含历史引用（“上次”“之前”“老地方”“和以前一样”等）→ 先 memory_search 补全上下文。
4. 用户要取消任务（“取消…”“删掉…”“把…取消掉”）→ 先 task_search 定位目标任务（可带 contactName/日期/title 缩小范围）；若唯一 → 生成 CANCEL_TASK action（payload {taskId, reason?}）；若返回多条候选 → 必须 ask_user 列出全部候选让用户选择，禁止猜测。取消必须经用户确认后才可执行。
5. 用户要修改任务（“改到…”“换成…”“推迟…”“改时间”）→ 先 task_search 定位；唯一 → UPDATE_TASK action（payload {taskId, changes:{title?/start?/end?/location?/notes?}}）；多条候选 → ask_user 消歧。禁止未经确认直接修改已存在的任务。
6. 联系人非必需：创建任务时若提到人名可先 contact_search，not_found/ambiguous 不阻塞——直接在标题体现人名并 create_action；仅当用户明确要求「创建/更新联系人」时才必须解析联系人（not_found → ask_user 澄清或生成 CREATE_CONTACT）。
7. 【会话状态】里已经有的信息（已提取/已解析/已检索）不要重复询问；已问过的问题不要重复问。
8. 创建/修改任务前 → 必须先调用 check_task_conflict（参数 startAt；修改任务时传 excludeTaskId 排除自身）检查时间冲突——无论会议、上课、待办等任何任务类型，创建前都必须检查：
   - conflicted=false（无冲突）且信息足够 → 调用 create_action（创建任务用 CREATE_TASK，payload 完整具体；结束时间可不填，系统自动补 +30 分钟；会议也可用兼容别名 CREATE_MEETING）；
   - conflicted=true（时间与已有已确认任务重叠）→ 必须 ask_user 告知冲突任务（标题+时间）并给出选项：①调整时间 ②仍然创建（用户明确说「仍然创建/照旧/不管冲突」时直接 create_action，无需再查冲突）③放弃。禁止存在冲突时静默 create_action。
9. 纯闲聊、无行动意图且不涉及历史/日程 → finalize(unknown)。
10. 禁止编造：任务/记忆/联系人一律以工具结果为准；工具结果里没有的信息不得写入 payload。
11. 若【待确认卡片】已存在，用户的新消息是对卡片的修改意见 → 用 create_action 生成更新后的卡片（type/payload 反映修改）。
12. 每一步只能输出一个决策：call_tool 或 finalize。

输出示例：
{"step":"call_tool","tool":"task_search","arguments":{"startDate":"2026-10-09","endDate":"2026-10-09"}}
{"step":"call_tool","tool":"task_search","arguments":{"contactName":"张三"}}
{"step":"call_tool","tool":"check_task_conflict","arguments":{"startAt":"2026-10-09T15:00:00+08:00"}}
{"step":"call_tool","tool":"ask_user","arguments":{"question":"该时段已有任务「与王语嫣的方案评审会议」（2026-10-09 15:00-15:30）。仍然创建、调整时间还是放弃？"}}
{"step":"finalize","outcome":"answer","action":null,"answer":"周五你有 1 项安排：15:00 与张三的会议（三楼会议室）。"}
{"step":"call_tool","tool":"ask_user","arguments":{"question":"我找到两项符合条件的任务：①与张三的会议 ②与张三会面（都是 2026-10-09 15:00）。你希望取消哪一个？"}}
{"step":"finalize","outcome":"action_card","action":{"type":"CANCEL_TASK","payload":{"taskId":"<任务id>","reason":"行程冲突"}},"answer":null}
{"step":"finalize","outcome":"action_card","action":{"type":"UPDATE_TASK","payload":{"taskId":"<任务id>","changes":{"start":"2026-10-10T15:00:00+08:00"}}},"answer":null}
{"step":"finalize","outcome":"action_card","action":{"type":"CREATE_MEETING","payload":{"title":"和张三开会","start":"2026-10-09T15:00:00+08:00"}},"answer":null}`;
}

/**
 * 会话化多轮 Agent Loop（Task 17 Stage B）。
 * - 每次调用带着 sessionId 续跑：用户回答/修改作为新 user message 回喂（Human Feedback）。
 * - ask_user 返回后会话不结束，等待用户下一条消息继续。
 * - 内部护栏：Defaultable 默认值 + Required 校验（缺失 → Runtime 决定转 ask_user）。
 */
export async function runAgentSession(
  input: SessionInput,
  options: AgentSessionOptions,
): Promise<AgentSessionResult> {
  const maxTurns = options.maxTurns ?? 6;
  const now = options.now ?? new Date();
  const provider = options.provider;
  const tools = await createAgentTools({
    provider,
    embeddingProvider: options.embeddingProvider,
  });

  // 1) 恢复/创建会话状态
  const state =
    (input.sessionId ? getSession(input.sessionId) : undefined) ??
    createSessionState(options.sessionId);
  setSession(state);
  cleanupStaleSessions(now.getTime());

  // 2) 图片输入：结构化理解 → 注入 extractedInfo（LLM 无需再问已提取信息）
  if (input.imageDataUrl) {
    const understanding = await understandScreenshot(provider, {
      imageDataUrl: input.imageDataUrl,
      userText: input.text,
    });
    state.extractedInfo = {
      ...state.extractedInfo,
      intent: understanding.intent,
      contacts: understanding.contacts,
      meeting: understanding.meeting,
      contactUpdate: understanding.contactUpdate,
      needsMemory: understanding.meeting?.needsMemory ?? false,
    };
    if (understanding.intent !== "UNKNOWN") state.goal = understanding.intent;
    state.messages.push({
      role: "assistant",
      content: `【系统已从用户上传的截图提取信息】\n${JSON.stringify(understanding)}`,
    });
  }

  // 3) 文本输入：用户消息（多轮续跑/修改意见都走这里）
  if (input.text?.trim()) {
    state.messages.push({ role: "user", content: input.text.trim() });
  }

  // 本轮是否有新的用户输入（文字和/或图片；续跑时也允许只携带 sessionId 依赖历史 user 消息）
  const hasUserMessage =
    Boolean(input.text?.trim() || input.imageDataUrl) ||
    state.messages.some((m) => m.role === "user");
  if (!hasUserMessage) {
    state.phase = "gathering";
    touchState(state);
    setSession(state);
    return {
      outcome: { kind: "ask_user", question: "你想让我帮你做什么？", toolTrace: state.trace },
      state,
      sessionId: state.sessionId,
    };
  }

  // 4) ReAct 循环（护栏兜底，LLM 主导）
  for (let turn = 1; turn <= maxTurns; turn++) {
    const system = buildSessionPrompt(now, tools, state);
    const messages: ChatMessage[] = [{ role: "system", content: system }, ...state.messages];
    const decision = await provider.structured({
      messages,
      schema: AgentDecisionSchema,
      temperature: 0,
      maxRetries: 1,
    });

    if (decision.step === "finalize") {
      if (decision.outcome === "action_card" && decision.action) {
        // 确定性冲突护栏：LLM 未调用 check_task_conflict 时兜底（创建任务前强制查重叠）
        const conflict = await conflictGuard(decision.action, tools, state);
        if (conflict.blocked && conflict.question) {
          state.messages.push({ role: "assistant", content: `【冲突检测】${conflict.question}` });
          state.phase = "gathering";
          touchState(state);
          setSession(state);
          return {
            outcome: { kind: "ask_user", question: conflict.question, toolTrace: state.trace },
            state,
            sessionId: state.sessionId,
          };
        }
        const guarded = await guardAction(decision.action, tools);
        if (!guarded.ok) {
          state.missingRequiredInfo = guarded.missing;
          state.messages.push({ role: "assistant", content: guarded.message });
          continue; // 下一轮 LLM 应 ask_user 补齐
        }
        const action = guarded.action;
        state.currentAction = {
          id: action.id,
          type: action.type,
          payload: action.payload as Record<string, unknown>,
        };
        state.phase = "ready";
        state.missingRequiredInfo = [];
        touchState(state);
        setSession(state);
        return {
          outcome: { kind: "action_card", action, toolTrace: state.trace },
          state,
          sessionId: state.sessionId,
        };
      }
      if (decision.outcome === "answer" && decision.answer) {
        const memoryIds = collectMemoryIds(state.trace);
        state.phase = "done";
        touchState(state);
        setSession(state);
        return {
          outcome: {
            kind: "answer",
            content: decision.answer,
            memoryIds,
            toolTrace: state.trace,
          },
          state,
          sessionId: state.sessionId,
        };
      }
      state.phase = "done";
      touchState(state);
      setSession(state);
      return { outcome: { kind: "unknown", toolTrace: state.trace }, state, sessionId: state.sessionId };
    }

    // call_tool
    const tool = tools[decision.tool];
    if (!tool) {
      state.messages.push({
        role: "assistant",
        content: `工具 ${decision.tool} 不存在，请从可用工具中选择。`,
      });
      continue;
    }
    const parsed = tool.schema.safeParse(decision.arguments);
    if (!parsed.success) {
      state.messages.push({
        role: "assistant",
        content: `工具 ${tool.name} 参数校验失败：${zodIssueSummary(parsed.error)}。请修正后重试。`,
      });
      continue;
    }

    const result = await tool.execute(parsed.data);
    state.trace.push({ tool: tool.name, args: parsed.data, result });

    if (tool.name === "memory_search") {
      const r = result as { memories?: MemoryHit[] };
      state.retrievedMemories = r.memories ?? [];
      state.toolResults.memory_search = result;
    } else if (tool.name === "contact_search") {
      const r = result as {
        status: string;
        contact?: {
          id: string;
          name: string;
          email?: string | null;
          phone?: string | null;
          organization?: string | null;
          role?: string | null;
        };
      };
      if (r.status === "unique" && r.contact) {
        state.resolvedContacts.push({
          contactId: r.contact.id,
          name: r.contact.name,
          email: r.contact.email,
          phone: r.contact.phone,
          organization: r.contact.organization,
          role: r.contact.role,
        });
      }
      state.toolResults.contact_search = result;
    } else if (tool.name === "ask_user") {
      const question = (result as { question: string }).question;
      state.askedQuestions.push(question);
      state.phase = "gathering";
      touchState(state);
      setSession(state);
      return {
        outcome: { kind: "ask_user", question, toolTrace: state.trace },
        state,
        sessionId: state.sessionId,
      };
    } else if (tool.name === "create_action") {
      const args = parsed.data as { type: string; payload: Record<string, unknown> };
      const guarded = await guardAction(
        { type: args.type, payload: args.payload },
        tools,
      );
      if (!guarded.ok) {
        state.missingRequiredInfo = guarded.missing;
        state.messages.push({ role: "assistant", content: guarded.message });
        continue;
      }
      const action = guarded.action;
      state.currentAction = {
        id: action.id,
        type: action.type,
        payload: action.payload as Record<string, unknown>,
      };
      state.phase = "ready";
      state.missingRequiredInfo = [];
      touchState(state);
      setSession(state);
      return {
        outcome: { kind: "action_card", action, toolTrace: state.trace },
        state,
        sessionId: state.sessionId,
      };
    }

    state.messages.push({
      role: "assistant",
      content: `【工具结果 ${tool.name}】\n${JSON.stringify(result)}`,
    });
  }

  state.phase = "done";
  touchState(state);
  setSession(state);
  return { outcome: { kind: "unknown", toolTrace: state.trace }, state, sessionId: state.sessionId };
}
