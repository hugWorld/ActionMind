import { NextRequest, NextResponse } from "next/server";
import { queryTasks } from "../../../server/tasks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Task 18 (Stage C) — 日程查询 API（Schedule 页面数据源，与 Agent task_search 共享 queryTasks）
 * GET /api/tasks?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD&contactName=...&status=...&includeCancelled=true
 * 默认隐藏 CANCELLED（需求十：默认视图不显示已取消，可显式打开）。
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const sp = new URL(request.url).searchParams;
  const tasks = await queryTasks({
    id: sp.get("id") ?? undefined,
    title: sp.get("title") ?? undefined,
    contactId: sp.get("contactId") ?? undefined,
    contactName: sp.get("contactName") ?? undefined,
    taskType: sp.get("taskType") ?? undefined,
    status: sp.get("status") ?? undefined,
    startDate: sp.get("startDate") ?? undefined,
    endDate: sp.get("endDate") ?? undefined,
    startTime: sp.get("startTime") ?? undefined,
    includeCancelled: sp.get("includeCancelled") === "true",
    limit: sp.get("limit") ? Number(sp.get("limit")) : undefined,
  });
  return NextResponse.json({ ok: true, tasks });
}
