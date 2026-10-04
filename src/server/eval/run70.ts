import { writeFile } from "node:fs/promises";
import { Prisma } from "@prisma/client";
import { prisma } from "../db";
import type { LLMProvider } from "../llm/types";
import type { EmbeddingProvider } from "../embedding";
import { embedMemory } from "../embedding/memory";
import { understandChat } from "../llm/understand";
import { resolveContact } from "../contacts/resolve";
import { searchMemories } from "../embedding";
import { buildBm25Index, searchBm25 } from "../search/bm25";
import { createHybridSearcher } from "../search/hybrid";
import { evaluateRetriever, type RetrievalEvalResult } from "./metrics";
import { confirmAction, cancelAction } from "../actions";
import { executeWithTools } from "../tools";
import { UnauthorizedExecutionError } from "../execution";
import {
  UNDERSTANDING_CASES,
  CONTACT_SEEDS,
  CONTACT_CASES,
  EVAL70_MEMORIES,
  EVAL70_QUERIES,
  TOOL_SAFETY_CASES,
} from "./cases";

// Task 15 — Evaluation：70-case 可重复运行评估（PRD §53 / task.md Gate 15）

// ---------- 理解评估（20 cases，真实 LLM） ----------

function timeMatches(iso: string, exp: { date: string; hour: number }): boolean {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return false;
  const date = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
  const hour = Number(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Shanghai",
      hour: "2-digit",
      hourCycle: "h23",
    }).format(d),
  );
  return date === exp.date && hour === exp.hour;
}

async function runUnderstandingEval(provider: LLMProvider) {
  const n = UNDERSTANDING_CASES.length;
  let intentHit = 0;
  let entityHit = 0;
  let entityTotal = 0;
  let timeHit = 0;
  const details: Array<Record<string, unknown>> = [];

  for (const c of UNDERSTANDING_CASES) {
    const u = await understandChat(provider, {
      transcript: c.transcript,
      userText: c.userText,
    });

    const intentOk = u.intent === c.intent;
    if (intentOk) intentHit++;

    // 实体级比对（email 小写、phone 去非数字、name/org trim）
    let entityAllHit = true;
    for (const e of c.entities) {
      entityTotal++;
      const hit = u.contacts.some((x) => {
        const f =
          e.kind === "name"
            ? x.name
            : e.kind === "email"
              ? x.email
              : e.kind === "phone"
                ? x.phone
                : x.organization;
        if (f == null) return false;
        if (e.kind === "email") return f.trim().toLowerCase() === e.value.toLowerCase();
        if (e.kind === "phone") return f.replace(/\D/g, "") === e.value.replace(/\D/g, "");
        return f.trim() === e.value;
      });
      if (hit) entityHit++;
      else entityAllHit = false;
    }

    // 时间级比对
    let timeOk = false;
    if (c.time === null) {
      timeOk = u.meeting == null || u.meeting.start == null;
    } else if (u.meeting?.start) {
      timeOk = timeMatches(u.meeting.start, c.time);
    }
    if (timeOk) timeHit++;

    details.push({
      id: c.id,
      intent: { expected: c.intent, got: u.intent, ok: intentOk },
      entityOk: entityAllHit,
      timeOk,
      got: {
        intent: u.intent,
        contacts: u.contacts.map((x) => ({
          name: x.name,
          email: x.email,
          phone: x.phone,
          organization: x.organization,
        })),
        meetingStart: u.meeting?.start ?? null,
        missing: u.missing,
      },
    });
  }

  return {
    intentAccuracy: Number((intentHit / n).toFixed(4)),
    entityAccuracy: Number((entityHit / entityTotal).toFixed(4)),
    timeAccuracy: Number((timeHit / n).toFixed(4)),
    details,
  };
}

// ---------- 联系人解析评估（15 cases，确定性） ----------

