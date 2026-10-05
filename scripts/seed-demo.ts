/**
 * ActionMind 演示数据 seed（幂等）：
 * 清空五表后写入——联系人 3 个、本周/历史任务 9 条（覆盖 MEETING/TODO/REMINDER、
 * scheduled/completed/cancelled）、Verified Memory 5 条并补全 pgvector embedding。
 * 运行：bash -c 'set -a; source .env; set +a; npx tsx scripts/seed-demo.ts'
 */
import "dotenv/config";
import { prisma } from "../src/server/db";
import { createEmbeddingProvider, embedMemoriesMissing } from "../src/server/embedding";

const at = (iso: string) => new Date(iso);

async function main() {
  // 1) 清空（幂等）
  await prisma.$executeRawUnsafe(
    "TRUNCATE TABLE meetings, actions, memories, contacts, contact_phones, contact_emails RESTART IDENTITY CASCADE",
  );

  // 2) 联系人
  const zhang = await prisma.contact.create({
    data: {
      name: "张三",
      organization: "研究生院",
      role: "同学",
      phones: { create: [{ phone: "13800001111", verified: true, source: "user_input" }] },
      emails: { create: [{ email: "zhangsan@example.com", verified: true, source: "user_input" }] },
    },
  });
  const li = await prisma.contact.create({
    data: {
      name: "李四",
      organization: "产品部",
      role: "产品负责人",
      phones: { create: [{ phone: "13900002222", verified: true, source: "user_input" }] },
    },
  });
  const wang = await prisma.contact.create({
    data: {
      name: "王老师",
      organization: "数学系",
      role: "老师",
      phones: { create: [{ phone: "13700003333", verified: false, source: "user_input" }] },
    },
  });

  // 3) 任务（时间均为北京时间；prisma 存 UTC 瞬时）
  const tasks: Array<{
    title: string;
    taskType: string;
    startAt: string;
    endAt?: string;
    location?: string;
    notes?: string;
    status: string;
    contactId?: string;
  }> = [
    // 过去（completed/cancelled，供历史查询与取消演示）
    { title: "与张三的会议", taskType: "MEETING", startAt: "2026-09-20T15:00:00+08:00", endAt: "2026-09-20T16:00:00+08:00", location: "星巴克", notes: "聊毕业论文选题", status: "completed", contactId: zhang.id },
    { title: "和张三看电影", taskType: "MEETING", startAt: "2026-09-27T19:00:00+08:00", endAt: "2026-09-27T20:30:00+08:00", location: "万达影城", status: "cancelled", contactId: zhang.id },
    { title: "和张三的羽毛球", taskType: "MEETING", startAt: "2026-10-04T14:00:00+08:00", endAt: "2026-10-04T15:30:00+08:00", location: "体育馆", status: "completed", contactId: zhang.id },
    // 本周（scheduled，供日程页/查询/冲突演示）
    { title: "提醒：给妈妈打电话", taskType: "REMINDER", startAt: "2026-10-05T19:30:00+08:00", endAt: "2026-10-05T19:45:00+08:00", status: "scheduled" },
    { title: "数据结构课", taskType: "TODO", startAt: "2026-10-06T09:00:00+08:00", endAt: "2026-10-06T10:30:00+08:00", location: "教学楼302", notes: "带上次作业", status: "scheduled" },
    { title: "产品评审会", taskType: "MEETING", startAt: "2026-10-07T14:00:00+08:00", endAt: "2026-10-07T15:00:00+08:00", location: "会议室A", status: "scheduled", contactId: li.id },
    { title: "与张三见面", taskType: "MEETING", startAt: "2026-10-09T15:00:00+08:00", endAt: "2026-10-09T15:30:00+08:00", status: "scheduled", contactId: zhang.id },
    { title: "健身", taskType: "REMINDER", startAt: "2026-10-09T20:00:00+08:00", endAt: "2026-10-09T21:00:00+08:00", location: "健身房", status: "scheduled" },
    { title: "上数学课", taskType: "TODO", startAt: "2026-10-10T10:00:00+08:00", endAt: "2026-10-10T11:30:00+08:00", location: "图书馆204", status: "scheduled", contactId: wang.id },
  ];
  for (const t of tasks) {
    await prisma.meeting.create({
      data: {
        title: t.title,
        taskType: t.taskType,
        startAt: at(t.startAt),
        endAt: t.endAt ? at(t.endAt) : undefined,
        location: t.location,
        notes: t.notes,
        status: t.status,
        contactId: t.contactId,
        source: "seed-demo",
      },
    });
  }

  // 4) Verified Memory（供 memory_search 查历史）
  const memories: Array<{ type: string; content: string; contactId?: string; timestamp?: string; source: string; confidence: number }> = [
    { type: "meeting", content: "9月20日下午3点和张三在星巴克开的会，聊了毕业论文选题", contactId: zhang.id, timestamp: "2026-09-20T15:00:00+08:00", source: "tool_verified", confidence: 1 },
    { type: "fact", content: "张三习惯提前十分钟到，见面常约星巴克", contactId: zhang.id, source: "user_confirmed", confidence: 0.95 },
    { type: "fact", content: "王老师周三上午有课，下午时间相对宽裕", contactId: wang.id, source: "user_confirmed", confidence: 0.9 },
    { type: "meeting", content: "10月4日下午和张三在体育馆打了羽毛球", contactId: zhang.id, timestamp: "2026-10-04T14:00:00+08:00", source: "tool_verified", confidence: 1 },
    { type: "fact", content: "李四是产品组负责人，习惯线上会议", contactId: li.id, source: "user_confirmed", confidence: 0.9 },
  ];
  for (const m of memories) {
    await prisma.memory.create({
      data: {
        type: m.type,
        content: m.content,
        contactId: m.contactId,
        timestamp: m.timestamp ? at(m.timestamp) : undefined,
        source: m.source,
        confidence: m.confidence,
      },
    });
  }

  // 5) 补全记忆 embedding（memory_search 依赖 pgvector）
  const provider = createEmbeddingProvider();
  const missing = await embedMemoriesMissing(provider, 100);

  // 6) 汇总
  const c = await prisma.contact.count();
  const t = await prisma.meeting.count();
  const m = await prisma.memory.count();
  const emb = await prisma.$queryRawUnsafe<Array<{ n: bigint }>>(
    "SELECT COUNT(*) AS n FROM memories WHERE embedding IS NOT NULL",
  );
  console.log(`SEED_OK contacts=${c} tasks=${t} memories=${m} embedded=${String(emb[0].n)} embeddingWritten=${missing}`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error("SEED_FAIL", e);
  process.exit(1);
});
