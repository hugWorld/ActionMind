"use client";

import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

// Task 16 — Action Card UI：View / Edit / Confirm / Cancel / Execute（逐张确认，Human-in-the-loop）

interface ActionItem {
  id: string;
  type: string;
  status: string;
  payload: Record<string, unknown>;
  evidence: { edits?: Array<{ at: string; field: string; from: unknown; to: unknown }> } | null;
  createdAt: string;
}

interface ExecResult {
  ok: boolean;
  response?: Record<string, unknown>;
  error?: string;
}

const STATUS_STYLE: Record<string, string> = {
  DRAFT: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
  CONFIRMED: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200",
  CANCELLED: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
  EXECUTING: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200",
  SUCCESS: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200",
  FAILED: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
};

const TYPE_STYLE: Record<string, string> = {
  CREATE_MEETING: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200",
  CREATE_CONTACT: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200",
  UPDATE_CONTACT: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200",
};

const FIELD_LABEL: Record<string, string> = {
  title: "标题",
  start: "开始",
  end: "结束",
  location: "地点",
  notes: "备注",
  missing: "缺失项",
  name: "姓名",
  email: "邮箱",
  phone: "电话",
  organization: "公司",
};

const EDITABLE_FIELDS = [
  "title",
  "start",
  "end",
  "location",
  "notes",
  "name",
  "email",
  "phone",
  "organization",
];

const STATUS_FILTERS = ["ALL", "DRAFT", "CONFIRMED", "CANCELLED", "EXECUTING", "SUCCESS", "FAILED"];

function displayValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "（未填写）";
  if (Array.isArray(value)) return value.length ? value.join(", ") : "（无）";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function payloadToDraft(payload: Record<string, unknown>): Record<string, string> {
  const draft: Record<string, string> = {};
  const nested =
    typeof payload.contact === "object" && payload.contact !== null
      ? (payload.contact as Record<string, unknown>)
      : {};
  for (const f of EDITABLE_FIELDS) {
    const raw = payload[f] ?? nested[f];
    if (raw === null || raw === undefined) draft[f] = "";
    else if (Array.isArray(raw)) draft[f] = raw.join(", ");
    else if (typeof raw === "object") draft[f] = JSON.stringify(raw);
    else draft[f] = String(raw);
  }
  return draft;
}

