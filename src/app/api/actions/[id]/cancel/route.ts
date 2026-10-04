import { NextRequest, NextResponse } from "next/server";
import { ActionCardError, cancelAction } from "../../../../../server/actions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/actions/:id/cancel — 取消卡片（DRAFT → CANCELLED） */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const { id } = await params;
    const action = await cancelAction(id);
    return NextResponse.json({ ok: true, action });
  } catch (err) {
    if (err instanceof ActionCardError) {
      const status = err.code === "NOT_FOUND" ? 404 : 400;
      return NextResponse.json({ ok: false, error: { code: err.code, message: err.message } }, { status });
    }
    return NextResponse.json(
      { ok: false, error: { code: "INTERNAL", message: err instanceof Error ? err.message : String(err) } },
      { status: 500 },
    );
  }
}
