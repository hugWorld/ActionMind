import type { Prisma } from "@prisma/client";
import { prisma } from "../db";

// ---------- 类型 ----------

export interface ContactResolutionInput {
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  organization?: string | null;
}

export interface ContactWithChannels {
  id: string;
  name: string;
  organization: string | null;
  role: string | null;
  emails: Array<{ email: string; verified: boolean }>;
  phones: Array<{ phone: string; verified: boolean }>;
}

export type ContactResolution =
  | { status: "unique"; contact: ContactWithChannels }
  | { status: "ambiguous"; candidates: ContactWithChannels[] }
  | { status: "not_found" };

// ---------- 归一化 ----------

const normalizeEmail = (s: string): string => s.trim().toLowerCase();
const normalizePhone = (s: string): string => s.replace(/[^0-9+]/g, "");
const normalizeText = (s: string): string => s.trim();

// 只返回 active 的联系方式
const CHANNEL_INCLUDE = {
  emails: {
    where: { active: true },
    select: { email: true, verified: true },
  },
  phones: {
    where: { active: true },
    select: { phone: true, verified: true },
  },
} satisfies Prisma.ContactInclude;

// ---------- 解析 ----------

/**
 * Contact Resolution（Task 4 / Gate 4）
 *
 * 确定性优先级：邮箱（最强标识）→ 电话 → 姓名 → 公司（最弱）。
 * - 当前优先级通道命中 1 个 → unique；
 * - 命中 >1 个 → ambiguous（返回候选列表）；
 * - 全部未命中 → not_found。
 * 归一化：邮箱 trim+小写（DB insensitive 匹配）；电话去空格/连字符等非数字字符；
 * 姓名/公司 trim + 大小写不敏感。
 */
export async function resolveContact(
  input: ContactResolutionInput,
): Promise<ContactResolution> {
  // 1) 邮箱
  if (input.email?.trim()) {
    const email = normalizeEmail(input.email);
    const rows = await prisma.contactEmail.findMany({
      where: { email: { equals: email, mode: "insensitive" }, active: true },
      select: { contactId: true },
    });
    const ids = [...new Set(rows.map((r) => r.contactId))];
    if (ids.length > 0) return pick(ids);
  }

  // 2) 电话（库内可能带格式，按归一化值在内存中比对）
  if (input.phone?.trim()) {
    const target = normalizePhone(input.phone);
    const rows = await prisma.contactPhone.findMany({
      where: { active: true },
      select: { contactId: true, phone: true },
    });
    const ids = [
      ...new Set(
        rows.filter((r) => normalizePhone(r.phone) === target).map((r) => r.contactId),
      ),
    ];
    if (ids.length > 0) return pick(ids);
  }

  // 3) 姓名
  if (input.name?.trim()) {
    const rows = await prisma.contact.findMany({
      where: { name: { equals: normalizeText(input.name), mode: "insensitive" } },
      select: { id: true },
    });
    if (rows.length > 0) return pick(rows.map((r) => r.id));
  }

  // 4) 公司（兜底）
  if (input.organization?.trim()) {
    const rows = await prisma.contact.findMany({
      where: {
        organization: {
          equals: normalizeText(input.organization),
          mode: "insensitive",
        },
      },
      select: { id: true },
    });
    if (rows.length > 0) return pick(rows.map((r) => r.id));
  }

  return { status: "not_found" };
}

async function pick(ids: string[]): Promise<ContactResolution> {
  if (ids.length === 1) {
    const contact = await prisma.contact.findUniqueOrThrow({
      where: { id: ids[0] },
      include: CHANNEL_INCLUDE,
    });
    return { status: "unique", contact };
  }
  const candidates = await prisma.contact.findMany({
    where: { id: { in: ids } },
    include: CHANNEL_INCLUDE,
  });
  return { status: "ambiguous", candidates };
}
