// Task 25 — Verifier：时间冲突检测核心（从 agent/tools.ts 提取，LLM Agent 工具与 Verifier 共同复用单一数据源 queryTasks）
import { queryTasks } from "./query";

export interface ConflictTaskView {
  id: string;
  title: string;
  startAt: string | null;
  endAt: string | null;
  location: string | null;
  statusView: string;
}

export interface FindConflictsInput {
  /** ISO 8601 时间点 */
  startAt: string;
  /** 可选；默认 = startAt + 30 分钟 */
  endAt?: string;
  /** 修改任务时排除自身 */
  excludeTaskId?: string;
}

/** 半开区间重叠判定：新任务 [ns, ne) 与已确认任务 [s, e) 相交即冲突 */
export async function findConflictingTasks(input: FindConflictsInput): Promise<{
  conflicted: boolean;
  conflicts: ConflictTaskView[];
}> {
  const ns = new Date(input.startAt).getTime();
  const ne = input.endAt ? new Date(input.endAt).getTime() : ns + 30 * 60_000;
  if (Number.isNaN(ns) || Number.isNaN(ne)) return { conflicted: false, conflicts: [] };
  // queryTasks 默认隐藏 CANCELLED；大 limit 避免截断导致漏判
  const fmt = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const tasks = await queryTasks({
    startDate: fmt(new Date(ns)),
    endDate: fmt(new Date(ne)),
    limit: 500,
  });
  const conflicts = tasks
    .filter((t) => t.id !== input.excludeTaskId)
    .filter((t) => {
      const s = new Date(t.startAt ?? "").getTime();
      const e = new Date(t.endAt ?? t.startAt ?? "").getTime();
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
}