async function runContactEval() {
  const createdIds: string[] = [];
  // 清理可能的残留种子（同名一并删除）
  const names = [...new Set(CONTACT_SEEDS.map((s) => s.name))];
  for (const name of names) {
    const existing = await prisma.contact.findMany({ where: { name } });
    for (const e of existing) await prisma.contact.delete({ where: { id: e.id } }).catch(() => {});
  }
  for (const s of CONTACT_SEEDS) {
    const c = await prisma.contact.create({
      data: {
        name: s.name,
        organization: s.organization,
        emails: s.email
          ? { create: [{ email: s.email, verified: true, active: true, source: "eval" }] }
          : undefined,
        phones: s.phone
          ? { create: [{ phone: s.phone, verified: true, active: true, source: "eval" }] }
          : undefined,
      },
    });
    createdIds.push(c.id);
  }

  let hit = 0;
  let ambHit = 0;
  let ambTotal = 0;
  const details: Array<Record<string, unknown>> = [];
  for (const c of CONTACT_CASES) {
    const res = await resolveContact(c.input);
    let ok = false;
    if (c.expected === "unique" && res.status === "unique" && res.contact.name === c.expectedName) ok = true;
    else if (c.expected === "not_found" && res.status === "not_found") ok = true;
    else if (c.expected === "ambiguous" && res.status === "ambiguous") ok = true;
    if (ok) hit++;
    if (c.expected === "ambiguous") {
      ambTotal++;
      if (res.status === "ambiguous") ambHit++;
    }
    details.push({ id: c.id, label: c.label, expected: c.expected, got: res.status, ok });
  }

  for (const id of createdIds) await prisma.contact.delete({ where: { id } }).catch(() => {});
  return {
    resolutionAccuracy: Number((hit / CONTACT_CASES.length).toFixed(4)),
    ambiguityDetectionAccuracy: ambTotal > 0 ? Number((ambHit / ambTotal).toFixed(4)) : 0,
    details,
  };
}

// ---------- 记忆检索评估（20 查询 × BM25/Embedding/Hybrid，限定独立语料） ----------

function memoryType(content: string): string {
  if (content.includes("邮箱") || content.includes("手机号")) return "contact_update";
  if (content.includes("会议") || content.includes("面试") || content.includes("站会")) return "meeting";
  if (content.includes("出差") || content.includes("提交") || content.includes("峰会") || content.includes("预算")) return "action";
  return "fact";
}

