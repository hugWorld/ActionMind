"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

// Task 18 (Stage C) — 日程页 /schedule
// 需求九：月视图 / 周视图 / 日视图 + 上一(月/周/日)/下一(月/周/日)/今天
// 需求十：任务状态 CONFIRMED/COMPLETED/CANCELLED；默认不显示 CANCELLED，「显示已取消」开关
// 需求十一：与 Chat 共享同一数据源（/api/tasks → queryTasks → PostgreSQL meetings 表）

interface TaskView {
  id: string;
  title: string;
  taskType: string;
  startAt: string | null;
  endAt: string | null;
  location: string | null;
  notes: string | null;
  status: string;
  statusView: "CONFIRMED" | "COMPLETED" | "CANCELLED";
  contactId: string | null;
  contactName: string | null;
}

type ViewMode = "month" | "week" | "day";

const STATUS_STYLE: Record<string, string> = {
  CONFIRMED: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200",
  COMPLETED: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300",
  CANCELLED: "bg-red-100 text-red-700 line-through dark:bg-red-900/40 dark:text-red-300",
};

const WEEK_LABELS = ["一", "二", "三", "四", "五", "六", "日"];

const HOURS = Array.from({ length: 13 }, (_, i) => i + 8); // 08:00 ~ 20:00

// ---------- 本地日期工具（Asia/Shanghai 即系统本地） ----------

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

