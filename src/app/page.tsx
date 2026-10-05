"use client";

import { useEffect, useRef, useState } from "react";

// Task 17 (Stage C) — 对话式 Agent 首页（纯文字 / 图片 / 图文混合）
// Task 18 (Stage C) — 聊天自动滚动（底部跟随 + 上滑保护 + 回到底部）+ Action Card 类型化
//   （CREATE=即将创建 / UPDATE=即将修改 / CANCEL=即将取消）

interface ActionCardView {
  id: string;
  type: string;
  status: string;
  payload: Record<string, unknown>;
}

interface AgentOutcome {
  kind: "ask_user" | "answer" | "action_card" | "unknown";
  question?: string;
  content?: string;
  action?: ActionCardView;
  memoryIds?: string[];
}

interface ChatResponse {
  ok: boolean;
  outcome: AgentOutcome;
  sessionId: string;
  state: {
    phase: string;
    goal?: string | null;
    missingRequiredInfo: string[];
    currentAction: ActionCardView | null;
    askedQuestions: string[];
    traceCount: number;
  };
  error?: string;
}

type Msg =
  | { role: "user"; text?: string; image?: string }
  | {
      role: "agent";
      kind: "text" | "question" | "answer" | "unknown" | "card";
      content?: string;
      card?: ActionCardView;
      executed?: boolean;
      execResult?: string;
      execError?: string;
    };

const TYPE_STYLE: Record<string, string> = {
  CREATE_TASK: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200",
  CREATE_MEETING: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200",
  CREATE_CONTACT: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200",
  UPDATE_TASK: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200",
  UPDATE_CONTACT: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200",
  CANCEL_TASK: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200",
};

const TYPE_ZH: Record<string, string> = {
  CREATE_TASK: "创建任务",
  CREATE_MEETING: "创建会议",
  CREATE_CONTACT: "创建联系人",
  UPDATE_TASK: "修改任务",
  UPDATE_CONTACT: "更新联系人",
  CANCEL_TASK: "取消任务",
};

/** 操作语义（需求八：Action Card 按 ActionType 显示不同内容） */
const ACTION_VERB: Record<string, string> = {
  CREATE_TASK: "即将创建",
  CREATE_MEETING: "即将创建",
  CREATE_CONTACT: "即将创建",
  UPDATE_TASK: "即将修改",
  UPDATE_CONTACT: "即将修改",
  CANCEL_TASK: "即将取消",
};

const FIELD_LABEL: Record<string, string> = {
  title: "标题",
  start: "开始",
  end: "结束",
  location: "地点",
  notes: "备注",
  name: "姓名",
  email: "邮箱",
  phone: "电话",
  organization: "公司",
  role: "职位",
  taskId: "目标任务",
  reason: "原因",
};

const CARD_FIELDS = ["title", "start", "end", "location", "notes"];
const CONTACT_FIELDS = ["name", "email", "phone", "organization", "role"];

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

function fmtDateTime(v: unknown): string {
  if (typeof v !== "string" || !v) return "（未确定）";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return v;
  return d.toLocaleString("zh-CN", { hour12: false, timeZone: "Asia/Shanghai" });
}

