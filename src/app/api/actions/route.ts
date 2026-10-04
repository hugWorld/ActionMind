import { NextRequest, NextResponse } from "next/server";
import {
  ActionCardError,
  createActionCard,
  listActions,
  updateActionFields,
  confirmAction,
  cancelAction,
} from "../../../server/actions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function handleError(err: unknown): NextResponse {
  if (err instanceof ActionCardError) {
    const status = err.code === "NOT_FOUND" ? 404 : 400;
    return NextResponse.json({ ok: false, error: { code: err.code, message: err.message } }, { status });
  }
  return NextResponse.json(
    { ok: false, error: { code: "INTERNAL", message: err instanceof Error ? err.message : String(err) } },
    { status: 500 },
  );
}

/** GET /api/actions?status=DRAFT — 列表（可过滤） */
export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const status = new URL(request.url).searchParams.get("status") ?? undefined;
    const items = await listActions(status ? { status } : {});
    return NextResponse.json({ ok: true, actions: items });
  } catch (err) {
    return handleError(err);
  }
}

/** POST /api/actions — 由理解结果创建 Action Card（Task 16：UI 闭环入口） */
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json(
        { ok: false, error: { code: "INVALID_FIELDS", message: "body 必须是 JSON 对象" } },
        { status: 400 },
      );
    }
    const type = (body as Record<string, unknown>).type;
    const payload = (body as Record<string, unknown>).payload;
    if (typeof type !== "string") {
      return NextResponse.json(
        { ok: false, error: { code: "INVALID_FIELDS", message: "缺少 type" } },
        { status: 400 },
      );
    }
    const action = await createActionCard(type, (payload ?? {}) as Record<string, unknown>);
    return NextResponse.json({ ok: true, action });
  } catch (err) {
    return handleError(err);
  }
}
