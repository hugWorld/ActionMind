import type { Prisma } from "@prisma/client";
import { prisma } from "../db";
import { viewAction } from "../actions";
import { executeAction } from "../execution";
import { resolveContact } from "../contacts/resolve";
import { createVerifiedMemory } from "../memory";
import { embedOne, type EmbeddingProvider } from "../embedding";

// Task 12 — Tool Executor
// PostgreSQL-backed Tools（mock 设备能力，不调用真实 Windows 日历/联系人 API）：
//   create_event   → meetings 表
//   create_contact → contacts + emails/phones 子表
//   update_contact → 定位联系人后新增渠道/更新字段
// 真实副作用全部沉淀在 PostgreSQL，为 Task 13 Verified Memory 提供 tool_verified 依据。

export class ToolExecutionError extends Error {
  constructor(
    message: string,
    public readonly code: "TOOL_INPUT" | "TOOL_TARGET" = "TOOL_INPUT",
  ) {
    super(message);
    this.name = "ToolExecutionError";
  }
}

type ActionLike = { id: string; type: string; payload: Prisma.JsonValue };

function payloadOf(action: ActionLike): Record<string, unknown> {
  return (action.payload ?? {}) as Record<string, unknown>;
}

/** 合并顶层字段与 contact 嵌套字段（嵌套优先），兼容两种 payload 写法 */
function mergedPayload(p: Record<string, unknown>): Record<string, unknown> {
  const nested =
    typeof p.contact === "object" && p.contact !== null && !Array.isArray(p.contact)
      ? (p.contact as Record<string, unknown>)
      : {};
  return { ...p, ...nested };
}

function isoDate(value: unknown, label: string): Date {
  if (typeof value !== "string" || !value.trim()) throw new ToolExecutionError(`缺少${label}`);
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) throw new ToolExecutionError(`${label}不是有效时间`);
  return d;
}

function stringsOf(value: unknown): string[] {
  if (value == null) return [];
  const arr = Array.isArray(value) ? value : [value];
  return arr
    .filter((x): x is string => typeof x === "string" && x.trim() !== "")
    .map((s) => s.trim());
}

// ---------- create_event ----------

export async function createEvent(action: ActionLike) {
  const p = payloadOf(action);
  const title =
    (typeof p.title === "string" && p.title.trim() ? p.title.trim() : null) ??
    (typeof p.summary === "string" && p.summary.trim() ? p.summary.trim() : null);
  if (!title) throw new ToolExecutionError("会议缺少标题（title）");
  const startAt = isoDate(p.start, "会议开始时间（start）");
  const endAt = p.end ? isoDate(p.end, "会议结束时间（end）") : null;
  const location = typeof p.location === "string" && p.location.trim() ? p.location.trim() : null;

  // 联系人：contactId 直接关联；否则按 name 确定性解析（ambiguous/not_found 不阻塞会议创建）
  let contactId: string | null = null;
  const c = (p.contact ?? {}) as Record<string, unknown>;
  if (typeof p.contactId === "string") contactId = p.contactId;
  else if (typeof c.contactId === "string") contactId = c.contactId;
  else if (typeof c.name === "string" && c.name.trim()) {
    const res = await resolveContact({
      name: c.name,
      email: typeof c.email === "string" ? c.email : undefined,
      phone: typeof c.phone === "string" ? c.phone : undefined,
    });
    if (res.status === "unique") contactId = res.contact.id;
  }

  const meeting = await prisma.meeting.create({
    data: {
      title,
      startAt,
      endAt,
      location,
      contactId,
      status: "scheduled",
      source: "tool_create_event",
      eventId: `mock:${Date.now()}`,
    },
    select: {
      id: true,
      title: true,
      startAt: true,
      endAt: true,
      location: true,
      contactId: true,
    },
  });
  return {
    meetingId: meeting.id,
    title: meeting.title,
    startAt: meeting.startAt.toISOString(),
    endAt: meeting.endAt?.toISOString() ?? null,
    location: meeting.location,
    contactId: meeting.contactId,
  };
}

// ---------- create_contact ----------