async function runRetrievalEval(provider: EmbeddingProvider) {
  const created: string[] = [];
  for (const content of EVAL70_MEMORIES) {
    const m = await prisma.memory.create({
      data: { type: memoryType(content), content, source: "eval", confidence: 1.0 },
    });
    created.push(m.id);
  }
  const idByContent = new Map(EVAL70_MEMORIES.map((c, i) => [c, created[i]]));

  // 仅回填本文件记忆（避免与并行文件的全库回填相互干扰）
  const missingEmbed = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM memories WHERE id IN (${Prisma.join(created)}) AND embedding IS NULL
  `;
  for (const row of missingEmbed) await embedMemory(row.id, provider);

  const cases = EVAL70_QUERIES.map((q) => ({
    query: q.query,
    relevantIds: q.relevantContent
      .map((c) => idByContent.get(c))
      .filter((id): id is string => Boolean(id)),
  }));
  const K = 5;

  const corpus = await prisma.memory.findMany({
    where: { id: { in: created } },
    select: { id: true, content: true },
  });
  const bm25Index = buildBm25Index(corpus.map((m) => ({ id: m.id, content: m.content })));

  const bm25 = await evaluateRetriever(
    "BM25",
    async (q) => searchBm25(bm25Index, q, { k: K }).map((h) => h.memoryId),
    cases,
    K,
  );
  const embedding = await evaluateRetriever(
    "Embedding",
    async (q) => (await searchMemories(provider, q, { k: K, contentIn: EVAL70_MEMORIES })).map((h) => h.id),
    cases,
    K,
  );
  const hybridSearcher = await createHybridSearcher(provider, { contentIn: EVAL70_MEMORIES });
  const hybrid = await evaluateRetriever(
    "Hybrid",
    async (q) => (await hybridSearcher.search(q, { k: K })).map((h) => h.memoryId),
    cases,
    K,
  );

  // 逐 query 审计：三通道均未召回的 miss 列表（用 Hybrid 代表整体，识别语料缺口）
  const contentById = new Map(created.map((id, i) => [id, EVAL70_MEMORIES[i]]));
  const missQueries: Array<{ query: string; expected: string[] }> = [];
  for (const c of cases) {
    const hits = (await hybridSearcher.search(c.query, { k: K })).map((h) => h.memoryId);
    const hitSet = new Set(hits);
    if (!c.relevantIds.some((id) => hitSet.has(id))) {
      missQueries.push({
        query: c.query,
        expected: c.relevantIds.map((id) => contentById.get(id) ?? ""),
      });
    }
  }

  for (const id of created) await prisma.memory.delete({ where: { id } }).catch(() => {});
  return { bm25, embedding, hybrid, missQueries };
}

// ---------- 工具安全评估（15 cases：Unauthorized Execution Rate + Verified Memory Precision） ----------

async function runToolSafetyEval() {
  const createdActions: string[] = [];
  const createdMeetings: string[] = [];
  const createdContacts: string[] = [];
  const details: Array<Record<string, unknown>> = [];

  let unauthorizedAttempts = 0;
  let unauthorizedSuccess = 0;
  let verifiedGenerated = 0;
  let verifiedValid = 0;

  const countVerified = async (actionId: string): Promise<number> => {
    const rows = await prisma.$queryRaw<Array<{ c: number }>>`
      SELECT count(*)::int AS c FROM memories WHERE metadata->>'actionId' = ${actionId}
    `;
    return Number(rows[0].c);
  };

  for (const c of TOOL_SAFETY_CASES) {
    const action = await prisma.action.create({
      data: { type: c.type, status: "DRAFT", payload: c.payload as Prisma.InputJsonValue, source: "eval" },
    });
    createdActions.push(action.id);

    if (c.expect.kind === "unauthorized") {
      // t05：先取消到 CANCELLED；t14：confirm 后手动置 EXECUTING（模拟状态机中间态）
      if (c.id === "t05") {
        await cancelAction(action.id);
      } else if (c.id === "t14") {
        await confirmAction(action.id);
        await prisma.action.update({ where: { id: action.id }, data: { status: "EXECUTING" } });
      }
      unauthorizedAttempts++;
      try {
        await executeWithTools(action.id);
        unauthorizedSuccess++;
        details.push({ id: c.id, label: c.label, expected: "unauthorized", got: "executed(意外)", ok: false });
      } catch (err) {
        if (err instanceof UnauthorizedExecutionError) {
          details.push({ id: c.id, label: c.label, expected: "unauthorized", got: "rejected", ok: true });
        } else {
          throw err;
        }
      }
      continue;
    }

    // success / fail：先确认
    await confirmAction(action.id);
    const result = await executeWithTools(action.id);

    if (c.expect.kind === "success") {
      const ok = result.ok === true;
      if (ok && c.expect.expectVerified) {
        const n = await countVerified(action.id);
        verifiedGenerated += 1;
        if (n >= 1) verifiedValid += 1;
        if (result.response) {
          const r = result.response as { meetingId?: string; contactId?: string };
          if (r.meetingId) createdMeetings.push(r.meetingId);
          if (r.contactId) createdContacts.push(r.contactId);
        }
      }
      // t15：成功后再执行一次 → 必须被状态机拒绝（SUCCESS 冻结）
      if (c.id === "t15") {
        unauthorizedAttempts++;
        try {
          await executeWithTools(action.id);
          unauthorizedSuccess++;
          details.push({ id: c.id, label: c.label, expected: "success+repeat-rejected", got: "repeat-executed(意外)", ok: false });
        } catch (err) {
          if (!(err instanceof UnauthorizedExecutionError)) throw err;
          details.push({ id: c.id, label: c.label, expected: "success+repeat-rejected", got: "success+rejected", ok: true });
        }
      } else {
        details.push({ id: c.id, label: c.label, expected: "success", got: ok ? "success" : "failed", ok });
      }
    } else {
      // fail：失败路径必须零沉淀（独立校验，不计入 Precision 分子）
      const ok = result.ok === false;
      let zeroDeposit = true;
      if (ok) {
        const n = await countVerified(action.id);
        zeroDeposit = n === 0;
      }
      details.push({ id: c.id, label: c.label, expected: "fail", got: ok ? "failed" : "success(意外)", ok, zeroDeposit });
    }
  }

  const unauthorizedExecutionRate =
    unauthorizedAttempts > 0 ? Number((unauthorizedSuccess / unauthorizedAttempts).toFixed(4)) : 0;
  const verifiedMemoryPrecision =
    verifiedGenerated > 0 ? Number((verifiedValid / verifiedGenerated).toFixed(4)) : 1;

  // 清理：记忆（按 actionId）→ meetings/contacts → actions
  for (const id of createdActions) {
    const mems = await prisma.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM memories WHERE metadata->>'actionId' = ${id}
    `;
    for (const m of mems) await prisma.memory.delete({ where: { id: m.id } }).catch(() => {});
  }
  for (const id of createdMeetings) await prisma.meeting.delete({ where: { id } }).catch(() => {});
  for (const id of createdContacts) await prisma.contact.delete({ where: { id } }).catch(() => {});
  for (const id of createdActions) await prisma.action.delete({ where: { id } }).catch(() => {});

  return { unauthorizedExecutionRate, verifiedMemoryPrecision, details };
}

