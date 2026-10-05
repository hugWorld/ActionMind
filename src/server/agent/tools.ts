import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "../db";
import type { LLMProvider } from "../llm/types";
import type { EmbeddingProvider } from "../embedding";
import { resolveContact } from "../contacts/resolve";
import { createHybridSearcher, type HybridSearcher } from "../search/hybrid";
import { queryTasks } from "../tasks";
import type { AgentToolName, ActionCardResult } from "./types";

// Task 9 — Agent 工具：memory_search / contact_search / ask_user / create_action

export interface AgentToolsDeps {
  provider: LLMProvider;
  embeddingProvider: EmbeddingProvider;
}

export interface AgentToolDef {
  name: AgentToolName;
  description: string;
  schema: z.ZodType;
  execute(args: unknown): Promise<unknown>;
}

export type AgentToolMap = Record<AgentToolName, AgentToolDef>;

/** 工具清单描述（注入 system prompt 供 LLM 选择） */
export function toolsDescription(tools: AgentToolMap): string {
  return Object.values(tools)
    .map((t) => `- ${t.name}: ${t.description}`)
    .join("\n");
}

/**
 * 构建 Agent 工具集。
 * memory_search 复用 Task 8 Hybrid RAG（BM25+Embedding+Structured+重排），懒创建 searcher。
 */
