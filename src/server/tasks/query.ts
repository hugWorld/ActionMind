// Task 18 (Stage A) — 任务/日程查询（单一数据源）
//
// 需求十一：Chat 与 Schedule 必须共享同一数据源 —— Agent 的 task_search
// 与 /api/tasks（Schedule 页面）都调用本模块 queryTasks，统一查询 PostgreSQL。
// 复用既有 meetings 表（task_type 列），不新建第二套数据。

import { prisma } from "../db";
import { isTaskType, toTaskStatusView, type TaskQuery, type TaskView } from "./types";

/** 把 DB 行转成 TaskView（供 task_search / schedule 视图使用） */
function toTaskView(row: {
  id: string;
  title: string;
  taskType: string;
  startAt: Date;
  endAt: Date | null;
  location: string | null;
  notes: string | null;
  status: string;
  contactId: string | null;
  contact?: { name: string } | null;
  createdAt: Date;
}): TaskView {
  return {
    id: row.id,
    title: row.title,
    taskType: isTaskType(row.taskType) ? row.taskType : "MEETING",
    startAt: row.startAt.toISOString(),
    endAt: row.endAt?.toISOString() ?? null,
    location: row.location,
    notes: row.notes,
    status: row.status,
    statusView: toTaskStatusView(row.status),
    contactId: row.contactId,
    contactName: row.contact?.name ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

/** "YYYY-MM-DD"（Asia/Shanghai）→ UTC 边界 [start, endExclusive) */
function dayRangeUtc(dateStr: string): [Date, Date] | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return null;
  const startCn = new Date(`${dateStr}T00:00:00+08:00`);
  const endCn = new Date(`${dateStr}T00:00:00+08:00`);
  endCn.setDate(endCn.getDate() + 1);
  if (Number.isNaN(startCn.getTime())) return null;
  return [startCn, endCn];
}

/** 视图状态 → DB 状态（CONFIRMED 指 DB 的 scheduled） */
function dbStatusOf(statusView: string): string | null {
  switch (statusView) {
    case "CONFIRMED":
      return "scheduled";
    case "COMPLETED":
      return "completed";
    case "CANCELLED":
      return "cancelled";
    default:
      return null; // 未知状态不按状态过滤（容忍）
  }
}

/**
 * 查询任务/日程（共享查询核心）。
 * 默认排除 CANCELLED（需求十：CANCELLED 不消失但默认不展示）。
 */
export async function queryTasks(q: TaskQuery): Promise<TaskView[]> {
  const where: Record<string, unknown> = {};

  if (q.id) where.id = q.id;

  if (q.title?.trim()) {
    where.title = { contains: q.title.trim(), mode: "insensitive" };
  }

  if (q.contactId) {
    where.contactId = q.contactId;
  } else if (q.contactName?.trim()) {
    where.contact = { is: { name: { contains: q.contactName.trim(), mode: "insensitive" } } };
  }

  if (q.taskType && isTaskType(q.taskType)) where.taskType = q.taskType;

  // 状态过滤：视图状态（CONFIRMED/COMPLETED/CANCELLED）或 DB 值（scheduled/completed/cancelled）
  const rawStatus = q.status ? dbStatusOf(q.status) : null;
  const statusFilter = rawStatus ?? (q.status ? q.status : undefined);
  if (statusFilter) {
    where.status = statusFilter;
  } else if (!q.includeCancelled && !q.id) {
    where.status = { not: "cancelled" }; // 默认隐藏已取消（需求十）
  }

  // 时间范围（startAt ∈ [startDate 00:00, endDate+1 00:00) UTC）
  const timeConds: Array<Record<string, unknown>> = [];
  if (q.startDate) {
    const [s] = dayRangeUtc(q.startDate) ?? [];
    if (s) timeConds.push({ startAt: { gte: s } });
  }
  if (q.endDate) {
    const [, e] = dayRangeUtc(q.endDate) ?? [];
    if (e) timeConds.push({ startAt: { lt: e } });
  }
  if (q.startTime) {
    const t = new Date(q.startTime);
    if (!Number.isNaN(t.getTime())) timeConds.push({ startAt: { gte: t } });
  }
  if (timeConds.length > 0) where.AND = timeConds;

  const rows = await prisma.meeting.findMany({
    where: where as never,
    include: { contact: { select: { name: true } } },
    orderBy: { startAt: "asc" },
    take: q.limit ?? 50,
  });

  return rows.map(toTaskView);
}

/** 按 id 精确查一个任务（取消/修改工具定位用）；不存在返回 null */
export async function findTaskById(id: string): Promise<TaskView | null> {
  const rows = await queryTasks({ id, includeCancelled: true, limit: 1 });
  return rows[0] ?? null;
}
