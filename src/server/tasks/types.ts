// Task 18 (Stage A) — Task / ScheduleItem 抽象
//
// 设计约束（复用优先）：
//   - 不重写既有 Meeting 逻辑；meetings 表即 Task 数据实体（task_type 列默认 MEETING）。
//   - DB status 保留既有值：scheduled / completed / cancelled；
//     对外视图状态映射为 CONFIRMED / COMPLETED / CANCELLED（创建即确认）。
//   - CANCELLED 不物理删除（保留 Memory / Execution / Trace）。

export type TaskType = "MEETING" | "TODO" | "REMINDER" | "OTHER";

export const TASK_TYPE_LIST: TaskType[] = ["MEETING", "TODO", "REMINDER", "OTHER"];

/** DB 状态 → 视图状态（需求十：至少区分 CONFIRMED / COMPLETED / CANCELLED） */
export type TaskStatusView = "CONFIRMED" | "COMPLETED" | "CANCELLED";

export function toTaskStatusView(status: string): TaskStatusView {
  switch (status) {
    case "completed":
      return "COMPLETED";
    case "cancelled":
      return "CANCELLED";
    default:
      return "CONFIRMED"; // scheduled → CONFIRMED
  }
}

export function isTaskType(v: unknown): v is TaskType {
  return typeof v === "string" && (TASK_TYPE_LIST as string[]).includes(v);
}

/** 查询结果里的单个 Task 视图（Chat task_search 与 Schedule 页面共用） */
export interface TaskView {
  id: string;
  title: string;
  taskType: TaskType;
  startAt: string | null;
  endAt: string | null;
  location: string | null;
  notes: string | null;
  /** DB 原始状态（scheduled/completed/cancelled） */
  status: string;
  /** 对外语义状态（CONFIRMED/COMPLETED/CANCELLED） */
  statusView: TaskStatusView;
  contactId: string | null;
  contactName: string | null;
  createdAt: string;
}

/** 日程查询参数（Agent task_search 与 /api/tasks 共用同一函数） */
export interface TaskQuery {
  id?: string;
  /** 标题模糊匹配 */
  title?: string;
  contactId?: string;
  /** 联系人姓名模糊匹配 */
  contactName?: string;
  taskType?: string;
  /** 视图状态：CONFIRMED / COMPLETED / CANCELLED（转 DB 值查询） */
  status?: string;
  /** YYYY-MM-DD（Asia/Shanghai 当天 00:00 ~ 次日 00:00） */
  startDate?: string;
  /** YYYY-MM-DD（含当天） */
  endDate?: string;
  /** ISO 时间点（>= startAt） */
  startTime?: string;
  limit?: number;
  /** 默认排除 CANCELLED（需求十）；显式传 true 时包含 */
  includeCancelled?: boolean;
}