export async function createContact(action: ActionLike) {
  const p = mergedPayload(payloadOf(action));
  const name = typeof p.name === "string" && p.name.trim() ? p.name.trim() : null;
  if (!name) throw new ToolExecutionError("联系人缺少姓名（name）");
  const organization =
    typeof p.organization === "string" && p.organization.trim() ? p.organization.trim() : null;
  const role = typeof p.role === "string" && p.role.trim() ? p.role.trim() : null;
  const emails = stringsOf(p.email ?? p.emails);
  const phones = stringsOf(p.phone ?? p.phones);

  const contact = await prisma.contact.create({
    data: {
      name,
      organization,
      role,
      emails: {
        create: emails.map((email) => ({
          email,
          verified: false,
          active: true,
          source: "tool_create_contact",
        })),
      },
      phones: {
        create: phones.map((phone) => ({
          phone,
          verified: false,
          active: true,
          source: "tool_create_contact",
        })),
      },
    },
    select: {
      id: true,
      name: true,
      organization: true,
      emails: { select: { email: true } },
      phones: { select: { phone: true } },
    },
  });
  return {
    contactId: contact.id,
    name: contact.name,
    organization: contact.organization,
    emails: contact.emails.map((e) => e.email),
    phones: contact.phones.map((ph) => ph.phone),
  };
}

// ---------- update_contact ----------

export async function updateContact(action: ActionLike) {
  const p = mergedPayload(payloadOf(action));

  // 定位目标：contactId 优先，否则确定性解析（name/email/phone/organization）
  let targetId: string | null =
    typeof p.contactId === "string" ? p.contactId : null;
  if (!targetId) {
    const res = await resolveContact({
      name: typeof p.name === "string" ? p.name : null,
      email: typeof p.email === "string" ? p.email : null,
      phone: typeof p.phone === "string" ? p.phone : null,
      organization: typeof p.organization === "string" ? p.organization : null,
    });
    if (res.status === "not_found") {
      throw new ToolExecutionError("更新目标联系人不存在（not_found），无法更新", "TOOL_TARGET");
    }
    if (res.status === "ambiguous") {
      throw new ToolExecutionError("更新目标联系人存在歧义（ambiguous），无法更新", "TOOL_TARGET");
    }
    targetId = res.contact.id;
  }

  const contact = await prisma.contact.findUnique({ where: { id: targetId } });
  if (!contact) throw new ToolExecutionError(`联系人 ${targetId} 不存在`, "TOOL_TARGET");

  const organization =
    typeof p.organization === "string" && p.organization.trim() ? p.organization.trim() : null;
  const role = typeof p.role === "string" && p.role.trim() ? p.role.trim() : null;
  const addEmails = stringsOf(p.email ?? p.emails);
  const addPhones = stringsOf(p.phone ?? p.phones);
  const addedEmails: string[] = [];
  const addedPhones: string[] = [];

  await prisma.$transaction(async (tx) => {
    if (organization !== null || role !== null) {
      await tx.contact.update({
        where: { id: targetId },
        data: {
          organization: organization ?? contact.organization,
          role: role ?? contact.role,
        },
      });
    }
    for (const email of addEmails) {
      const exists = await tx.contactEmail.findFirst({
        where: { contactId: targetId, email: { equals: email, mode: "insensitive" } },
      });
      if (!exists) {
        await tx.contactEmail.create({
          data: { contactId: targetId, email, verified: false, active: true, source: "tool_update_contact" },
        });
        addedEmails.push(email);
      }
    }
    for (const phone of addPhones) {
      const exists = await tx.contactPhone.findFirst({ where: { contactId: targetId, phone } });
      if (!exists) {
        await tx.contactPhone.create({
          data: { contactId: targetId, phone, verified: false, active: true, source: "tool_update_contact" },
        });
        addedPhones.push(phone);
      }
    }
  });

  const updated = await prisma.contact.findUniqueOrThrow({
    where: { id: targetId },
    select: {
      id: true,
      name: true,
      organization: true,
      role: true,
      emails: { where: { active: true }, select: { email: true } },
      phones: { where: { active: true }, select: { phone: true } },
    },
  });
  return {
    contactId: updated.id,
    name: updated.name,
    organization: updated.organization,
    role: updated.role,
    emails: updated.emails.map((e) => e.email),
    phones: updated.phones.map((ph) => ph.phone),
    addedEmails,
    addedPhones,
  };
}

// ---------- Task 13 — Tool Success → Verified Memory ----------

function fmtDateTime(d: Date): string {
  return d.toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false });
}

