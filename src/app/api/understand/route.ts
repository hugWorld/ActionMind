import { createDeepSeekProvider } from "../../../server/llm/deepseek";
import { understandScreenshot } from "../../../server/llm/understand";
import { LLMError } from "../../../server/llm/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED_MIME = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
]);
const MAX_SIZE = 10 * 1024 * 1024; // 10MB

/**
 * Task 3 — Screenshot Understanding API
 * POST /api/understand
 *   multipart/form-data: screenshot(文件) + userText(可选)
 *   application/json:    { imageDataUrl: "data:image/*;base64,...", userText? }
 * → { ok: true, understanding: ChatUnderstanding }
 */
export async function POST(request: Request): Promise<Response> {
  let imageDataUrl: string;
  let userText: string | undefined;

  const contentType = request.headers.get("content-type") ?? "";

  try {
    if (contentType.includes("multipart/form-data")) {
      const form = await request.formData();
      const file = form.get("screenshot");
      if (!(file instanceof File)) {
        return json({ ok: false, error: "缺少 screenshot 图片文件" }, 400);
      }
      if (!ALLOWED_MIME.has(file.type)) {
        return json(
          { ok: false, error: `不支持的图片类型: ${file.type || "unknown"}（仅支持 JPEG/PNG/GIF/WebP）` },
          400,
        );
      }
      if (file.size > MAX_SIZE) {
        return json({ ok: false, error: "图片过大（上限 10MB）" }, 400);
      }
      const buf = Buffer.from(await file.arrayBuffer());
      imageDataUrl = `data:${file.type};base64,${buf.toString("base64")}`;
      const ut = form.get("userText");
      userText = typeof ut === "string" && ut.trim() ? ut.trim() : undefined;
    } else {
      const body = await request.json().catch(() => null);
      if (
        !body ||
        typeof body.imageDataUrl !== "string" ||
        !body.imageDataUrl.startsWith("data:image/")
      ) {
        return json(
          { ok: false, error: "JSON body 需包含 data:image/* 的 imageDataUrl 字段" },
          400,
        );
      }
      imageDataUrl = body.imageDataUrl;
      userText =
        typeof body.userText === "string" && body.userText.trim()
          ? body.userText.trim()
          : undefined;
    }
  } catch (err) {
    return json(
      { ok: false, error: `请求解析失败: ${err instanceof Error ? err.message : String(err)}` },
      400,
    );
  }

  if (!process.env.DEEPSEEK_API_KEY) {
    return json({ ok: false, error: "服务端未配置 DEEPSEEK_API_KEY" }, 503);
  }

  try {
    const understanding = await understandScreenshot(
      createDeepSeekProvider(),
      { imageDataUrl, userText },
    );
    return json({ ok: true, understanding }, 200);
  } catch (err) {
    const msg =
      err instanceof LLMError
        ? err.message
        : err instanceof Error
          ? err.message
          : String(err);
    return json({ ok: false, error: `理解失败: ${msg}` }, 502);
  }
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
