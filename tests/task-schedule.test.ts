import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Prisma } from "@prisma/client";
import { prisma } from "../src/server/db";
import { createEmbeddingProvider } from "../src/server/embedding";
import type { EmbeddingProvider } from "../src/server/embedding";
import { ensureEmbedServer } from "./helpers/ensure-embed";
import { confirmAction } from "../src/server/actions";
import { executeWithTools } from "../src/server/tools";
import { queryTasks, findTaskById } from "../src/server/tasks";
import { UnauthorizedExecutionError } from "../src/server/execution";

// Task 18 (Stage A) — Task/ScheduleItem 数据层：
//   - Meeting → Task(type=MEETING) 兼容层（task_type 列）
//   - queryTasks 共享查询（task_search 与 Schedule 页共用）
//   - cancel_task（状态更新为 cancelled，不物理删除）+ update_task，均走 Human-in-the-loop
// 唯一命名避免并行冲突（vitest 文件级串行已开启，仍用独立标题防种子污染）。

describe("Task 18: Task & Schedule 数据层", () => {
  let embedding: EmbeddingProvider;
  const createdContacts: string[] = [];
  const createdMeetings: string[] = [];
  const createdActions: string[] = [];

  async function makeAction(type: string, payload: Record<string, unknown>) {
    const a = await prisma.action.create({
      data: { type, status: "DRAFT", payload: payload as Prisma.InputJsonValue, source: "test" },
    });
    createdActions.push(a.id);
    return a;
  }

  async function makeTask(payload: Record<string, unknown>) {
    // 直接经工具创建真实任务（也可用 prisma 直建；此处走 create_event 保证与生产一致）
    const action = await makeAction("CREATE_TASK", payload);
    await confirmAction(action.id);
    const result = await executeWithTools(action.id, { embeddingProvider: embedding });
    expect(result.ok).toBe(true);
    const meetingId = (result.response as { meetingId: string }).meetingId;
    createdMeetings.push(meetingId);
    return meetingId;
  }

  beforeAll(async () => {
    await ensureEmbedServer();
    embedding = createEmbeddingProvider();
    const c = await prisma.contact.create({
      data: {
        name: "欧阳锋",
        phones: { create: [{ phone: "13900139000", verified: true, active: true, source: "seed" }] },
      },
    });
    createdContacts.push(c.id);
  }, 180_000);

  afterAll(async () => {
    for (const id of createdActions) {
      const mems = await prisma.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM memories WHERE metadata->>'actionId' = ${id}
      `;
      for (const m of mems) await prisma.memory.delete({ where: { id: m.id } }).catch(() => {});
    }
    for (const id of createdMeetings) await prisma.meeting.delete({ where: { id } }).catch(() => {});
    for (const id of createdContacts) await prisma.contact.delete({ where: { id } }).catch(() => {});
    for (const id of createdActions) await prisma.action.delete({ where: { id } }).catch(() => {});
    await prisma.$disconnect();
  });

  it("CREATE_TASK(type=TODO) → create_event 落 task_type 列（兼容层）", async () => {
    const action = await makeAction("CREATE_TASK", {
      title: "写周报（欧阳锋）",
      type: "TODO",
      start: "2026-10-09T15:00:00+08:00",
      contact: { name: "欧阳锋", contactId: createdContacts[0] },
      notes: "示例备注",
    });
    await confirmAction(action.id);
    const result = await executeWithTools(action.id, { embeddingProvider: embedding });
    expect(result.ok).toBe(true);
    const r = result.response as { meetingId: string; taskType: string; notes: string | null };
    createdMeetings.push(r.meetingId);
    const row = await prisma.meeting.findUniqueOrThrow({ where: { id: r.meetingId } });
    expect(row.taskType).toBe("TODO");
    expect(row.notes).toBe("示例备注");
  });

  it("queryTasks：日期范围 + 联系人过滤 + 状态视图映射", async () => {
    const cid = createdContacts[0];
    const m1 = await makeTask({
      title: "与欧阳锋的方案会",
      start: "2026-10-09T15:00:00+08:00",
      end: "2026-10-09T16:00:00+08:00",
      location: "三楼会议室",
      contact: { name: "欧阳锋", contactId: cid },
    });
    const m2 = await makeTask({
      title: "与欧阳锋的茶叙",
      start: "2026-10-10T10:00:00+08:00",
      contact: { name: "欧阳锋", contactId: cid },
    });
    // 不在范围内（另一天 + 另一联系人）
    await makeTask({
      title: "无关任务（黄药师）",
      start: "2026-10-12T09:00:00+08:00",
      contact: { name: "黄药师" },
    });

    const onFriday = await queryTasks({ startDate: "2026-10-09", endDate: "2026-10-09" });
    expect(onFriday.map((t) => t.id)).toContain(m1);
    expect(onFriday.map((t) => t.id)).not.toContain(m2);

    const withOuyang = await queryTasks({ contactId: cid, startDate: "2026-10-09", endDate: "2026-10-11" });
    expect(withOuyang.map((t) => t.id)).toEqual(expect.arrayContaining([m1, m2]));
    expect(withOuyang.map((t) => t.id)).not.toContain(
      (await queryTasks({ title: "无关任务" })).map((t) => t.id),
    );

    const byName = await queryTasks({ contactName: "欧阳锋" });
    expect(byName.map((t) => t.id)).toEqual(expect.arrayContaining([m1, m2]));

    // 状态视图：新建任务为 CONFIRMED（DB scheduled）
    const row = await queryTasks({ id: m1 });
    expect(row[0].statusView).toBe("CONFIRMED");
    expect(row[0].status).toBe("scheduled");
  });

  it("CANCEL_TASK 完整链路：取消 → status=cancelled + Verified Memory + 记录不删除", async () => {
    const mid = await makeTask({
      title: "待取消的会议（欧阳锋）",
      start: "2026-10-16T15:00:00+08:00",
      contact: { name: "欧阳锋", contactId: createdContacts[0] },
    });

    const action = await makeAction("CANCEL_TASK", {
      taskId: mid,
      reason: "行程冲突",
    });
    await confirmAction(action.id);
    const result = await executeWithTools(action.id, { embeddingProvider: embedding });
    expect(result.ok).toBe(true);
    const r = result.response as { taskId: string; status: string; cancelled: boolean };
    expect(r.taskId).toBe(mid);
    expect(r.status).toBe("cancelled");
    expect(r.cancelled).toBe(true);

    // 记录保留（不物理删除）
    const row = await prisma.meeting.findUniqueOrThrow({ where: { id: mid } });
    expect(row.status).toBe("cancelled");

    // Verified Memory 沉淀
    const mems = await prisma.memory.findMany({
      where: { metadata: { path: ["actionId"], equals: action.id } },
    });
    expect(mems.length).toBe(1);
    expect(mems[0].source).toBe("tool_verified");
    expect(mems[0].content).toContain("已取消任务");
    expect(mems[0].content).toContain("行程冲突");

    // 默认范围查询隐藏 CANCELLED（需求十）；显式 includeCancelled 可见
    const rangeDefault = await queryTasks({ startDate: "2026-10-16", endDate: "2026-10-16" });
    expect(rangeDefault.map((t) => t.id)).not.toContain(mid);
    const withCancelled = await queryTasks({ id: mid, includeCancelled: true });
    expect(withCancelled[0].statusView).toBe("CANCELLED");
  });

  it("UPDATE_TASK：修改标题/时间/地点 → 更新 + Verified Memory", async () => {
    const mid = await makeTask({
      title: "旧标题的会议（欧阳锋）",
      start: "2026-10-09T15:00:00+08:00",
      location: "一楼大厅",
      contact: { name: "欧阳锋", contactId: createdContacts[0] },
    });

    const action = await makeAction("UPDATE_TASK", {
      taskId: mid,
      changes: {
        title: "新标题的会议",
        start: "2026-10-09T16:00:00+08:00",
        end: "2026-10-09T17:00:00+08:00",
        location: "二楼会议室",
      },
    });
    await confirmAction(action.id);
    const result = await executeWithTools(action.id, { embeddingProvider: embedding });
    expect(result.ok).toBe(true);

    const row = await prisma.meeting.findUniqueOrThrow({ where: { id: mid } });
    expect(row.title).toBe("新标题的会议");
    expect(row.startAt.toISOString()).toBe(new Date("2026-10-09T08:00:00Z").toISOString());
    expect(row.location).toBe("二楼会议室");

    const mems = await prisma.memory.findMany({
      where: { metadata: { path: ["actionId"], equals: action.id } },
    });
    expect(mems.length).toBe(1);
    expect(mems[0].source).toBe("tool_verified");
    expect(mems[0].content).toContain("已更新");
  });

  it("CANCEL_TASK 未 CONFIRMED 直接 execute → 守卫拒绝", async () => {
    const mid = await makeTask({
      title: "守卫测试任务（欧阳锋）",
      start: "2026-10-23T09:00:00+08:00",
    });
    const action = await makeAction("CANCEL_TASK", { taskId: mid, reason: "未确认" });
    await expect(executeWithTools(action.id)).rejects.toBeInstanceOf(UnauthorizedExecutionError);
    const row = await prisma.meeting.findUniqueOrThrow({ where: { id: mid } });
    expect(row.status).toBe("scheduled"); // 未被取消
  });

  it("已取消任务不可再修改（update_task 拒绝）", async () => {
    const mid = await makeTask({
      title: "将被取消再尝试修改的任务",
      start: "2026-10-30T10:00:00+08:00",
    });
    const cancel = await makeAction("CANCEL_TASK", { taskId: mid });
    await confirmAction(cancel.id);
    await executeWithTools(cancel.id);

    const update = await makeAction("UPDATE_TASK", {
      taskId: mid,
      changes: { title: "改标题" },
    });
    await confirmAction(update.id);
    const result = await executeWithTools(update.id);
    expect(result.ok).toBe(false);
    expect(result.error).toContain("已取消");
    const row = await prisma.meeting.findUniqueOrThrow({ where: { id: mid } });
    expect(row.status).toBe("cancelled");
    expect(row.title).not.toBe("改标题");
  });

  it("findTaskById：不存在 → null", async () => {
    expect(await findTaskById("nonexistent-id-xyz")).toBeNull();
  });
});
