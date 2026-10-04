import type { Prisma } from "@prisma/client";
import { prisma } from "../db";

// Task 10 — Action Card：View / Edit / Cancel / Confirm
// 可编辑字段白名单（Gate 10：Time / Location / Contact / Title + 扩展）

export const ACTION_CARD_FIELDS = [
  "title",
  "start",
  "end",
  "location",
  "contact",
  "notes",
  "missing",
] as const;

export type ActionCardField = (typeof ACTION_CARD_FIELDS)[number];

export interface ActionCardPayload {
  title?: string | null;
  start?: string | null;
  end?: string | null;
  location?: string | null;
  contact?: {
    name: string;
    contactId?: string;
    email?: string;
    phone?: string;
  } | null;
  notes?: string | null;
  missing?: string[] | null;
  [key: string]: unknown; // type 等扩展字段原样保留
}

export class ActionCardError extends Error {
  constructor(
    message: string,
    public readonly code: "NOT_FOUND" | "INVALID_STATE" | "INVALID_FIELDS",
  ) {
    super(message);
    this.name = "ActionCardError";
  }
}

function validateFieldValue(field: ActionCardField, value: unknown): void {
  if (value === null || value === undefined) return; // 允许置空
  switch (field) {
    case "title":
    case "start":
    case "end":
    case "location":
    case "notes":
      if (typeof value !== "string") {
        throw new ActionCardError(`${field} 必须是字符串`, "INVALID_FIELDS");
      }
      break;
    case "contact":
      if (typeof value !== "object" || Array.isArray(value) || value === null) {
        throw new ActionCardError("contact 必须是对象（{name, contactId?, email?, phone?}）", "INVALID_FIELDS");
      }
      break;
    case "missing":
      if (!Array.isArray(value) || !value.every((x) => typeof x === "string")) {
        throw new ActionCardError("missing 必须是字符串数组", "INVALID_FIELDS");
      }
      break;
  }
}

/** View：按 id 读取 Action（不存在 → NOT_FOUND） */
export async function viewAction(id: string) {
  const action = await prisma.action.findUnique({ where: { id } });
  if (!action) throw new ActionCardError("Action 不存在", "NOT_FOUND");
  return action;
}

/** View：列表（可按 status 过滤），按创建时间倒序 */
export async function listActions(filter: { status?: string } = {}) {
  return prisma.action.findMany({
    where: filter.status ? { status: filter.status } : undefined,
    orderBy: { createdAt: "desc" },
  });
}

/**
 * Edit：仅 DRAFT 可编辑；字段必须在白名单内；
 * 每次编辑记录证据（evidence.edits：at/field/from/to），其他字段原样保留。
 */
export async function updateActionFields(id: string, patch: Record<string, unknown>) {
  const action = await viewAction(id);
  if (action.status !== "DRAFT") {
    throw new ActionCardError(`只有 DRAFT 状态的卡片可编辑（当前 ${action.status}）`, "INVALID_STATE");
  }
  const badKeys = Object.keys(patch).filter(
    (k) => !ACTION_CARD_FIELDS.includes(k as ActionCardField),
  );
  if (badKeys.length > 0) {
    throw new ActionCardError(`不支持编辑的字段: ${badKeys.join(", ")}`, "INVALID_FIELDS");
  }
  for (const [k, v] of Object.entries(patch)) {
    validateFieldValue(k as ActionCardField, v);
  }

  const payload = { ...(action.payload as Record<string, unknown>) };
  const evidence =
    (action.evidence as { edits?: Array<Record<string, unknown>> } | null) ?? {};
  const edits = [...(Array.isArray(evidence.edits) ? evidence.edits : [])];

  for (const [k, v] of Object.entries(patch)) {
    const old = payload[k];
    if (JSON.stringify(old) !== JSON.stringify(v)) {
      edits.push({
        at: new Date().toISOString(),
        field: k,
        from: old ?? null,
        to: v ?? null,
      });
      payload[k] = v;
    }
  }

  return prisma.action.update({
    where: { id },
    data: {
      payload: payload as Prisma.InputJsonValue,
      evidence: { ...evidence, edits } as Prisma.InputJsonValue,
    },
  });
}

/** Confirm：DRAFT → CONFIRMED（Task 11 起执行前必须 CONFIRMED） */
export async function confirmAction(id: string) {
  const action = await viewAction(id);
  if (action.status !== "DRAFT") {
    throw new ActionCardError(`只有 DRAFT 状态的卡片可确认（当前 ${action.status}）`, "INVALID_STATE");
  }
  return prisma.action.update({ where: { id }, data: { status: "CONFIRMED" } });
}

/** Cancel：DRAFT → CANCELLED */
export async function cancelAction(id: string) {
  const action = await viewAction(id);
  if (action.status !== "DRAFT") {
    throw new ActionCardError(`只有 DRAFT 状态的卡片可取消（当前 ${action.status}）`, "INVALID_STATE");
  }
  return prisma.action.update({ where: { id }, data: { status: "CANCELLED" } });
}
