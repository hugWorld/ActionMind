import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "../src/server/db";
import type { Prisma } from "@prisma/client";
import { confirmAction } from "../src/server/actions";
import {
  UnauthorizedExecutionError,
  assertActionConfirmed,
  executeAction,
} from "../src/server/execution";

// Gate 11 — Human-in-the-loop Guard
// DRAFT → execute 必须失败；CONFIRMED → execute 才能成功；Unauthorized Write = 0

describe("Task 11: Human-in-the-loop Guard", () => {
  const createdActions: string[] = [];
  const createdContacts: string[] = [];

  async function createAction(status: "DRAFT" | "CONFIRMED", payload: Record<string, unknown>): Promise<string> {
    let id = "";
    if (status === "DRAFT") {
      const a = await prisma.action.create({
        data: { type: "CREATE_CONTACT", status: "DRAFT", payload: payload as Prisma.InputJsonValue, source: "test" },
      });
      id = a.id;
    } else {
      const a = await prisma.action.create({
        data: { type: "CREATE_CONTACT", status: "DRAFT", payload: payload as Prisma.InputJsonValue, source: "test" },
      });
      id = a.id;
      await confirmAction(id);
    }
    createdActions.push(id);
    return id;
  }

  /** 副作用工具：真实创建联系人（验证"执行"真的发生） */
  async function runCreateContact(action: { type: string; payload: Prisma.JsonValue }) {
    const payload = (action.payload ?? {}) as Record<string, unknown>;
    const name = payload.contact
      ? String((payload.contact as Record<string, unknown>).name ?? "")
      : String(payload.name ?? "");
    if (!name) throw new Error("缺少联系人姓名");
    const c = await prisma.contact.create({
      data: {
        name,
        organization: payload.organization ? String(payload.organization) : null,
      },
    });
    createdContacts.push(c.id);
    return { contactId: c.id, name };
  }

  async function countExecutions(actionId: string): Promise<number> {
    const rows = await prisma.$queryRaw<Array<{ c: number }>>`
      SELECT count(*)::int AS c FROM executions WHERE action_id = ${actionId}
    `;
    return Number(rows[0].c);
  }

  afterAll(async () => {
    for (const id of createdContacts) await prisma.contact.delete({ where: { id } }).catch(() => {});
    for (const id of createdActions) await prisma.action.delete({ where: { id } }).catch(() => {});
    await prisma.$disconnect();
  });

  it("assertActionConfirmed：CONFIRMED 通过，非 CONFIRMED 抛 UNAUTHORIZED", async () => {
    await expect(assertActionConfirmed({ id: "x", status: "DRAFT" })).rejects.toBeInstanceOf(
      UnauthorizedExecutionError,
    );
    await expect(assertActionConfirmed({ id: "x", status: "CANCELLED" })).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    await expect(assertActionConfirmed({ id: "x", status: "CONFIRMED" })).resolves.toMatchObject({
      status: "CONFIRMED",
    });
  });

  it("DRAFT → execute 必须失败，且不产生任何写入（Unauthorized Write = 0）", async () => {
    const id = await createAction("DRAFT", {
      contact: { name: "未授权联系人" },
    });
    // 副作用基线：以本文件创建的联系人数为准（并行测试文件也会创建联系人，全库计数不可靠）
    const contactsBefore = createdContacts.length;

    await expect(executeAction(id, { toolName: "create_contact", run: runCreateContact })).rejects.toBeInstanceOf(
      UnauthorizedExecutionError,
    );

    // 无 Execution 记录、Action 仍 DRAFT、工具未被调用（无新联系人副作用）
    expect(await countExecutions(id)).toBe(0);
    const action = await prisma.action.findUniqueOrThrow({ where: { id } });
    expect(action.status).toBe("DRAFT");
    expect(createdContacts.length).toBe(contactsBefore);
  });

  it("CONFIRMED → execute 成功：Execution SUCCESS、Action SUCCESS、副作用真实发生", async () => {
    const id = await createAction("CONFIRMED", {
      contact: { name: "已授权联系人" },
      organization: "某某公司",
    });
    const contactsBefore = createdContacts.length;

    const result = await executeAction(id, { toolName: "create_contact", run: runCreateContact });
    expect(result.ok).toBe(true);
    expect(result.executionId).toBeTruthy();

    const action = await prisma.action.findUniqueOrThrow({ where: { id } });
    expect(action.status).toBe("SUCCESS");
    const execution = await prisma.execution.findUniqueOrThrow({ where: { id: result.executionId! } });
    expect(execution.status).toBe("SUCCESS");
    expect(execution.toolName).toBe("create_contact");

    expect(createdContacts.length).toBe(contactsBefore + 1);
  });

  it("CONFIRMED 但执行失败 → Action FAILED、Execution FAILED（不抛未捕获错误）", async () => {
    const id = await createAction("CONFIRMED", { contact: { name: "" } });
    const result = await executeAction(id, { toolName: "create_contact", run: runCreateContact });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("缺少联系人姓名");
    const action = await prisma.action.findUniqueOrThrow({ where: { id } });
    expect(action.status).toBe("FAILED");
    const execution = await prisma.execution.findUniqueOrThrow({ where: { id: result.executionId! } });
    expect(execution.status).toBe("FAILED");
  });

  it("not_found：不存在的 Action → 执行被拒绝", async () => {
    await expect(executeAction("no-such-action", { toolName: "create_contact", run: runCreateContact })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});