function ymd(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function fmtTime(iso: string | null): string {
  if (!iso) return "--:--";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
}

function fmtShort(iso: string | null): string {
  if (!iso) return "未定";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.getMonth() + 1}月${d.getDate()}日 ${fmtTime(iso)}`;
}

/** 视图范围：返回 [startDate, endDate]（YYYY-MM-DD）与展示用日期数组 */
function rangeOf(mode: ViewMode, cursor: Date): { start: string; end: string; days: Date[] } {
  const today = startOfDay(cursor);
  if (mode === "day") {
    return { start: ymd(today), end: ymd(today), days: [today] };
  }
  if (mode === "week") {
    // 周一 ~ 周日
    const diff = (today.getDay() + 6) % 7; // 周一=0
    const monday = addDays(today, -diff);
    const days = Array.from({ length: 7 }, (_, i) => addDays(monday, i));
    return { start: ymd(days[0]), end: ymd(days[6]), days };
  }
  // month：当月 1 号所在周的周日（列首）~ 月末所在周的周六（列尾）
  const first = new Date(today.getFullYear(), today.getMonth(), 1);
  const colStart = addDays(first, -((first.getDay() + 6) % 7)); // 周一=0
  const days: Date[] = [];
  for (let i = 0; i < 42; i++) days.push(addDays(colStart, i));
  return { start: ymd(days[0]), end: ymd(days[41]), days };
}

export default function SchedulePage() {
  const [mode, setMode] = useState<ViewMode>("week");
  const [cursor, setCursor] = useState<Date>(() => new Date());
  const [includeCancelled, setIncludeCancelled] = useState(false);
  const [tasks, setTasks] = useState<TaskView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const { start, end } = useMemo(() => rangeOf(mode, cursor), [mode, cursor]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ startDate: start, endDate: end });
      if (includeCancelled) params.set("includeCancelled", "true");
      const res = await fetch(`/api/tasks?${params.toString()}`);
      const data = (await res.json()) as { ok: boolean; tasks: TaskView[] };
      if (!res.ok || !data.ok) throw new Error("加载日程失败");
      setTasks(data.tasks);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [start, end, includeCancelled]);

  useEffect(() => {
    void load();
  }, [load]);

  const nav = (dir: -1 | 1) => {
    setCursor((c) =>
      mode === "day" ? addDays(c, dir) : mode === "week" ? addDays(c, dir * 7) : new Date(c.getFullYear(), c.getMonth() + dir, 1),
    );
  };

  const todayStr = ymd(new Date());
  const byDay = useMemo(() => {
    const m = new Map<string, TaskView[]>();
    for (const t of tasks) {
      if (!t.startAt) continue;
      const d = new Date(t.startAt);
      const key = ymd(d);
      const list = m.get(key) ?? [];
      list.push(t);
      m.set(key, list);
    }
    for (const list of m.values()) list.sort((a, b) => (a.startAt ?? "").localeCompare(b.startAt ?? ""));
    return m;
  }, [tasks]);

  const title = useMemo(() => {
    if (mode === "day") return `${ymd(cursor)}（周${"日一二三四五六"[cursor.getDay()]}）`;
    if (mode === "week") {
      const d = rangeOf("week", cursor).days;
      return `${ymd(d[0])} ~ ${ymd(d[6])}`;
    }
    return `${cursor.getFullYear()}年${cursor.getMonth() + 1}月`;
  }, [mode, cursor]);

  const taskCard = (t: TaskView, compact: boolean) => (
    <div
      key={t.id}
      data-testid="task-item"
      className={`rounded-lg border border-zinc-200 bg-white px-2 py-1 text-xs shadow-sm dark:border-zinc-700 dark:bg-zinc-900 ${compact ? "truncate" : ""}`}
    >
      <div className="flex items-center gap-1">
        <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${STATUS_STYLE[t.statusView] ?? ""}`}>
          {t.statusView}
        </span>
        <span className="shrink-0 text-zinc-400">{fmtTime(t.startAt)}</span>
        <span className="truncate text-zinc-700 dark:text-zinc-200">{t.title}</span>
      </div>
      {!compact && (
        <div className="mt-0.5 truncate text-[11px] text-zinc-500 dark:text-zinc-400">
          {t.contactName ? `对象：${t.contactName} ` : ""}
          {t.location ? `地点：${t.location}` : ""}
          {t.endAt ? ` 至 ${fmtTime(t.endAt)}` : ""}
        </div>
      )}
    </div>
  );

  return (
    <div className="flex-1 bg-zinc-50 font-sans dark:bg-black">
      <div className="mx-auto max-w-6xl px-6 py-6">
        {/* 工具栏：视图切换 + 导航 + 显示已取消 */}
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <div className="flex overflow-hidden rounded-lg border border-zinc-300 dark:border-zinc-700">
              {(["month", "week", "day"] as const).map((m) => (
                <button
                  key={m}
                  data-testid={`view-${m}`}
                  onClick={() => setMode(m)}
                  className={`px-3 py-1.5 text-sm transition ${
                    mode === m
                      ? "bg-black text-white dark:bg-white dark:text-black"
                      : "bg-white text-zinc-600 hover:bg-zinc-100 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800"
                  }`}
                >
                  {m === "month" ? "月" : m === "week" ? "周" : "日"}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-1">
              <button
                data-testid="nav-prev"
                onClick={() => nav(-1)}
                className="rounded-lg border border-zinc-300 bg-white px-2.5 py-1.5 text-sm text-zinc-600 transition hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800"
                aria-label="上一(月/周/日)"
              >
                ◀
              </button>
              <button
                data-testid="nav-today"
                onClick={() => setCursor(new Date())}
                className="rounded-lg border border-zinc-300 bg-white px-2.5 py-1.5 text-sm text-zinc-600 transition hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800"
              >
                今天
              </button>
              <button
                data-testid="nav-next"
                onClick={() => nav(1)}
                className="rounded-lg border border-zinc-300 bg-white px-2.5 py-1.5 text-sm text-zinc-600 transition hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800"
                aria-label="下一(月/周/日)"
              >
                ▶
              </button>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <h2 className="text-sm font-semibold text-black dark:text-zinc-100">{title}</h2>
            <label className="flex cursor-pointer items-center gap-1.5 text-xs text-zinc-500 dark:text-zinc-400">
              <input
                data-testid="include-cancelled"
                type="checkbox"
                checked={includeCancelled}
                onChange={(e) => setIncludeCancelled(e.target.checked)}
                className="accent-black dark:accent-white"
              />
              显示已取消任务
            </label>
          </div>
        </div>

        {error && (
          <div className="mb-3 rounded-xl border border-red-300 bg-red-50 px-4 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
            {error}
          </div>
        )}

        {loading ? (
          <div className="py-16 text-center text-sm text-zinc-400">加载中…</div>
        ) : (
          <>
            {/* ---------- 月视图 ---------- */}
            {mode === "month" && (
              <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
                <div className="grid grid-cols-7 border-b border-zinc-200 dark:border-zinc-800">
                  {WEEK_LABELS.map((w) => (
                    <div key={w} className="py-2 text-center text-xs font-medium text-zinc-400">
                      周{w}
                    </div>
                  ))}
                </div>
                <div className="grid grid-cols-7">
                  {rangeOf("month", cursor).days.map((d) => {
                    const key = ymd(d);
                    const inMonth = d.getMonth() === cursor.getMonth();
                    const list = byDay.get(key) ?? [];
                    return (
                      <div
                        key={key}
                        data-testid="month-cell"
                        className={`min-h-24 border-b border-r border-zinc-100 p-1.5 dark:border-zinc-800 ${inMonth ? "" : "bg-zinc-50 dark:bg-zinc-950"}`}
                      >
                        <div className={`mb-1 text-xs ${key === todayStr ? "font-bold text-black dark:text-white" : inMonth ? "text-zinc-600 dark:text-zinc-300" : "text-zinc-300 dark:text-zinc-600"}`}>
                          {d.getDate()}
                        </div>
                        <div className="space-y-1">
                          {list.slice(0, 3).map((t) => taskCard(t, true))}
                          {list.length > 3 && (
                            <div className="text-[10px] text-zinc-400">+{list.length - 3} 项</div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* ---------- 周视图（时间轴） ---------- */}
            {mode === "week" && (
              <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
                <div className="grid min-w-[720px] grid-cols-[3.5rem_repeat(7,1fr)]">
                  <div />
                  {rangeOf("week", cursor).days.map((d) => (
                    <div key={ymd(d)} className="border-b border-zinc-200 py-2 text-center text-xs font-medium text-zinc-500 dark:border-zinc-800 dark:text-zinc-300">
                      {d.getMonth() + 1}/{d.getDate()} 周{WEEK_LABELS[(d.getDay() + 6) % 7]}
                    </div>
                  ))}
                  {HOURS.map((h) => (
                    <FragmentRow
                      key={h}
                      hour={h}
                      days={rangeOf("week", cursor).days}
                      byDay={byDay}
                      render={taskCard}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* ---------- 日视图（时间轴） ---------- */}
            {mode === "day" && (
              <div className="rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
                <div className="grid grid-cols-[3.5rem_1fr]">
                  {HOURS.map((h) => {
                    const list = (byDay.get(ymd(cursor)) ?? []).filter(
                      (t) => new Date(t.startAt!).getHours() === h,
                    );
                    return (
                      <div key={h} className="contents">
                        <div className="border-b border-zinc-100 py-2 pr-2 text-right text-xs text-zinc-400 dark:border-zinc-800">
                          {h}:00
                        </div>
                        <div className="min-h-12 border-b border-zinc-100 p-1 dark:border-zinc-800">
                          {list.map((t) => taskCard(t, false))}
                        </div>
                      </div>
                    );
                  })}
                </div>
                {byDay.get(ymd(cursor))?.length === 0 && (
                  <div className="py-12 text-center text-sm text-zinc-400">当天暂无日程</div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/** 周视图一行（小时格 + 7 天格子） */
function FragmentRow(props: {
  hour: number;
  days: Date[];
  byDay: Map<string, TaskView[]>;
  render: (t: TaskView, compact: boolean) => React.ReactNode;
}) {
  const { hour, days, byDay, render } = props;
  return (
    <>
      <div className="border-b border-zinc-100 py-2 pr-2 text-right text-xs text-zinc-400 dark:border-zinc-800">
        {hour}:00
      </div>
      {days.map((d) => {
        const list = (byDay.get(ymd(d)) ?? []).filter((t) => new Date(t.startAt!).getHours() === hour);
        return (
          <div key={ymd(d)} className="min-h-12 border-b border-l border-zinc-100 p-1 dark:border-zinc-800">
            {list.map((t) => render(t, true))}
          </div>
        );
      })}
    </>
  );
}
