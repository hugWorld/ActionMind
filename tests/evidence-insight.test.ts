import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../src/server/db";
import { createDeepSeekProvider } from "../src/server/llm/deepseek";
import type { LLMProvider } from "../src/server/llm/types";
import {
  createVerifiedMemory,
  MEMORY_CONFIDENCE,
  MEMORY_SOURCE,
} from "../src/server/memory";
import {
  generateInsights,
  filterInsightsByEvidence,
  NO_EVIDENCE_NOTE,
} from "../src/server/insights";

// Gate 14 — Evidence-grounded Insight：每条 Insight 必须引用真实 Memory；无证据 → 「暂无可靠依据。」

describe("Task 14: Evidence-grounded Insight", () => {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  let provider: LLMProvider | null = null;
  const createdMemories: string[] = [];

  beforeAll(async () => {
    provider = apiKey ? createDeepSeekProvider() : null;
    if (!provider) console.warn("DEEPSEEK_API_KEY 缺失，真实 LLM 场景将跳过");
  });

  afterAll(async () => {
    for (const id of createdMemories) {
      await prisma.memory.delete({ where: { id } }).catch(() => {});
    }
    await prisma.$disconnect();
  });

  it("证据过滤（确定性）：编造/空证据的洞察被剔除，真实引用保留", () => {
    const available = new Set(["m_real_1", "m_real_2"]);
    const filtered = filterInsightsByEvidence(
      [
        { claim: "真实引用", evidenceIds: ["m_real_1", "m_real_2"] },
        { claim: "引用不存在的 id", evidenceIds: ["m_fake_1", "m_real_1"] },
        { claim: "完全编造", evidenceIds: ["m_fake_9"] },
        { claim: "无证据", evidenceIds: [] },
      ],
      available,
    );
    expect(filtered.length).toBe(1);
    expect(filtered[0].claim).toBe("真实引用");
    expect(filtered[0].evidenceIds).toEqual(["m_real_1", "m_real_2"]);
  });

  it("无任何记忆 → 不调 LLM，直接返回「暂无可靠依据。」", async () => {
    if (!provider) return;
    const result = await generateInsights({
      question: "我最近的安排？",
      memories: [],
      provider,
    });
    expect(result.insights.length).toBe(0);
    expect(result.note).toBe(NO_EVIDENCE_NOTE);
  });

  it("真实 LLM：基于真实 Verified Memory 生成洞察，每条 evidence 都引用库中真实记忆", async () => {
    if (!provider) return;
    // 构造真实记忆（tool_verified/1.0），唯一姓名避免并行冲突
    const m1 = await createVerifiedMemory({
      type: "meeting",
      content: "与周十一在 Meeting Room 3 讨论 Project A",
      timestamp: new Date("2026-09-28T15:00:00+08:00"),
      metadata: { test: "gate14" },
    });
    const m2 = await createVerifiedMemory({
      type: "contact_update",
      content: "周十一的新邮箱是 zhoushiyi@example.com",
      metadata: { test: "gate14" },
    });
    createdMemories.push(m1.memory.id, m2.memory.id);

    // LLM 偶发抖动：最多重试一次
    let result = await generateInsights({
      question: "我和周十一最近在哪里讨论项目？",
      memories: [
        { id: m1.memory.id, content: m1.memory.content, source: m1.memory.source, confidence: m1.memory.confidence },
        { id: m2.memory.id, content: m2.memory.content, source: m2.memory.source, confidence: m2.memory.confidence },
      ],
      provider,
    });
    if (result.insights.length === 0) {
      result = await generateInsights({
        question: "我和周十一最近在哪里讨论项目？",
        memories: [
          { id: m1.memory.id, content: m1.memory.content, source: m1.memory.source, confidence: m1.memory.confidence },
          { id: m2.memory.id, content: m2.memory.content, source: m2.memory.source, confidence: m2.memory.confidence },
        ],
        provider,
      });
    }
    expect(result.insights.length).toBeGreaterThan(0);

    for (const insight of result.insights) {
      expect(insight.claim.length).toBeGreaterThan(0);
      expect(insight.evidenceIds.length).toBeGreaterThan(0);
      for (const id of insight.evidenceIds) {
        // 证据必须引用真实存在的 Memory
        const real = await prisma.memory.findUnique({ where: { id } });
        expect(real, `evidence id=${id} 必须是库中真实记忆`).not.toBeNull();
      }
    }
    // 至少一条洞察以 Meeting Room 3 记忆为证据
    const usesMeeting = result.insights.some((i) => i.evidenceIds.includes(m1.memory.id));
    expect(usesMeeting).toBe(true);
  }, 120_000);

  it("记忆与问题无关 → 不强行编造洞察（insights 为空并给出说明）", async () => {
    if (!provider) return;
    const m = await createVerifiedMemory({
      type: "fact",
      content: "会议室隔壁的咖啡机周二补货",
      metadata: { test: "gate14" },
    });
    createdMemories.push(m.memory.id);

    let result = await generateInsights({
      question: "告诉我下个月股市会怎么走？",
      memories: [{ id: m.memory.id, content: m.memory.content, source: m.memory.source }],
      provider,
    });
    if (result.insights.length > 0) {
      // LLM 偶发给了无关洞察（会被证据过滤保留，因为确实引用该记忆）——重试一次，期望输出空
      result = await generateInsights({
        question: "告诉我下个月股市会怎么走？",
        memories: [{ id: m.memory.id, content: m.memory.content, source: m.memory.source }],
        provider,
      });
    }
    expect(result.insights.length).toBe(0);
    expect(result.note).toBeTruthy();
  }, 120_000);
});
