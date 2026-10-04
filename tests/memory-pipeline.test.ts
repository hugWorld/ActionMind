import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "../src/server/db";
import {
  MEMORY_CONFIDENCE,
  MEMORY_SOURCE,
  confirmMemory,
  createCandidateMemory,
  isVerifiedMemory,
  stageOf,
  verifyMemory,
  MemoryPipelineError,
} from "../src/server/memory";

// Gate 5 — Memory Pipeline: Candidate → Confirmed → Verified
// 核心验证：Model Inference ≠ Verified Memory

describe("Task 5: Memory Pipeline", () => {
  const created: string[] = [];

  afterAll(async () => {
    for (const id of created) {
      await prisma.memory.delete({ where: { id } }).catch(() => {});
    }
    await prisma.$disconnect();
  });

  const mkCandidate = async () => {
    const m = await createCandidateMemory({
      type: "meeting",
      content: `与测试联系人开会-${Date.now().toString(36)}`,
      timestamp: new Date("2026-10-09T15:00:00+08:00"),
      metadata: { location: "Meeting Room 3" },
    });
    created.push(m.id);
    return m;
  };

  it("创建 Candidate：source=model_inferred, confidence=0.3, 不是 Verified", async () => {
    const m = await mkCandidate();
    expect(m.source).toBe(MEMORY_SOURCE.CANDIDATE);
    expect(m.confidence).toBe(MEMORY_CONFIDENCE.CANDIDATE);
    expect(stageOf(m)).toBe("candidate");
    expect(isVerifiedMemory(m)).toBe(false);
  });

  it("确认 → Confirmed：source=user_confirmed, confidence=0.8", async () => {
    const m = await mkCandidate();
    const confirmed = await confirmMemory(m.id);
    expect(confirmed.source).toBe(MEMORY_SOURCE.CONFIRMED);
    expect(confirmed.confidence).toBe(MEMORY_CONFIDENCE.CONFIRMED);
    expect(stageOf(confirmed)).toBe("confirmed");
    expect(isVerifiedMemory(confirmed)).toBe(false);
  });

  it("验证 → Verified：source=tool_verified, confidence=1.0", async () => {
    const m = await mkCandidate();
    await confirmMemory(m.id);
    const verified = await verifyMemory(m.id);
    expect(verified.source).toBe(MEMORY_SOURCE.VERIFIED);
    expect(verified.confidence).toBe(MEMORY_CONFIDENCE.VERIFIED);
    expect(stageOf(verified)).toBe("verified");
    expect(isVerifiedMemory(verified)).toBe(true);
  });

  it("Gate 5 核心：Model Inference ≠ Verified Memory（Candidate 不可直接验证）", async () => {
    const m = await mkCandidate(); // 模型推断的记忆
    expect(isVerifiedMemory(m)).toBe(false); // 绝不视为 Verified
    await expect(verifyMemory(m.id)).rejects.toBeInstanceOf(MemoryPipelineError);
    // 状态未被破坏
    const after = await prisma.memory.findUniqueOrThrow({ where: { id: m.id } });
    expect(after.source).toBe(MEMORY_SOURCE.CANDIDATE);
  });

  it("已确认记忆重复确认 → 拒绝（不可降级/重复提升）", async () => {
    const m = await mkCandidate();
    await confirmMemory(m.id);
    await expect(confirmMemory(m.id)).rejects.toBeInstanceOf(MemoryPipelineError);
  });

  it("已验证记忆再验证 → 拒绝", async () => {
    const m = await mkCandidate();
    await confirmMemory(m.id);
    await verifyMemory(m.id);
    await expect(verifyMemory(m.id)).rejects.toBeInstanceOf(MemoryPipelineError);
    const after = await prisma.memory.findUniqueOrThrow({ where: { id: m.id } });
    expect(isVerifiedMemory(after)).toBe(true);
  });
});
