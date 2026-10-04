import { NextRequest, NextResponse } from "next/server";
import {
  ActionCardError,
  listActions,
  viewAction,
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
