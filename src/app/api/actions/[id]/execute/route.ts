import { NextRequest, NextResponse } from "next/server";
import { ActionCardError, viewAction } from "../../../../../server/actions";
import { UnauthorizedExecutionError, VerifierRejectedError } from "../../../../../server/execution";
import { executeWithTools } from "../../../../../server/tools";
import { verifyAction } from "../../../../../server/verifier";
import { createEmbeddingProvider } from "../../../../../server/embedding";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function handleError(err: unknown): NextResponse {
  if (err instanceof UnauthorizedExecutionError) {
    return NextResponse.json(
      { ok: false, error: { code: "UNAUTHORIZED", message: err.message } },
      { status: 403 },
    );
  }
  if (err instanceof VerifierRejectedError) {
    return NextResponse.json(
      {
        ok: false,
        error: { code: "VERIFIER_REJECTED", message: err.message, verification: err.verification },
      },
      { status: 422 },
    );
  }
  if (err instanceof ActionCardError) {
    const status = err.code === "NOT_FOUND" ? 404 : 400;
    return NextResponse.json({ ok: false, error: { code: err.code, message: err.message } }, { status });
  }
  return NextResponse.json(
    { ok: false, error: { code: "INTERNAL", message: err instanceof Error ? err.message : String(err) } },
    { status: 500 },
  );
}

/** POST /api/actions/:id/execute — 确认后执行（Task 16：UI 触发 Tool Executor + Verified Memory） */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const { id } = await params;
    // Task 25 Verifier：用户确认后、真正执行前独立校验（状态异常/重复执行/参数/目标存在）
    const act = await viewAction(id);
    const verification = await verifyAction(act, { stage: "execute", now: new Date() });
    if (!verification.passed) {
      throw new VerifierRejectedError(
        verification.issues.map((i) => i.message).join("；"),
        id,
        verification,
      );
    }
    const result = await executeWithTools(id, { embeddingProvider: createEmbeddingProvider() });
    const action = await viewAction(id);
    return NextResponse.json({ ok: true, result, action });
  } catch (err) {
    return handleError(err);
  }
}
