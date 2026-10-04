import { afterAll, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "../src/server/db";
import type { Prisma } from "@prisma/client";
import {
  ActionCardError,
  cancelAction,
  confirmAction,
  listActions,
  updateActionFields,
  viewAction,
} from "../src/server/actions";
import {
  GET as listGet,
} from "../src/app/api/actions/route";
import {
  GET as detailGet,
  PATCH as detailPatch,
} from "../src/app/api/actions/[id]/route";
import {
  POST as confirmPost,
} from "../src/app/api/actions/[id]/confirm/route";
import {
  POST as cancelPost,
} from "../src/app/api/actions/[id]/cancel/route";

// Gate 10 — Action Card：View / Edit / Cancel / Confirm
// 用户能够修改 Time / Location / Contact / Title

describe("Task 10: Action Card", () => {
  const created: string[] = [];
  let actionId = "";

  async function createDraft(payload: Record<string, unknown>): Promise<string> {
    const a = await prisma.action.create({
      data: { type: "CREATE_MEETING", status: "DRAFT", payload: payload as Prisma.InputJsonValue, source: "test" },
    });
    created.push(a.id);
    return a.id;
  }

  afterAll(async () => {
    for (const id of created) await prisma.action.delete({ where: { id } }).catch(() => {});
    await prisma.$disconnect();
  });

  it("View + Edit：逐个修改 Time / Location / Contact / Title，其他字段保留，证据留痕", async () => {
    actionId = await createDraft({
      title: "和张三开会",
      start: "2026-10-09T15:00:00+08:00",
      location: "星巴克",
      contact: { name: "张三", email: "zhangsan@example.com" },
      notes: "确认预算",
    });

    // 修改 Title
    let a = await updateActionFields(actionId, { title: "和张三的季度评审会" });
    expect((a.payload as Record<string, unknown>).title).toBe("和张三的季度评审会");
    // 修改 Time
    a = await updateActionFields(actionId, { start: "2026-10-10T10:00:00+08:00" });
    expect((a.payload as Record<string, unknown>).start).toBe("2026-10-10T10:00:00+08:00");
    // 修改 Location
    a = await updateActionFields(actionId, { location: "Meeting Room 3" });
    expect((a.payload as Record<string, unknown>).location).toBe("Meeting Room 3");
    // 修改 Contact
    a = await updateActionFields(actionId, { contact: { name: "张三", phone: "13800000000" } });
    expect((a.payload as Record<string, unknown>).contact).toMatchObject({ name: "张三", phone: "13800000000" });

    // 其他字段保留 + status 仍 DRAFT
    const payload = a.payload as Record<string, unknown>;
    expect(payload.notes).toBe("确认预算");
    expect(a.status).toBe("DRAFT");

    // 编辑证据留痕（4 次实际变更）
    const evidence = a.evidence as { edits?: Array<{ field: string }> };
    expect(evidence.edits?.length).toBe(4);
    const fields = evidence.edits!.map((e) => e.field);
    expect(fields).toEqual(expect.arrayContaining(["title", "start", "location", "contact"]));

    // View 读取
    const viewed = await viewAction(actionId);
    expect(viewed.id).toBe(actionId);
    expect((viewed.payload as Record<string, unknown>).title).toBe("和张三的季度评审会");
  });

  it("Edit 校验：未知字段拒绝、类型错误拒绝", async () => {
    await expect(
      updateActionFields(actionId, { unknownField: 1 } as unknown as Record<string, unknown>),
    ).rejects.toMatchObject({ code: "INVALID_FIELDS" });
    await expect(
      updateActionFields(actionId, { start: 123 } as unknown as Record<string, unknown>),
    ).rejects.toMatchObject({ code: "INVALID_FIELDS" });
    await expect(
      updateActionFields(actionId, { missing: "time" } as unknown as Record<string, unknown>),
    ).rejects.toMatchObject({ code: "INVALID_FIELDS" });
  });

  it("Confirm：DRAFT → CONFIRMED；之后 Edit / Cancel 被拒绝", async () => {
    const confirmed = await confirmAction(actionId);
    expect(confirmed.status).toBe("CONFIRMED");
    await expect(updateActionFields(actionId, { title: "x" })).rejects.toMatchObject({
      code: "INVALID_STATE",
    });
    await expect(cancelAction(actionId)).rejects.toMatchObject({ code: "INVALID_STATE" });
  });

  it("Cancel：DRAFT → CANCELLED；之后 Confirm / Edit 被拒绝", async () => {
    const id = await createDraft({ title: "待取消", start: "2026-10-11T09:00:00+08:00" });
    const cancelled = await cancelAction(id);
    expect(cancelled.status).toBe("CANCELLED");
    await expect(confirmAction(id)).rejects.toMatchObject({ code: "INVALID_STATE" });
    await expect(updateActionFields(id, { title: "x" })).rejects.toMatchObject({
      code: "INVALID_STATE",
    });
  });

  it("View：不存在的 Action → NOT_FOUND", async () => {
    await expect(viewAction("no-such-id")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("路由层：GET 列表 / GET 详情 / PATCH / confirm / cancel 返回正确状态码", async () => {
    const fresh = await createDraft({ title: "路由测试", start: "2026-10-12T14:00:00+08:00" });

    const listRes = await listGet(new NextRequest("http://localhost/api/actions?status=DRAFT"));
    expect(listRes.status).toBe(200);
    const listBody = (await listRes.json()) as { ok: boolean; actions: Array<{ id: string }> };
    expect(listBody.actions.some((x) => x.id === fresh)).toBe(true);

    const detailRes = await detailGet(new NextRequest(`http://localhost/api/actions/${fresh}`), {
      params: Promise.resolve({ id: fresh }),
    });
    expect(detailRes.status).toBe(200);

    const patchRes = await detailPatch(
      new NextRequest(`http://localhost/api/actions/${fresh}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ location: "3F 会议室" }),
      }),
      { params: Promise.resolve({ id: fresh }) },
    );
    expect(patchRes.status).toBe(200);
    const patched = (await patchRes.json()) as { action: { payload: Record<string, unknown> } };
    expect(patched.action.payload.location).toBe("3F 会议室");

    const confirmRes = await confirmPost(new NextRequest(`http://localhost/api/actions/${fresh}/confirm`), {
      params: Promise.resolve({ id: fresh }),
    });
    expect(confirmRes.status).toBe(200);
    const confirmed = (await confirmRes.json()) as { action: { status: string } };
    expect(confirmed.action.status).toBe("CONFIRMED");

    // 已确认 → PATCH 400
    const patchConfirmed = await detailPatch(
      new NextRequest(`http://localhost/api/actions/${fresh}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "x" }),
      }),
      { params: Promise.resolve({ id: fresh }) },
    );
    expect(patchConfirmed.status).toBe(400);

    // 404
    const missing = await detailGet(new NextRequest("http://localhost/api/actions/does-not-exist"), {
      params: Promise.resolve({ id: "does-not-exist" }),
    });
    expect(missing.status).toBe(404);

    // cancel 路由（新卡片）
    const fresh2 = await createDraft({ title: "取消路由", start: "2026-10-13T10:00:00+08:00" });
    const cancelRes = await cancelPost(new NextRequest(`http://localhost/api/actions/${fresh2}/cancel`), {
      params: Promise.resolve({ id: fresh2 }),
    });
    expect(cancelRes.status).toBe(200);
    const cancelled = (await cancelRes.json()) as { action: { status: string } };
    expect(cancelled.action.status).toBe("CANCELLED");
  });
});
