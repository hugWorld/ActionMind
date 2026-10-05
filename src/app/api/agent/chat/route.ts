import { createDeepSeekProvider } from "../../../../server/llm/deepseek";
import { createEmbeddingProvider } from "../../../../server/embedding";
import { runAgentSession } from "../../../../server/agent/runtime";
import { LLMError } from "../../../../server/llm/types";
import type { AgentSessionResult } from "../../../../server/agent/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // 10MB

/**
 * Task 17 (Stage B) — Agent 对话入口（真正的对话式 ReAct Loop）
 * POST /api/agent/chat
 *   body: { sessionId?, text?, imageDataUrl? }
 *   - Text only：只传 text
 *   - Image only：只传 imageDataUrl
 *   - Text + Image：两者都传（text 作为补充说明）
 *   - 多轮：每次携带上一轮返回的 sessionId 续跑（ask_user 后的回答 / 卡片修改意见都走这里）
 * → { ok, outcome, sessionId, state: { phase, missingRequiredInfo, currentAction } }
 */
export async function POST(request: Request): Promise<Response> {
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return json({ ok: false, error: "请求体需为 JSON：{ sessionId?, text?, imageDataUrl? }" }, 400);
  }

  const text = typeof body.text === "string" && body.text.trim() ? body.text.trim() : undefined;
  const imageDataUrl =
    typeof body.imageDataUrl === "string" && body.imageDataUrl.trim()
      ? body.imageDataUrl.trim()
      : undefined;
  const sessionId = typeof body.sessionId === "string" && body.sessionId.trim() ? body.sessionId.trim() : undefined;

  if (!text && !imageDataUrl) {
    return json({ ok: false, error: "至少需要 text 或 imageDataUrl 之一（Text only / Image only / Text+Image）" }, 400);
  }
  if (imageDataUrl && !imageDataUrl.startsWith("data:image/")) {
    return json({ ok: false, error: "imageDataUrl 必须是 data:image/* 格式" }, 400);
  }
  if (imageDataUrl) {
    const sizeBytes = Buffer.byteLength(imageDataUrl);
    if (sizeBytes > MAX_IMAGE_BYTES * 1.4) {
      // base64 膨胀约 4/3，粗略换算后超限即拒绝
      return json({ ok: false, error: "图片过大（上限 10MB）" }, 400);
    }
  }

  if (!process.env.DEEPSEEK_API_KEY) {
    return json({ ok: false, error: "服务端未配置 DEEPSEEK_API_KEY" }, 503);
  }

  try {
    const result: AgentSessionResult = await runAgentSession(
      { text, imageDataUrl, sessionId },
      {
        provider: createDeepSeekProvider(),
        embeddingProvider: createEmbeddingProvider(),
      },
    );
    const { outcome, state } = result;
    return json(
      {
        ok: true,
        outcome,
        sessionId: result.sessionId,
        state: {
          phase: state.phase,
          goal: state.goal,
          missingRequiredInfo: state.missingRequiredInfo,
          currentAction: state.currentAction,
          askedQuestions: state.askedQuestions,
          traceCount: state.trace.length,
        },
      },
      200,
    );
  } catch (err) {
    const msg =
      err instanceof LLMError
        ? err.message
        : err instanceof Error
          ? err.message
          : String(err);
    return json({ ok: false, error: `Agent 对话失败: ${msg}` }, 502);
  }
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