export async function createAgentTools(deps: AgentToolsDeps): Promise<AgentToolMap> {
  let searcher: HybridSearcher | null = null;
  const getSearcher = async (): Promise<HybridSearcher> => {
    if (!searcher) searcher = await createHybridSearcher(deps.embeddingProvider);
    return searcher;
  };

  const memorySearchSchema = z.object({
    query: z.string().min(1, "query 不能为空"),
    k: z.number().int().min(1).max(20).optional(),
  });

  const contactSearchSchema = z.object({
    name: z.string().optional(),
    email: z.string().optional(),
    phone: z.string().optional(),
    organization: z.string().optional(),
  });

  const askUserSchema = z.object({
    question: z.string().min(1, "question 不能为空"),
  });

  const createActionSchema = z.object({
    type: z.enum([
      "CREATE_TASK",
      "CREATE_MEETING", // 兼容别名
      "UPDATE_TASK",
      "CANCEL_TASK",
      "CREATE_CONTACT",
      "UPDATE_CONTACT",
    ]),
    payload: z.record(z.string(), z.unknown()).refine((p) => Object.keys(p).length > 0, {
      message: "payload 不能为空对象",
    }),
  });

  const taskSearchSchema = z.object({
    id: z.string().optional(),
    title: z.string().optional(),
    contactId: z.string().optional(),
    contactName: z.string().optional(),
    /** YYYY-MM-DD（Asia/Shanghai） */
    startDate: z.string().optional(),
    endDate: z.string().optional(),
    /** ISO 8601 时间点（>= startAt） */
    startTime: z.string().optional(),
    /** MEETING | TODO | REMINDER | OTHER */
    taskType: z.string().optional(),
    /** CONFIRMED | COMPLETED | CANCELLED */
    status: z.string().optional(),
    includeCancelled: z.boolean().optional(),
    limit: z.number().int().min(1).max(100).optional(),
  });


  const checkTaskConflictSchema = z.object({
    /** ISO 8601 时间点（Asia/Shanghai），如 2026-10-09T15:00:00+08:00 */
    startAt: z.string().min(1, "startAt 不能为空"),
    /** ISO 8601 时间点；可选，默认 = startAt + 30 分钟 */
    endAt: z.string().optional(),
    /** 排除的任务 id（修改任务时排除自身，避免把自己当成冲突） */
    excludeTaskId: z.string().optional(),
  });

  const tools: AgentToolMap = {
    memory_search: {
      name: "memory_search",
      description:
        "检索用户已确认/已执行的个人记忆（Hybrid RAG：关键词+语义）。参数：query（查询内容，必填）、k（返回条数，默认 5）。返回记忆列表（id/content/score）。用于回答关于历史安排的问题，或补全‘上次/之前/老地方’这类历史引用。",
      schema: memorySearchSchema,
      execute: async (args) => {
        const { query, k = 5 } = memorySearchSchema.parse(args);
        const s = await getSearcher();
        const hits = await s.search(query, { k });
        return {
          count: hits.length,
          memories: hits.map((h) => ({
            memoryId: h.memoryId,
            content: h.content,
            score: h.score,
            sources: h.sources,
          })),
        };
      },
    },
    contact_search: {
      name: "contact_search",
      description:
        "在联系人库中解析联系人。参数：name / email / phone / organization（至少一个）。返回 unique（联系人详情）、ambiguous（候选列表）或 not_found。用于把聊天中提到的人物解析为真实联系人。",
      schema: contactSearchSchema,
      execute: async (args) => {
        const input = contactSearchSchema.parse(args);
        return resolveContact(input);
      },
    },
    task_search: {
      name: "task_search",
      description:
        "查询当前日程/任务（PostgreSQL 单一数据源，与日程页共享）。参数：id / title / contactId / contactName / startDate / endDate / startTime / taskType / status / includeCancelled（默认隐藏 CANCELLED）。用于：①回答查询类问题（“我周五有什么安排”“我和张三什么时候见”）；②取消/修改任务前先定位目标任务。返回候选任务列表（含 id/title/startAt/endAt/location/statusView）。若返回多条候选，必须 ask_user 让用户选择，禁止猜测。",
      schema: taskSearchSchema,
      execute: async (args) => {
        const parsed = taskSearchSchema.parse(args);
        const tasks = await queryTasks(parsed);
        return { count: tasks.length, tasks };
      },
    },
    check_task_conflict: {
      name: "check_task_conflict",
      description:
        "检查新任务/修改后的时间是否与已有已确认任务重叠。参数：startAt（ISO 时间点，必填）、endAt（可选，默认开始+30分钟）、excludeTaskId（修改任务时排除自身）。返回 conflicted（布尔）与冲突任务列表（id/title/startAt/endAt/location/statusView）。创建/修改任务前必须调用；有冲突时必须 ask_user 让用户选择（调整时间/仍然创建/放弃），禁止静默创建。",
      schema: checkTaskConflictSchema,
      execute: async (args) => {
        const { startAt, endAt, excludeTaskId } = checkTaskConflictSchema.parse(args);
        const ns = new Date(startAt).getTime();
        const ne = endAt ? new Date(endAt).getTime() : ns + 30 * 60_000;
        if (Number.isNaN(ns) || Number.isNaN(ne)) {
          return { conflicted: false, conflicts: [], error: "时间解析失败" };
        }
        // 复用 queryTasks 单一数据源（默认隐藏 CANCELLED），按目标日期范围查询 + 大 limit
        // （避免全量查询被默认 limit=50 截断导致漏判冲突）
        const fmt = (d: Date) =>
          `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
        const tasks = await queryTasks({
          startDate: fmt(new Date(ns)),
          endDate: fmt(new Date(ne)),
          limit: 500,
        });
        const conflicts = tasks
          .filter((t) => t.id !== excludeTaskId)
          .filter((t) => {
            const s = new Date(t.startAt ?? "").getTime();
            const e = new Date(t.endAt ?? t.startAt ?? "").getTime();
            // startAt 缺失（NaN）时不构成冲突
            return Number.isNaN(s) ? false : ns < e && ne > s;
          })
          .map((t) => ({
            id: t.id,
            title: t.title,
            startAt: t.startAt,
            endAt: t.endAt,
            location: t.location,
            statusView: t.statusView,
          }));
        return { conflicted: conflicts.length > 0, conflicts };
      },
    },
    ask_user: {
      name: "ask_user",
      description:
        "向用户提问以补全缺失的关键信息（时间/地点/联系人确认等）。参数：question（要问的问题文本）。调用本工具后本轮结束，等待用户回答。",
      schema: askUserSchema,
      execute: async (args) => askUserSchema.parse(args),
    },
    create_action: {
      name: "create_action",
      description:
        "生成行动卡片（状态 DRAFT，用户确认后才可执行）。参数：type ∈ {CREATE_MEETING, CREATE_CONTACT, UPDATE_CONTACT}，payload 为完整信息对象（如 title/start/location/contact 等）。调用本工具后本轮结束。",
      schema: createActionSchema,
      execute: async (args): Promise<ActionCardResult> => {
        const { type, payload } = createActionSchema.parse(args);
        const action = await prisma.action.create({
          data: {
            type,
            status: "DRAFT",
            payload: payload as Prisma.InputJsonValue,
            source: "agent",
          },
          select: { id: true, type: true, status: true, payload: true, source: true },
        });
        return {
          id: action.id,
          type: action.type,
          status: action.status as "DRAFT",
          payload: action.payload,
          source: action.source,
        };
      },
    },
  };

  return tools;
}