export default function ActionsPage() {
  const searchParams = useSearchParams();
  const highlightId = searchParams.get("id");
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [items, setItems] = useState<ActionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [execResults, setExecResults] = useState<Record<string, ExecResult>>({});

  const load = useCallback(async (status?: string) => {
    setLoading(true);
    setError(null);
    try {
      const qs = status && status !== "ALL" ? `?status=${status}` : "";
      const res = await fetch(`/api/actions${qs}`);
      const body = await res.json();
      if (!res.ok || !body.ok) throw new Error(body.error?.message ?? `HTTP ${res.status}`);
      setItems(body.actions as ActionItem[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(statusFilter);
  }, [statusFilter, load]);

  useEffect(() => {
    if (highlightId) {
      const t = setTimeout(() => {
        document
          .getElementById(`card-${highlightId}`)
          ?.scrollIntoView({ behavior: "smooth", block: "center" });
      }, 400);
      return () => clearTimeout(t);
    }
  }, [highlightId, items]);

  const act = async (path: string, opts?: { method?: string; body?: unknown }) => {
    const method = opts?.method ?? "POST";
    const res = await fetch(path, {
      method,
      headers: opts?.body !== undefined ? { "Content-Type": "application/json" } : undefined,
      body: opts?.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json.ok) throw new Error(json.error?.message ?? `HTTP ${res.status}`);
    return json;
  };

  const onConfirm = async (id: string) => {
    setBusyId(id);
    try {
      await act(`/api/actions/${id}/confirm`);
      await load(statusFilter);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId(null);
    }
  };

  const onCancel = async (id: string) => {
    setBusyId(id);
    try {
      await act(`/api/actions/${id}/cancel`);
      await load(statusFilter);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId(null);
    }
  };

  const onExecute = async (id: string) => {
    setBusyId(id);
    setError(null);
    try {
      const json = await act(`/api/actions/${id}/execute`);
      setExecResults((prev) => ({ ...prev, [id]: json.result as ExecResult }));
      await load(statusFilter);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId(null);
    }
  };

  const startEdit = (a: ActionItem) => {
    setEditingId(a.id);
    setDraft(payloadToDraft(a.payload));
  };

  const onSaveEdit = async (id: string) => {
    const patch: Record<string, unknown> = {};
    for (const f of EDITABLE_FIELDS) {
      if (!(f in draft)) continue;
      const raw = draft[f];
      if (f === "missing" || f === "email" || f === "phone") {
        const parts = raw
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
        patch[f] = parts.length ? parts : null;
      } else {
        patch[f] = raw.trim() === "" ? null : raw.trim();
      }
    }
    setBusyId(id);
    try {
      await act(`/api/actions/${id}`, { method: "PATCH", body: patch });
      setEditingId(null);
      await load(statusFilter);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId(null);
    }
  };

  const renderPayloadRows = (a: ActionItem) => {
    const payload = a.payload ?? {};
    const nested =
      typeof payload.contact === "object" && payload.contact !== null
        ? (payload.contact as Record<string, unknown>)
        : {};
    const rows = EDITABLE_FIELDS.filter((f) => {
      const v = payload[f] ?? nested[f];
      return v !== null && v !== undefined && v !== "" && !(Array.isArray(v) && v.length === 0);
    });
    if (rows.length === 0) return <p className="text-sm text-zinc-400">（无字段）</p>;
    return (
      <dl className="grid grid-cols-1 gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
        {rows.map((f) => (
          <div key={f} className="flex gap-2">
            <dt className="shrink-0 text-zinc-400">{FIELD_LABEL[f] ?? f}</dt>
            <dd className="text-zinc-700 dark:text-zinc-300">{displayValue(payload[f] ?? nested[f])}</dd>
          </div>
        ))}
      </dl>
    );
  };

  return (
    <div className="flex flex-1 justify-center bg-zinc-50 font-sans dark:bg-black">
      <main className="w-full max-w-4xl px-6 py-10">
        <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-black dark:text-zinc-50">
              Action Cards
            </h1>
            <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
              逐张确认后才会执行；执行成功自动沉淀 Verified Memory。
            </p>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {STATUS_FILTERS.map((s) => (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                className={`rounded-full px-3 py-1 text-xs font-medium transition ${
                  statusFilter === s
                    ? "bg-black text-white dark:bg-white dark:text-black"
                    : "bg-white text-zinc-600 ring-1 ring-zinc-200 hover:bg-zinc-100 dark:bg-zinc-900 dark:text-zinc-300 dark:ring-zinc-800"
                }`}
              >
                {s === "ALL" ? "全部" : s}
              </button>
            ))}
          </div>
        </header>

        {error && (
          <div className="mb-4 rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
            {error}
          </div>
        )}

        {loading ? (
          <p className="text-sm text-zinc-400">加载中…</p>
        ) : items.length === 0 ? (
          <p className="text-sm text-zinc-400">
            暂无 {statusFilter === "ALL" ? "" : statusFilter} 状态的卡片。请先在首页上传聊天截图生成 Action Card。
          </p>
        ) : (
          <ul className="space-y-4">
            {items.map((a) => {
              const highlight = highlightId === a.id;
              const exec = execResults[a.id];
              return (
                <li
                  key={a.id}
                  id={`card-${a.id}`}
                  className={`rounded-2xl border bg-white p-5 shadow-sm transition dark:bg-zinc-900 ${
                    highlight
                      ? "border-violet-400 ring-2 ring-violet-300 dark:border-violet-600 dark:ring-violet-800"
                      : "border-zinc-200 dark:border-zinc-800"
                  }`}
                >
                  <div className="mb-3 flex flex-wrap items-center gap-2">
                    <span
                      className={`rounded-full px-3 py-1 text-xs font-medium ${TYPE_STYLE[a.type] ?? "bg-zinc-100 text-zinc-700"}`}
                    >
                      {a.type}
                    </span>
                    <span
                      data-testid="action-status"
                      className={`rounded-full px-3 py-1 text-xs font-medium ${STATUS_STYLE[a.status] ?? "bg-zinc-100 text-zinc-700"}`}
                    >
                      {a.status}
                    </span>
                    <span className="text-xs text-zinc-400">
                      {new Date(a.createdAt).toLocaleString("zh-CN", { hour12: false })}
                    </span>
                  </div>

                  {editingId === a.id ? (
                    <div className="space-y-2">
                      {EDITABLE_FIELDS.map((f) => (
                        <label key={f} className="block">
                          <span className="mb-1 block text-xs text-zinc-400">
                            {FIELD_LABEL[f] ?? f}
                          </span>
                          <input
                            value={draft[f] ?? ""}
                            onChange={(e) => setDraft((d) => ({ ...d, [f]: e.target.value }))}
                            className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm text-black outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
                          />
                        </label>
                      ))}
                      <div className="flex gap-2 pt-1">
                        <button
                          onClick={() => onSaveEdit(a.id)}
                          disabled={busyId === a.id}
                          className="rounded-lg bg-black px-4 py-1.5 text-sm font-medium text-white transition hover:opacity-80 disabled:opacity-50 dark:bg-white dark:text-black"
                        >
                          保存
                        </button>
                        <button
                          onClick={() => setEditingId(null)}
                          className="rounded-lg px-4 py-1.5 text-sm text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                        >
                          取消
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      {renderPayloadRows(a)}
                      {Array.isArray(a.evidence?.edits) && a.evidence.edits.length > 0 && (
                        <details className="mt-3">
                          <summary className="cursor-pointer text-xs text-zinc-400">
                            编辑记录（{a.evidence.edits.length}）
                          </summary>
                          <ul className="mt-1 space-y-0.5 text-xs text-zinc-500 dark:text-zinc-400">
                            {a.evidence.edits.map((e, i) => (
                              <li key={i}>
                                {new Date(e.at).toLocaleString("zh-CN", { hour12: false })} ·{" "}
                                {FIELD_LABEL[e.field] ?? e.field}：{displayValue(e.from)} →{" "}
                                {displayValue(e.to)}
                              </li>
                            ))}
                          </ul>
                        </details>
                      )}
                    </>
                  )}

                  {exec && (
                    <div className="mt-3 rounded-xl border border-zinc-200 bg-zinc-50 p-3 text-sm dark:border-zinc-700 dark:bg-zinc-950">
                      {exec.ok ? (
                        <>
                          <p className="font-medium text-emerald-600 dark:text-emerald-400">
                            执行成功，已沉淀 Verified Memory
                          </p>
                          <pre className="mt-1 overflow-x-auto text-xs text-zinc-600 dark:text-zinc-400">
                            {JSON.stringify(exec.response ?? {}, null, 2)}
                          </pre>
                        </>
                      ) : (
                        <p className="text-red-600 dark:text-red-400">
                          执行失败：{exec.error ?? "未知错误"}
                        </p>
                      )}
                    </div>
                  )}

                  <div className="mt-4 flex flex-wrap gap-2">
                    {a.status === "DRAFT" && (
                      <>
                        <button
                          onClick={() => startEdit(a)}
                          className="rounded-lg px-4 py-1.5 text-sm font-medium ring-1 ring-zinc-300 hover:bg-zinc-100 dark:ring-zinc-700 dark:hover:bg-zinc-800"
                        >
                          编辑
                        </button>
                        <button
                          onClick={() => onConfirm(a.id)}
                          disabled={busyId === a.id}
                          className="rounded-lg bg-blue-600 px-4 py-1.5 text-sm font-medium text-white transition hover:opacity-80 disabled:opacity-50"
                        >
                          确认
                        </button>
                        <button
                          onClick={() => onCancel(a.id)}
                          disabled={busyId === a.id}
                          className="rounded-lg px-4 py-1.5 text-sm text-zinc-500 ring-1 ring-zinc-300 hover:bg-zinc-100 disabled:opacity-50 dark:ring-zinc-700 dark:hover:bg-zinc-800"
                        >
                          取消
                        </button>
                      </>
                    )}
                    {a.status === "CONFIRMED" && (
                      <button
                        onClick={() => onExecute(a.id)}
                        disabled={busyId === a.id}
                        className="rounded-lg bg-emerald-600 px-4 py-1.5 text-sm font-medium text-white transition hover:opacity-80 disabled:opacity-50"
                      >
                        {busyId === a.id ? "执行中…" : "执行"}
                      </button>
                    )}
                    {a.status === "FAILED" && (
                      <span className="text-xs text-zinc-400">
                        已失败，可新建卡片重试（状态机冻结，不可直接重跑）
                      </span>
                    )}
                    {a.status === "CANCELLED" && (
                      <span className="text-xs text-zinc-400">已取消</span>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </main>
    </div>
  );
}