/**
 * 工具执行成功后，把真实发生的结果沉淀为 Verified Memory（source=tool_verified, confidence=1.0）。
 * 失败路径（result.ok=false）不调用本函数 → 不生成 Verified Memory。
 */
async function recordVerifiedMemory(
  action: ActionLike,
  response: unknown,
  embeddingProvider?: EmbeddingProvider,
): Promise<void> {
  const p = mergedPayload(payloadOf(action));
  const embed = embeddingProvider
    ? (content: string) => embedOne(embeddingProvider, content)
    : undefined;

  switch (action.type) {
    case "CREATE_MEETING": {
      const r = response as {
        meetingId: string;
        title: string;
        startAt: string;
        endAt: string | null;
        location: string | null;
        contactId: string | null;
      };
      const contactName = typeof p.name === "string" && p.name.trim() ? p.name.trim() : null;
      const when = fmtDateTime(new Date(r.startAt));
      const content =
        `已预约会议「${r.title}」：${when}` +
        (r.location ? `，地点：${r.location}` : "") +
        (contactName ? `，对象：${contactName}` : "");
      await createVerifiedMemory(
        {
          type: "meeting",
          contactId: r.contactId,
          content,
          timestamp: new Date(r.startAt),
          metadata: { meetingId: r.meetingId, actionId: action.id },
        },
        { embed },
      );
      break;
    }
    case "CREATE_CONTACT": {
      const r = response as {
        contactId: string;
        name: string;
        organization: string | null;
        emails: string[];
        phones: string[];
      };
      const content =
        `已创建联系人 ${r.name}` +
        (r.organization ? `（${r.organization}）` : "") +
        (r.emails.length ? `，邮箱：${r.emails.join("、")}` : "") +
        (r.phones.length ? `，电话：${r.phones.join("、")}` : "");
      await createVerifiedMemory(
        {
          type: "contact_update",
          contactId: r.contactId,
          content,
          metadata: { contactId: r.contactId, actionId: action.id },
        },
        { embed },
      );
      break;
    }
    case "UPDATE_CONTACT": {
      const r = response as {
        contactId: string;
        name: string;
        organization: string | null;
        addedEmails: string[];
        addedPhones: string[];
      };
      const changes: string[] = [];
      if (r.addedEmails.length) changes.push(`新增邮箱：${r.addedEmails.join("、")}`);
      if (r.addedPhones.length) changes.push(`新增电话：${r.addedPhones.join("、")}`);
      if (r.organization) changes.push(`组织变更为：${r.organization}`);
      const content = `联系人 ${r.name} 已更新${changes.length ? `（${changes.join("；")}）` : ""}`;
      await createVerifiedMemory(
        {
          type: "contact_update",
          contactId: r.contactId,
          content,
          metadata: { contactId: r.contactId, actionId: action.id },
        },
        { embed },
      );
      break;
    }
  }
}

// ---------- 分发与统一执行入口 ----------

export function toolForAction(action: ActionLike): {
  toolName: string;
  run: (a: ActionLike) => Promise<unknown>;
} {
  switch (action.type) {
    case "CREATE_MEETING":
      return { toolName: "create_event", run: createEvent };
    case "CREATE_CONTACT":
      return { toolName: "create_contact", run: createContact };
    case "UPDATE_CONTACT":
      return { toolName: "update_contact", run: updateContact };
    default:
      throw new ToolExecutionError(`未知 Action 类型：${action.type}`);
  }
}

/**
 * Gate 12 统一入口：按 Action 类型自动选择 PostgreSQL-backed 工具并执行。
 * 链路：Action(已 CONFIRMED) → Executor(守卫) → Tool → Result(Execution 留痕)
 * Gate 13：工具成功 → 沉淀 Verified Memory（source=tool_verified, confidence=1.0，可选即时 embedding）；
 *          失败 → 不生成 Verified Memory。
 */
export async function executeWithTools(
  actionId: string,
  deps: { embeddingProvider?: EmbeddingProvider } = {},
) {
  const action = await viewAction(actionId);
  const { toolName, run } = toolForAction(action);
  const result = await executeAction(actionId, { toolName, run });
  if (result.ok && result.response !== undefined) {
    await recordVerifiedMemory(action, result.response, deps.embeddingProvider);
  }
  return result;
}
