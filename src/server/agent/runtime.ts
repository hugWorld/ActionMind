import type { ChatMessage, LLMProvider } from "../llm/types";
import type { EmbeddingProvider } from "../embedding";
import { AgentDecisionSchema, zodIssueSummary } from "./schema";
import { createAgentTools, toolsDescription, type AgentToolMap } from "./tools";
import type {
  ActionCardResult,
  AgentOutcome,
  AgentResult,
  AgentTraceItem,
} from "./types";

// Task 9 — Agent Runtime：Agent → Tool Selection → Tool Result → Agent → Next Decision

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
4. 关键信息缺失（时间/地点/联系人等）→ 调用 ask_user，一次只问最关键的一个问题。
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
