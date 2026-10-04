import { NextRequest, NextResponse } from "next/server";
import {
  ActionCardError,
  viewAction,
  updateActionFields,
} from "../../../../server/actions";

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

/** GET /api/actions/:id — 卡片详情 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const { id } = await params;
    const action = await viewAction(id);
    return NextResponse.json({ ok: true, action });
  } catch (err) {
    return handleError(err);
  }
}

/** PATCH /api/actions/:id — 编辑卡片字段（title/start/end/location/contact/notes/missing） */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const { id } = await params;
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json(
        { ok: false, error: { code: "INVALID_FIELDS", message: "PATCH body 必须是 JSON 对象" } },
        { status: 400 },
      );
    }
    const action = await updateActionFields(id, body as Record<string, unknown>);
    return NextResponse.json({ ok: true, action });
  } catch (err) {
    return handleError(err);
  }
}
