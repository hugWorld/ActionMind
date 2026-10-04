import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Prisma } from "@prisma/client";
import { prisma } from "../src/server/db";
import { createDeepSeekProvider } from "../src/server/llm/deepseek";
import type { LLMProvider } from "../src/server/llm/types";
import { createEmbeddingProvider } from "../src/server/embedding";
import type { EmbeddingProvider } from "../src/server/embedding";
import { ensureEmbedServer } from "./helpers/ensure-embed";
import { runAgentLoop } from "../src/server/agent";
import { confirmAction } from "../src/server/actions";
import { executeWithTools } from "../src/server/tools";
import { UnauthorizedExecutionError } from "../src/server/execution";

// Gate 12 — Tool Executor（PostgreSQL-backed，mock 设备能力）
// 完整链路：Agent → Action → Confirm → Executor → Tool → Result
// 注意：种子联系人避免与 agent-runtime（张三/王小明）并行冲突，使用唯一姓名「李雷」。

describe("Task 12: Tool Executor", () => {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  let provider: LLMProvider | null = null;
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

  beforeAll(async () => {
    provider = apiKey ? createDeepSeekProvider() : null;
    if (!provider) console.warn("DEEPSEEK_API_KEY 缺失，真实 LLM 场景将跳过");
    await ensureEmbedServer();
    embedding = createEmbeddingProvider();
    // 种子联系人：李雷（唯一姓名，供真实 LLM 链路解析）
    const zs = await prisma.contact.create({
      data: {
        name: "李雷",
        emails: {
          create: [{ email: "lilei@example.com", verified: true, active: true, source: "seed" }],
        },
      },
    });
    createdContacts.push(zs.id);
  }, 180_000);

  afterAll(async () => {
    for (const id of createdMeetings) await prisma.meeting.delete({ where: { id } }).catch(() => {});
    for (const id of createdContacts) await prisma.contact.delete({ where: { id } }).catch(() => {});
    for (const id of createdActions) await prisma.action.delete({ where: { id } }).catch(() => {});
    await prisma.$disconnect();
  });

  it("Gate 12 完整链路（真实 LLM）：Agent → Action → Confirm → Executor → Tool → Result", async () => {
    if (!provider) return;
    const { outcome } = await runAgentLoop("帮我约李雷，周五下午三点。", {
      provider,
      embeddingProvider: embedding,
    });
    expect(outcome.kind).toBe("action_card");
    if (outcome.kind !== "action_card") return;
    expect(outcome.action.type).toBe("CREATE_MEETING");
    const id = outcome.action.id;
    createdActions.push(id);

    // Confirm
    await confirmAction(id);
    // Executor → Tool → Result
    const result = await executeWithTools(id);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const resPayload = result.response as { meetingId: string; startAt: string };
    expect(resPayload.meetingId).toBeTruthy();
    createdMeetings.push(resPayload.meetingId);

    // Result 落地校验：meeting 落库、Action=SUCCESS、Execution=SUCCESS(toolName=create_event)
    const meeting = await prisma.meeting.findUniqueOrThrow({ where: { id: resPayload.meetingId } });
    expect(meeting.status).toBe("scheduled");
    expect(meeting.startAt).toBeTruthy();
    expect(meeting.contactId).toBe(createdContacts[0]);
    const action = await prisma.action.findUniqueOrThrow({ where: { id } });
    expect(action.status).toBe("SUCCESS");
    const execution = await prisma.execution.findFirst({
      where: { actionId: id },
      orderBy: { createdAt: "desc" },
    });
    expect(execution?.status).toBe("SUCCESS");
    expect(execution?.toolName).toBe("create_event");
  }, 120_000);

  it("CREATE_CONTACT → create_contact：联系人 + 邮箱/电话子表落库", async () => {
    const contactsBefore = createdContacts.length;
    const action = await makeAction("CREATE_CONTACT", {
      name: "赵六",
      email: "zhaoliu@example.com",
      phone: "13800138000",
      organization: "某某科技",
    });
    await confirmAction(action.id);
    const result = await executeWithTools(action.id);
    expect(result.ok).toBe(true);
    const resPayload = result.response as { contactId: string };
    createdContacts.push(resPayload.contactId);

    const contact = await prisma.contact.findUniqueOrThrow({
      where: { id: resPayload.contactId },
      include: { emails: true, phones: true },
    });
    expect(contact.name).toBe("赵六");
    expect(contact.organization).toBe("某某科技");
    expect(contact.emails.map((e) => e.email)).toContain("zhaoliu@example.com");
    expect(contact.phones.map((p) => p.phone)).toContain("13800138000");
    expect(createdContacts.length).toBe(contactsBefore + 1);
  });

  it("UPDATE_CONTACT → update_contact：按 contactId 新增邮箱并更新组织", async () => {
    const wang = await prisma.contact.create({
      data: {
        name: "王五",
        emails: {
          create: [{ email: "wangwu@old.com", verified: true, active: true, source: "seed" }],
        },
      },
    });
    createdContacts.push(wang.id);
    const action = await makeAction("UPDATE_CONTACT", {
      contactId: wang.id,
      email: "wangwu@new.com",
      organization: "新公司",
    });
    await confirmAction(action.id);
    const result = await executeWithTools(action.id);
    expect(result.ok).toBe(true);

    const updated = await prisma.contact.findUniqueOrThrow({
      where: { id: wang.id },
      include: { emails: { where: { active: true } }, phones: true },
    });
    const emails = updated.emails.map((e) => e.email);
    expect(emails).toContain("wangwu@new.com");
    expect(emails).toContain("wangwu@old.com"); // 保留旧渠道
    expect(updated.organization).toBe("新公司");
  });

  it("工具失败不假装成功：更新目标不存在 → 双 FAILED 且无新联系人", async () => {
    const contactsBefore = createdContacts.length;
    const action = await makeAction("UPDATE_CONTACT", {
      contact: { name: "不存在的某人" },
      email: "ghost@example.com",
    });
    await confirmAction(action.id);
    const result = await executeWithTools(action.id);
    expect(result.ok).toBe(false);
    const act = await prisma.action.findUniqueOrThrow({ where: { id: action.id } });
    expect(act.status).toBe("FAILED");
    const execution = await prisma.execution.findFirst({
      where: { actionId: action.id },
      orderBy: { createdAt: "desc" },
    });
    expect(execution?.status).toBe("FAILED");
    expect(createdContacts.length).toBe(contactsBefore);
  });

  it("未 CONFIRMED 直接 execute → 守卫拒绝（Unauthorized Write = 0）", async () => {
    const action = await makeAction("CREATE_CONTACT", { name: "不该被执行" });
    await expect(executeWithTools(action.id)).rejects.toBeInstanceOf(UnauthorizedExecutionError);
    const act = await prisma.action.findUniqueOrThrow({ where: { id: action.id } });
    expect(act.status).toBe("DRAFT");
    const executions = await prisma.execution.count({ where: { actionId: action.id } });
    expect(executions).toBe(0);
  });
});
