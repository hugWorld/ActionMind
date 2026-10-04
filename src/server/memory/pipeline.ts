import type { Memory, Prisma } from "@prisma/client";
import { prisma } from "../db";
import { toPgVector } from "../embedding/provider";

// ---------- 三级状态（Task 5 / Gate 5） ----------
// Candidate（模型推断/截图提取，低置信） → Confirmed（用户确认） → Verified（工具验证成功）
// 核心不变式：Model Inference ≠ Verified Memory ——
//   模型推断的记忆永远只是 Candidate，必须经用户确认后才能升级为 Verified。

export const MEMORY_SOURCE = {
  CANDIDATE: "model_inferred",
  CONFIRMED: "user_confirmed",
  VERIFIED: "tool_verified",
} as const;

export const MEMORY_CONFIDENCE = {
  CANDIDATE: 0.3,
  CONFIRMED: 0.8,
  VERIFIED: 1.0,
} as const;

export type MemoryStage = "candidate" | "confirmed" | "verified";

export interface MemoryLike {
  source: string;
  confidence: number;
}

/** 由 source/confidence 判定记忆所处阶段 */
export function stageOf(memory: MemoryLike): MemoryStage {
  if (memory.source === MEMORY_SOURCE.VERIFIED) return "verified";
  if (memory.source === MEMORY_SOURCE.CONFIRMED) return "confirmed";
  return "candidate";
}

/** 是否 Verified Memory（仅 tool_verified 为真） */
export function isVerifiedMemory(memory: MemoryLike): boolean {
  return memory.source === MEMORY_SOURCE.VERIFIED;
}

export class MemoryPipelineError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MemoryPipelineError";
  }
}

// ---------- 创建与升级 ----------

export interface CreateCandidateInput {
  type: string;
  contactId?: string;
  content: string;
  timestamp?: Date;
  metadata?: Record<string, unknown>;
}

/** 理解结果 → Candidate Memory（模型推断，低置信） */
export async function createCandidateMemory(
  input: CreateCandidateInput,
): Promise<Memory> {
  return prisma.memory.create({
    data: {
      type: input.type,
      contactId: input.contactId,
      content: input.content,
      timestamp: input.timestamp,
      source: MEMORY_SOURCE.CANDIDATE,
      confidence: MEMORY_CONFIDENCE.CANDIDATE,
      metadata: (input.metadata ?? undefined) as Prisma.InputJsonValue | undefined,
    },
  });
}

/** 用户确认 → Confirmed Memory（仅 Candidate 可升级） */
export async function confirmMemory(id: string): Promise<Memory> {
  const memory = await prisma.memory.findUniqueOrThrow({ where: { id } });
  if (stageOf(memory) !== "candidate") {
    throw new MemoryPipelineError(
      `只有 Candidate 记忆可以确认，当前为 ${memory.source}`,
    );
  }
  return prisma.memory.update({
    where: { id },
    data: {
      source: MEMORY_SOURCE.CONFIRMED,
      confidence: MEMORY_CONFIDENCE.CONFIRMED,
    },
  });
}

/**
 * 工具验证成功 → Verified Memory（仅 Confirmed 可升级；模型推断不可直接成为 Verified）
 * 注：Tool Success 直接落库的 Verified Memory 属 Task 13 路径（来源为工具而非模型）。
 */
export async function verifyMemory(id: string): Promise<Memory> {
  const memory = await prisma.memory.findUniqueOrThrow({ where: { id } });
  if (stageOf(memory) !== "confirmed") {
    throw new MemoryPipelineError(
      `只有 Confirmed 记忆可以验证（Model Inference ≠ Verified Memory），当前为 ${memory.source}`,
    );
  }
  return prisma.memory.update({
    where: { id },
    data: {
      source: MEMORY_SOURCE.VERIFIED,
      confidence: MEMORY_CONFIDENCE.VERIFIED,
    },
  });
}

// ---------- Task 13 — Verified Memory（Tool Success 直接沉淀） ----------

export interface CreateVerifiedMemoryInput {
  type: string;
  contactId?: string | null;
  content: string;
  timestamp?: Date;
  metadata?: Record<string, unknown>;
}

export interface VerifiedMemoryResult {
  memory: Memory;
  /** false 表示已存在同 contact+content 的 Verified Memory（幂等跳过） */
  created: boolean;
}

/**
 * 工具执行成功 → Verified Memory（source=tool_verified, confidence=1.0）。
 * - 幂等：同 contactId+content 的 tool_verified 记忆已存在则跳过；
 * - 可选 embed 回调：传入则当场生成 embedding（pgvector 列必须走 $executeRaw）；
 * - 与 Task 5 的升级路径（Candidate→Confirmed→Verified）并列：工具事实链直接落库，
 *   不破坏「Model Inference ≠ Verified Memory」不变式（模型推断仍只能先成为 Candidate）。
 */
export async function createVerifiedMemory(
  input: CreateVerifiedMemoryInput,
  options?: { embed?: (content: string) => Promise<number[]> },
): Promise<VerifiedMemoryResult> {
  const existing = await prisma.memory.findFirst({
    where: {
      contactId: input.contactId ?? undefined,
      content: input.content,
      source: MEMORY_SOURCE.VERIFIED,
    },
  });
  if (existing) return { memory: existing, created: false };

  const memory = await prisma.memory.create({
    data: {
      type: input.type,
      contactId: input.contactId ?? undefined,
      content: input.content,
      timestamp: input.timestamp,
      source: MEMORY_SOURCE.VERIFIED,
      confidence: MEMORY_CONFIDENCE.VERIFIED,
      metadata: (input.metadata ?? undefined) as Prisma.InputJsonValue | undefined,
    },
  });

  if (options?.embed) {
    try {
      const vec = await options.embed(input.content);
      if (vec.length > 0) {
        await prisma.$executeRaw`
          UPDATE memories SET embedding = ${toPgVector(vec)}::vector WHERE id = ${memory.id}
        `;
      }
    } catch {
      // embedding 生成失败不影响 Verified Memory 本身（可稍后 embedMemoriesMissing 回填）
    }
  }
  return { memory, created: true };
}
