import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "../src/server/db";

// Gate 1: 可以完成 Create Contact / Memory / Meeting / Action / Execution
describe("Task 1: Core Schema", () => {
  const suffix = Date.now().toString(36);
  const name = `测试联系人-${suffix}`;

  // 按依赖顺序逐个清理（不批量删除）
  const executions: string[] = [];
  const actions: string[] = [];
  const meetings: string[] = [];
  const memories: string[] = [];
  const contacts: string[] = [];

  afterAll(async () => {
    for (const id of executions) await prisma.execution.delete({ where: { id } }).catch(() => {});
    for (const id of actions) await prisma.action.delete({ where: { id } }).catch(() => {});
    for (const id of meetings) await prisma.meeting.delete({ where: { id } }).catch(() => {});
    for (const id of memories) await prisma.memory.delete({ where: { id } }).catch(() => {});
    for (const id of contacts) await prisma.contact.delete({ where: { id } }).catch(() => {});
    await prisma.$disconnect();
  });

  it("creates a Contact with email and phone", async () => {
    const contact = await prisma.contact.create({
      data: {
        name,
        organization: "示例公司",
        role: "Researcher",
        emails: {
          create: [
            {
              email: `test-${suffix}@example.com`,
              verified: true,
              active: true,
              source: "user_confirmed",
            },
          ],
        },
        phones: {
          create: [{ phone: `138${suffix.slice(-8)}`, source: "user_input" }],
        },
      },
      include: { emails: true, phones: true },
    });
    contacts.push(contact.id);
    expect(contact.id).toBeTruthy();
    expect(contact.emails).toHaveLength(1);
    expect(contact.emails[0].verified).toBe(true);
    expect(contact.phones).toHaveLength(1);
  });

  it("creates a Memory linked to the contact", async () => {
    const contact = await prisma.contact.findFirst({ where: { name } });
    expect(contact).toBeTruthy();
    const memory = await prisma.memory.create({
      data: {
        type: "meeting",
        contactId: contact!.id,
        content: `与 ${name} 在 Meeting Room 3 开会`,
        timestamp: new Date(),
        source: "tool_verified",
        confidence: 1.0,
        metadata: { location: "Meeting Room 3" },
      },
    });
    memories.push(memory.id);
    expect(memory.source).toBe("tool_verified");
    expect(memory.confidence).toBe(1.0);
  });

  it("creates a Meeting linked to the contact", async () => {
    const contact = await prisma.contact.findFirst({ where: { name } });
    expect(contact).toBeTruthy();
    const meeting = await prisma.meeting.create({
      data: {
        contactId: contact!.id,
        title: `与 ${name} 的会议`,
        startAt: new Date("2026-10-09T15:00:00+08:00"),
        endAt: new Date("2026-10-09T16:00:00+08:00"),
        location: "Meeting Room 3",
        status: "scheduled",
        source: "tool_verified",
      },
    });
    meetings.push(meeting.id);
    expect(meeting.location).toBe("Meeting Room 3");
    expect(meeting.status).toBe("scheduled");
  });

  it("creates an Action (DRAFT)", async () => {
    const action = await prisma.action.create({
      data: {
        type: "CREATE_MEETING",
        status: "DRAFT",
        payload: {
          title: "Project A Meeting",
          start: "2026-10-09T15:00:00+08:00",
          end: "2026-10-09T16:00:00+08:00",
          location: "Meeting Room 3",
        },
        source: "screenshot_extracted",
        evidence: ["screenshot"],
      },
    });
    actions.push(action.id);
    expect(action.status).toBe("DRAFT");
    expect((action.payload as { location: string }).location).toBe("Meeting Room 3");
    expect(action.evidence).toEqual(["screenshot"]);
  });

  it("creates an Execution for the action", async () => {
    const action = await prisma.action.findFirst({
      where: { type: "CREATE_MEETING" },
      orderBy: { createdAt: "desc" },
    });
    expect(action).toBeTruthy();
    const execution = await prisma.execution.create({
      data: {
        actionId: action!.id,
        toolName: "calendar.create_event",
        request: { title: "Project A Meeting" },
        response: { success: true, resource_id: "event_123" },
        status: "SUCCESS",
      },
    });
    executions.push(execution.id);
    expect(execution.status).toBe("SUCCESS");
    expect((execution.response as { resource_id: string }).resource_id).toBe("event_123");
  });
});
