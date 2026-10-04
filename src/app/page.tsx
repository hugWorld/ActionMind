"use client";

import { useRef, useState } from "react";

interface Contact {
  name: string | null;
  email: string | null;
  phone: string | null;
  organization: string | null;
}

interface MeetingPlan {
  title: string | null;
  start: string | null;
  end: string | null;
  location: string | null;
  needsMemory: boolean;
}

interface ContactUpdate {
  contactName: string | null;
  field: string | null;
  newValue: string | null;
}

interface Understanding {
  intent: string;
  contacts: Contact[];
  meeting: MeetingPlan | null;
  contactUpdate: ContactUpdate | null;
  missing: string[];
}

const INTENT_STYLE: Record<string, string> = {
  CREATE_MEETING: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200",
  CREATE_CONTACT: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200",
  UPDATE_CONTACT: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200",
  UNKNOWN: "bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
};

const FIELD_LABEL: Record<string, string> = {
  email: "邮箱",
  phone: "电话",
  organization: "公司",
  role: "职位",
};

export default function Home() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [userText, setUserText] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Understanding | null>(null);

  const onPick = (f: File | null) => {
    setFile(f);
    setError(null);
    setResult(null);
    if (f) {
      const reader = new FileReader();
      reader.onload = () => setPreview(String(reader.result));
      reader.readAsDataURL(f);
    } else {
      setPreview(null);
    }
  };

  const onSubmit = async () => {
    if (!file) {
      setError("请先选择一张聊天截图");
      return;
    }
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const form = new FormData();
      form.append("screenshot", file);
      if (userText.trim()) form.append("userText", userText.trim());
      const res = await fetch("/api/understand", { method: "POST", body: form });
      const body = await res.json();
      if (!res.ok || !body.ok) {
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      setResult(body.understanding as Understanding);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-1 justify-center bg-zinc-50 font-sans dark:bg-black">
      <main className="w-full max-w-3xl px-6 py-10">
        <header className="mb-8">
          <h1 className="text-3xl font-semibold tracking-tight text-black dark:text-zinc-50">
            ActionMind
          </h1>
          <p className="mt-1 text-zinc-600 dark:text-zinc-400">
            上传聊天截图，Agent 理解人物 / 时间 / 联系方式与行动意图。
          </p>
        </header>

        <section className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
          <div
            className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-zinc-300 px-6 py-8 text-center hover:border-zinc-400 dark:border-zinc-700"
            onClick={() => inputRef.current?.click()}
          >
            {preview ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={preview}
                alt="截图预览"
                className="max-h-56 rounded-lg border border-zinc-200 object-contain dark:border-zinc-800"
              />
            ) : (
              <p className="text-sm text-zinc-500 dark:text-zinc-400">
                点击选择聊天截图（JPEG / PNG / GIF / WebP，≤10MB）
              </p>
            )}
            <input
              ref={inputRef}
              type="file"
              accept="image/jpeg,image/png,image/gif,image/webp"
              className="hidden"
              onChange={(e) => onPick(e.target.files?.[0] ?? null)}
            />
          </div>

          <textarea
            value={userText}
            onChange={(e) => setUserText(e.target.value)}
            placeholder="补充说明（可选），例如：帮我约张三"
            rows={2}
            className="mt-4 w-full resize-none rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-black outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
          />

          <button
            onClick={onSubmit}
            disabled={loading}
            className="mt-4 w-full rounded-lg bg-black py-2.5 text-sm font-medium text-white transition hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-white dark:text-black"
          >
            {loading ? "理解中…" : "上传并理解"}
          </button>
        </section>

        {error && (
          <div className="mt-4 rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
            {error}
          </div>
        )}

        {result && (
          <section className="mt-6 space-y-4">
            <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
              <span
                className={`rounded-full px-3 py-1 text-xs font-medium ${INTENT_STYLE[result.intent] ?? INTENT_STYLE.UNKNOWN}`}
              >
                {result.intent}
              </span>
              {result.missing.length > 0 && (
                <span className="text-xs text-amber-600 dark:text-amber-400">
                  缺失：{result.missing.join(" / ")}
                </span>
              )}
            </div>

            {result.contacts.length > 0 && (
              <div className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
                <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-400">
                  联系人
                </h2>
                <ul className="space-y-1 text-sm text-zinc-700 dark:text-zinc-300">
                  {result.contacts.map((c, i) => (
                    <li key={i} className="flex flex-wrap gap-x-3">
                      <span className="font-medium">{c.name ?? "（无名）"}</span>
                      {c.email && <span>{c.email}</span>}
                      {c.phone && <span>{c.phone}</span>}
                      {c.organization && <span>{c.organization}</span>}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {result.meeting && (
              <div className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
                <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-400">
                  会议计划
                </h2>
                <dl className="grid grid-cols-1 gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
                  {result.meeting.title && (
                    <>
                      <dt className="text-zinc-400">标题</dt>
                      <dd className="text-zinc-700 dark:text-zinc-300">{result.meeting.title}</dd>
                    </>
                  )}
                  <dt className="text-zinc-400">开始</dt>
                  <dd className="text-zinc-700 dark:text-zinc-300">
                    {result.meeting.start ?? "（未确定）"}
                  </dd>
                  <dt className="text-zinc-400">结束</dt>
                  <dd className="text-zinc-700 dark:text-zinc-300">
                    {result.meeting.end ?? "（未确定）"}
                  </dd>
                  <dt className="text-zinc-400">地点</dt>
                  <dd className="text-zinc-700 dark:text-zinc-300">
                    {result.meeting.location ?? "（未确定）"}
                  </dd>
                  {result.meeting.needsMemory && (
                    <>
                      <dt className="text-zinc-400">历史引用</dt>
                      <dd className="font-medium text-violet-600 dark:text-violet-300">
                        需要检索记忆（needsMemory）
                      </dd>
                    </>
                  )}
                </dl>
              </div>
            )}

            {result.contactUpdate && (
              <div className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
                <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-400">
                  联系人更新
                </h2>
                <p className="text-sm text-zinc-700 dark:text-zinc-300">
                  {result.contactUpdate.contactName ?? "（未知联系人）"} →{" "}
                  <span className="font-medium">
                    {FIELD_LABEL[result.contactUpdate.field ?? ""] ?? result.contactUpdate.field}
                  </span>
                  ：{result.contactUpdate.newValue ?? "（未确定）"}
                </p>
              </div>
            )}

            <details className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
              <summary className="cursor-pointer text-xs font-medium uppercase tracking-wide text-zinc-400">
                原始结构化输出
              </summary>
              <pre className="mt-2 overflow-x-auto text-xs leading-5 text-zinc-600 dark:text-zinc-400">
                {JSON.stringify(result, null, 2)}
              </pre>
            </details>
          </section>
        )}
      </main>
    </div>
  );
}
