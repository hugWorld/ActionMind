import type { LLMProvider } from "../llm/types";
import { InsightsOutputSchema, type Insight } from "./schema";

// Task 14 — Evidence-grounded Insight
// 基于检索到的真实记忆生成事实性洞察；每条 Insight 必须引用真实存在的 Memory（PRD §36）。

export interface InsightMemory {
  id: string;
  content: string;
  source?: string | null;
  confidence?: number | null;
  type?: string | null;
}

export interface GeneratedInsight {
  claim: string;
  /** 引用的 Memory id（保证全部真实存在于库） */
  evidenceIds: string[];
}

export interface InsightsResult {
  insights: GeneratedInsight[];
  /** 无证据时固定为「暂无可靠依据。」 */
  note: string;
}

export const NO_EVIDENCE_NOTE = "暂无可靠依据。";

/**
 * 证据过滤（纯函数）：仅保留「全部 evidenceIds 都属于可用记忆 id」的洞察。
 * 任何一条证据编造/不存在 → 整条剔除（严格模式，杜绝幻觉污染输出）。
 * 这是「每条 Insight 必须引用真实 Memory」的确定性保证（不依赖 LLM 自觉）。
 */
export function filterInsightsByEvidence(
  insights: Insight[],
  availableIds: ReadonlySet<string>,
): GeneratedInsight[] {
  return insights
    .filter(
      (i) => i.evidenceIds.length > 0 && i.evidenceIds.every((id) => availableIds.has(id)),
    )
    .map((i) => ({ claim: i.claim, evidenceIds: i.evidenceIds }));
}

export interface GenerateInsightsOptions {
  question: string;
  /** 检索到的记忆（id 必须对应库中真实记录） */
  memories: InsightMemory[];
  provider: LLMProvider;
  maxRetries?: number;
}

/**
 * 基于真实记忆生成 Evidence-grounded Insight：
 * - 无任何记忆 → 不调用 LLM，直接返回「暂无可靠依据。」；
 * - LLM 输出经 filterInsightsByEvidence 过滤，编造的证据 id 一律剔除；
 * - 全部被剔除或 LLM 判定无关 → 「暂无可靠依据。」。
 * 禁止无记忆支撑的心理/社交推断（PRD §36）。
 */
export async function generateInsights(
  opts: GenerateInsightsOptions,
): Promise<InsightsResult> {
  const { question, memories, provider } = opts;
  if (memories.length === 0) {
    return { insights: [], note: NO_EVIDENCE_NOTE };
  }

  const idSet = new Set(memories.map((m) => m.id));
  const memoryLines = memories
    .map((m) => {
      const tag =
        m.source != null
          ? `（来源：${m.source}${m.confidence != null ? `，置信度：${m.confidence}` : ""}）`
          : m.confidence != null
            ? `（置信度：${m.confidence}）`
            : "";
      return `- [${m.id}] ${m.content}${tag}`;
    })
    .join("\n");

  const system = [
    "你是个人事务洞察助手。任务：基于【提供的记忆】回答用户问题，生成简短、确定、事实性的洞察（Insight）。",
    "硬性约束：",
    "1. 每条洞察的 evidenceIds 必须引用上方记忆列表中的 memory id（可多条），严禁编造不存在的 id；",
    "2. 只能陈述记忆中有依据的事实，禁止心理分析、性格推断、社交猜测等无记忆支撑的判断；",
    "3. 若记忆与问题无关或证据不足，返回空 insights 并在 note 中写明「暂无可靠依据。」；",
    "4. claim 用中文，一句话，不超过 60 字。",
  ].join("\n");
  const user = `用户问题：${question}\n\n可用记忆：\n${memoryLines}`;

  const raw = await provider.structured({
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    schema: InsightsOutputSchema,
    temperature: 0.2,
    maxRetries: opts.maxRetries ?? 1,
  });

  const insights = filterInsightsByEvidence(raw.insights, idSet);
  if (insights.length === 0) {
    const note = raw.note && raw.note.trim() ? raw.note.trim() : NO_EVIDENCE_NOTE;
    return { insights: [], note };
  }
  return { insights, note: "" };
}