function displayValue(v: unknown): string {
  if (v === null || v === undefined || v === "") return "（未填写）";
  if (Array.isArray(v)) return v.length ? v.join(", ") : "（无）";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

/** 距底部阈值（px）：低于该值视为“已在底部”，新消息自动跟随 */
const NEAR_BOTTOM_PX = 80;

export default function Home() {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [image, setImage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 聊天自动滚动状态（需求一）：
  //   atBottom —— 用户当前是否处于底部附近（决定新消息是否自动跟随）
  //   showJump —— 用户上滑查看历史且远离底部时，显示「回到底部」
  //   atBottomRef —— 同步镜像 atBottom：onScroll 即时写入，避免 React 状态滞后导致误跟随
  const [atBottom, setAtBottom] = useState(true);
  const [showJump, setShowJump] = useState(false);
  const atBottomRef = useRef(true);
  const fileRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const isNearBottom = (): boolean => {
    const el = listRef.current;
    if (!el) return true;
    return el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX;
  };

  const scrollToBottom = (behavior: ScrollBehavior = "auto") => {
    const el = listRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior });
    atBottomRef.current = true;
    setAtBottom(true);
    setShowJump(false);
  };

  const handleScroll = () => {
    const el = listRef.current;
    if (!el) return;
    const near = isNearBottom();
    atBottomRef.current = near;
    setAtBottom(near);
    // 远离底部（用户上滑看历史）且有滚动空间 → 显示「回到底部」
    setShowJump(!near && el.scrollHeight > el.clientHeight);
  };

  // 内容变化时自动跟随到底（需求一）：
  //  - 仅 messages 变化触发（busy 翻转也会伴随 messages 变化，无需重复触发，
  //    否则会在用户刚上滑时仍有 pending rAF 把页面拉回底部）
  //  - 以 atBottomRef 门控（即时同步，无 React 状态滞后）：
  //    发送/回到底部置 true；用户上滑由 onScroll 即时置 false
  //  - rAF 执行时再查一次 ref：若期间用户上滑则放弃跟随
  useEffect(() => {
    if (!atBottomRef.current) return;
    const id = requestAnimationFrame(() => {
      if (!atBottomRef.current) return;
      const el = listRef.current;
      if (!el) return;
      el.scrollTop = el.scrollHeight;
    });
    return () => cancelAnimationFrame(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages]);

  const send = async (overrideText?: string) => {
    const t = (overrideText ?? text).trim();
    const img = image;
    if ((!t && !img) || busy) return;

    // 用户主动发送 → 立即滚动到底（发送是主动操作）；
    // 但若用户正上滑查看历史（远离底部），不强制拉回（需求一第 4 条）
    const elBefore = listRef.current;
    const wasNearBottom =
      !elBefore || elBefore.scrollHeight - elBefore.scrollTop - elBefore.clientHeight < NEAR_BOTTOM_PX;
    const userMsg: Msg = { role: "user", text: t || undefined, image: img || undefined };
    setMessages((prev) => [...prev, userMsg]);
    setText("");
    setImage(null);
    setBusy(true);
    setError(null);
    if (wasNearBottom) scrollToBottom();

    try {
      const body: Record<string, unknown> = {};
      if (sessionId) body.sessionId = sessionId;
      if (t) body.text = t;
      if (img) body.imageDataUrl = img;

      const res = await fetch("/api/agent/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json()) as ChatResponse;
      if (!res.ok || !data.ok) throw new Error(data.error ?? `HTTP ${res.status}`);

      setSessionId(data.sessionId);
      const o = data.outcome;
      let agentMsg: Msg;
      if (o.kind === "action_card" && o.action) {
        agentMsg = { role: "agent", kind: "card", card: o.action };
      } else if (o.kind === "ask_user" && o.question) {
        agentMsg = { role: "agent", kind: "question", content: o.question };
      } else if (o.kind === "answer" && o.content) {
        agentMsg = { role: "agent", kind: "answer", content: o.content };
      } else {
        agentMsg = {
          role: "agent",
          kind: "unknown",
          content: "暂时没识别到可执行的任务。你可以试试：\n· 帮我约张三开会\n· 我周五有什么安排？\n· 取消我和张三周五的会议\n· 上传聊天截图让我看看",
        };
      }
      setMessages((prev) => [...prev, agentMsg]);
      scrollToBottom();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const confirmAndExecute = async (card: ActionCardView) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const c = await fetch(`/api/actions/${card.id}/confirm`, { method: "POST" });
      const cj = (await c.json()) as { ok: boolean; error?: { message?: string } };
      if (!c.ok || !cj.ok) throw new Error(cj.error?.message ?? `确认失败 HTTP ${c.status}`);

      const e = await fetch(`/api/actions/${card.id}/execute`, { method: "POST" });
      const ej = (await e.json()) as {
        ok: boolean;
        result?: { ok: boolean; response?: unknown; error?: string };
        error?: { message?: string };
      };
      if (!e.ok || !ej.ok) throw new Error(ej.error?.message ?? `执行失败 HTTP ${e.status}`);
      if (ej.result && ej.result.ok === false) {
        throw new Error(ej.result.error ?? "执行失败");
      }

      setMessages((prev) =>
        prev.map((m) =>
          m.role === "agent" && m.kind === "card" && m.card?.id === card.id
            ? {
                ...m,
                executed: true,
                execResult: JSON.stringify(ej.result?.response ?? {}, null, 2),
              }
            : m,
        ),
      );
      scrollToBottom();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const onPickImage = async (f: File | undefined) => {
    if (!f) return;
    if (!f.type.startsWith("image/")) {
      setError("仅支持图片文件（JPEG/PNG/GIF/WebP）");
      return;
    }
    try {
      setImage(await fileToDataUrl(f));
      setError(null);
    } catch {
      setError("图片读取失败");
    }
  };

  /** 字段行（CREATE 类卡片：会议/联系人） */
  const renderFields = (p: Record<string, unknown>) => {
    const nested =
      typeof p.contact === "object" && p.contact !== null
        ? (p.contact as Record<string, unknown>)
        : {};
    const rowFields = CARD_FIELDS.filter((f) => p[f] != null && p[f] !== "");
    const contactRows = CONTACT_FIELDS.filter((f) => nested[f] != null && nested[f] !== "");
    if (rowFields.length === 0 && contactRows.length === 0) {
      return <p className="text-zinc-400">（待补充信息）</p>;
    }
    return (
      <dl className="grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-2">
        {rowFields.map((f) => (
          <div key={f} className="flex gap-2">
            <dt className="shrink-0 text-zinc-400">{FIELD_LABEL[f] ?? f}</dt>
            <dd>{f === "start" || f === "end" ? fmtDateTime(p[f]) : displayValue(p[f])}</dd>
          </div>
        ))}
        {contactRows.map((f) => (
          <div key={f} className="flex gap-2">
            <dt className="shrink-0 text-zinc-400">{FIELD_LABEL[f] ?? f}</dt>
            <dd>{displayValue(nested[f])}</dd>
          </div>
        ))}
      </dl>
    );
  };

  /** 取消/修改类卡片正文（需求八：UPDATE=即将修改 / CANCEL=即将取消） */
  const renderActionBody = (card: ActionCardView) => {
    const p = card.payload ?? {};
    if (card.type === "CANCEL_TASK") {
      return (
        <dl className="grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-2">
          <div className="flex gap-2">
            <dt className="shrink-0 text-zinc-400">目标任务</dt>
            <dd>{typeof p.taskId === "string" && p.taskId ? `${p.taskId.slice(0, 12)}…` : "（未指定）"}</dd>
          </div>
          {typeof p.title === "string" && p.title ? (
            <div className="flex gap-2">
              <dt className="shrink-0 text-zinc-400">任务标题</dt>
              <dd>{p.title}</dd>
            </div>
          ) : null}
          {typeof p.reason === "string" && p.reason ? (
            <div className="flex gap-2">
              <dt className="shrink-0 text-zinc-400">原因</dt>
              <dd>{p.reason}</dd>
            </div>
          ) : null}
        </dl>
      );
    }
    if (card.type === "UPDATE_TASK") {
      const changes = (p.changes ?? {}) as Record<string, unknown>;
      const rows = Object.entries(changes).filter(([, v]) => v != null && v !== "");
      return (
        <dl className="grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-2">
          <div className="flex gap-2">
            <dt className="shrink-0 text-zinc-400">目标任务</dt>
            <dd>{typeof p.taskId === "string" && p.taskId ? `${p.taskId.slice(0, 12)}…` : "（未指定）"}</dd>
          </div>
          {rows.length === 0 ? (
            <p className="text-zinc-400">（暂无变更项）</p>
          ) : (
            rows.map(([k, v]) => (
              <div key={k} className="flex gap-2">
                <dt className="shrink-0 text-zinc-400">{FIELD_LABEL[k] ?? k}</dt>
                <dd>{k === "start" || k === "end" ? fmtDateTime(v) : displayValue(v)}</dd>
              </div>
            ))
          )}
        </dl>
      );
    }
    return renderFields(p);
  };

  const renderCard = (m: Extract<Msg, { role: "agent" }>) => {
    if (m.kind !== "card" || !m.card) return null;
    const card = m.card;

    return (
      <div
        data-testid="action-card"
        className="max-w-xl rounded-2xl border border-violet-200 bg-white p-5 shadow-sm dark:border-violet-800 dark:bg-zinc-900"
      >
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <span
            className={`rounded-full px-3 py-1 text-xs font-medium ${TYPE_STYLE[card.type] ?? "bg-zinc-100 text-zinc-700 dark:bg-zinc-800"}`}
          >
            {TYPE_ZH[card.type] ?? card.type}
          </span>
          <span
            className="rounded-full bg-zinc-100 px-3 py-1 text-xs font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"
            data-testid="action-verb"
          >
            {ACTION_VERB[card.type] ?? "待处理"} · DRAFT 待你确认
          </span>
        </div>

        <div className="text-sm text-zinc-700 dark:text-zinc-300">{renderActionBody(card)}</div>

        {m.executed ? (
          <div
            data-testid="exec-result"
            className="mt-4 rounded-xl border border-emerald-300 bg-emerald-50 p-3 text-sm dark:border-emerald-800 dark:bg-emerald-950/40"
          >
            <p className="font-medium text-emerald-700 dark:text-emerald-300">
              执行成功，已沉淀 Verified Memory
            </p>
            {m.execResult && (
              <pre className="mt-1 overflow-x-auto text-xs text-zinc-600 dark:text-zinc-400">
                {m.execResult}
              </pre>
            )}
          </div>
        ) : (
          <div className="mt-4">
            <button
              onClick={() => confirmAndExecute(card)}
              disabled={busy}
              className="rounded-lg bg-emerald-600 px-4 py-1.5 text-sm font-medium text-white transition hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-50"
            >
              确认并执行
            </button>
            <p className="mt-2 text-xs text-zinc-400">
              想修改？直接在下方输入新要求（如：改到明天下午四点 / 换个地点 / 不取消了），我会重新生成卡片。
            </p>
          </div>
        )}
      </div>
    );
  };

  const renderAgent = (m: Extract<Msg, { role: "agent" }>) => {
    if (m.kind === "card" && m.card) return renderCard(m);
    return (
      <div
        data-testid={m.kind === "question" ? "ask-question" : "agent-text"}
        className="max-w-xl whitespace-pre-line rounded-2xl rounded-tl-sm border border-zinc-200 bg-white px-4 py-3 text-sm text-zinc-700 shadow-sm dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300"
      >
        {m.content}
      </div>
    );
  };

  const EXAMPLES: Array<{ label: string; value: string }> = [
    { label: "安排会议", value: "帮我约张三，周五下午三点见" },
    { label: "查日程", value: "我周五有什么安排？" },
    { label: "取消会议", value: "取消我和张三周五下午三点的会议" },
    { label: "查历史", value: "我和张三上次是什么时候开的会？" },
  ];

  return (
    <div className="flex flex-1 flex-col bg-zinc-50 font-sans dark:bg-black">
      <header className="border-b border-zinc-200 px-6 py-4 dark:border-zinc-800">
        <h1 className="text-lg font-semibold tracking-tight text-black dark:text-zinc-50">
          Personal Task & Schedule Agent
        </h1>
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          和 Agent 对话安排任务与日程：创建 / 查询 / 修改 / 取消，自动沉淀记忆；截图只是可选输入。
        </p>
      </header>

      <div className="relative flex-1">
        <div
          ref={listRef}
          onScroll={handleScroll}
          data-testid="chat-scroll"
          className="absolute inset-0 overflow-y-auto px-6 py-6"
        >
          {messages.length === 0 ? (
            <div className="mx-auto max-w-xl pt-16 text-center">
              <p className="text-sm text-zinc-500 dark:text-zinc-400">
                直接说你想做什么；也可以上传聊天截图作为参考（可选）。
              </p>
              <div className="mt-4 flex flex-wrap justify-center gap-2">
                {EXAMPLES.map((ex) => (
                  <button
                    key={ex.label}
                    onClick={() => setText(ex.value)}
                    className="rounded-full bg-white px-3 py-1.5 text-xs text-zinc-600 ring-1 ring-zinc-200 transition hover:bg-zinc-100 dark:bg-zinc-900 dark:text-zinc-300 dark:ring-zinc-800"
                  >
                    {ex.label}：{ex.value}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="mx-auto max-w-2xl space-y-4">
              {messages.map((m, i) =>
                m.role === "user" ? (
                  <div key={i} className="flex justify-end">
                    <div className="max-w-xl rounded-2xl rounded-tr-sm bg-black px-4 py-3 text-sm text-white dark:bg-white dark:text-black">
                      {m.image && (
                        <img
                          src={m.image}
                          alt="用户上传的聊天截图"
                          className="mb-2 max-h-56 rounded-lg border border-white/20"
                        />
                      )}
                      {m.text && <div className="whitespace-pre-line">{m.text}</div>}
                      {!m.text && !m.image && <span className="opacity-60">（仅图片）</span>}
                    </div>
                  </div>
                ) : (
                  <div key={i} className="flex justify-start">
                    {renderAgent(m)}
                  </div>
                ),
              )}
              {busy && (
                <div className="flex justify-start">
                  <div className="rounded-2xl rounded-tl-sm border border-zinc-200 bg-white px-4 py-3 text-sm text-zinc-400 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
                    Agent 思考中…
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* 回到底部（需求一：用户上滑查看历史时出现；点击回到底部并恢复跟随） */}
        {showJump && (
          <button
            data-testid="jump-to-bottom"
            onClick={() => scrollToBottom("auto")}
            className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full bg-black px-4 py-1.5 text-xs font-medium text-white shadow-lg transition hover:opacity-80 dark:bg-white dark:text-black"
          >
            回到底部 ↓
          </button>
        )}
      </div>

      {error && (
        <div className="mx-auto w-full max-w-2xl px-6 pb-2">
          <div className="rounded-xl border border-red-300 bg-red-50 px-4 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
            {error}
          </div>
        </div>
      )}

      <div className="border-t border-zinc-200 px-6 py-4 dark:border-zinc-800">
        <div className="mx-auto max-w-2xl">
          <div className="flex items-end gap-2">
            <div className="flex-1">
              {image && (
                <div className="mb-2 flex items-center gap-2">
                  <img
                    src={image}
                    alt="待发送的截图"
                    className="h-14 rounded-lg border border-zinc-300 object-cover dark:border-zinc-700"
                  />
                  <button
                    onClick={() => setImage(null)}
                    className="text-xs text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
                  >
                    移除
                  </button>
                </div>
              )}
              <textarea
                data-testid="chat-input"
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void send();
                  }
                }}
                placeholder="和 Agent 说说…（Enter 发送，Shift+Enter 换行）"
                rows={2}
                className="w-full resize-none rounded-xl border border-zinc-300 bg-white px-3 py-2 text-sm text-black outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
              />
            </div>
            <button
              onClick={() => fileRef.current?.click()}
              className="shrink-0 rounded-lg px-3 py-2 text-xs font-medium text-zinc-500 ring-1 ring-zinc-300 transition hover:bg-zinc-100 dark:ring-zinc-700 dark:hover:bg-zinc-800"
              title="上传聊天截图（可选）"
            >
              截图
            </button>
            <button
              onClick={() => void send()}
              disabled={busy || (!text.trim() && !image)}
              className="shrink-0 rounded-lg bg-black px-4 py-2 text-sm font-medium text-white transition hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-white dark:text-black"
            >
              {busy ? "…" : "发送"}
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => void onPickImage(e.target.files?.[0])}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