// ---------- 汇总 ----------

export interface Eval70Report {
  runAt: string;
  totals: { totalCases: number };
  understanding: Awaited<ReturnType<typeof runUnderstandingEval>> | null;
  contact: Awaited<ReturnType<typeof runContactEval>>;
  retrieval: Awaited<ReturnType<typeof runRetrievalEval>>;
  toolSafety: Awaited<ReturnType<typeof runToolSafetyEval>>;
}

export interface RunEval70Deps {
  provider: LLMProvider | null;
  embedding: EmbeddingProvider;
}

/** 70-case Evaluation：可重复运行（每次重建独立语料并清理） */
export async function runEval70(deps: RunEval70Deps): Promise<Eval70Report> {
  const report: Eval70Report = {
    runAt: new Date().toISOString(),
    totals: { totalCases: 70 },
    understanding: deps.provider ? await runUnderstandingEval(deps.provider) : null,
    contact: await runContactEval(),
    retrieval: await runRetrievalEval(deps.embedding),
    toolSafety: await runToolSafetyEval(),
  };
  return report;
}

/** 打印 Markdown 指标表并落盘 eval-report.json */
export async function emitEvalReport(report: Eval70Report): Promise<string> {
  const line = (name: string, recall: number, mrr: number) =>
    `| ${name} | ${recall.toFixed(4)} | ${mrr.toFixed(4)} |`;
  const md = [
    `# ActionMind 70-case Evaluation Report`,
    ``,
    `- runAt: ${report.runAt}`,
    `- totalCases: ${report.totals.totalCases}`,
    ``,
    `## Understanding（20 cases，真实 LLM）`,
    `| 指标 | 值 |`,
    `| --- | --- |`,
    report.understanding
      ? `| Intent Accuracy | ${report.understanding.intentAccuracy.toFixed(4)} |
| Entity Accuracy | ${report.understanding.entityAccuracy.toFixed(4)} |
| Time Accuracy | ${report.understanding.timeAccuracy.toFixed(4)} |`
      : `| (skipped: 无 DEEPSEEK_API_KEY) | - |`,
    ``,
    `## Contact Resolution（15 cases）`,
    `| 指标 | 值 |`,
    `| --- | --- |`,
    `| Resolution Accuracy | ${report.contact.resolutionAccuracy.toFixed(4)} |`,
    `| Ambiguity Detection Accuracy | ${report.contact.ambiguityDetectionAccuracy.toFixed(4)} |`,
    ``,
    `## Memory Retrieval（20 queries × Recall@5 / MRR@5）`,
    `| Channel | Recall@5 | MRR@5 |`,
    `| --- | --- | --- |`,
    line("BM25", report.retrieval.bm25.recallAtK, report.retrieval.bm25.mrrAtK),
    line("Embedding", report.retrieval.embedding.recallAtK, report.retrieval.embedding.mrrAtK),
    line("Hybrid", report.retrieval.hybrid.recallAtK, report.retrieval.hybrid.mrrAtK),
    ``,
    `## Tool Safety（15 cases）`,
    `| 指标 | 值 |`,
    `| --- | --- |`,
    `| Unauthorized Execution Rate | ${report.toolSafety.unauthorizedExecutionRate.toFixed(4)} |`,
    `| Verified Memory Precision | ${report.toolSafety.verifiedMemoryPrecision.toFixed(4)} |`,
  ].join("\n");

  await writeFile("eval-report.md", md, "utf8");
  await writeFile("eval-report.json", JSON.stringify(report, null, 2), "utf8");
  return md;
}
