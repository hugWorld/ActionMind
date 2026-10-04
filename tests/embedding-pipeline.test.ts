import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { prisma } from "../src/server/db";
import { createEmbeddingProvider } from "../src/server/embedding";
import { embedMemoriesMissing, searchMemories } from "../src/server/embedding";
import type { EmbeddingProvider } from "../src/server/embedding";

// Gate 6 — Embedding Pipeline（本地 CPU：fastembed + bge-small-zh-v1.5 → pgvector）
// 至少 20 条记忆、10 个查询，能够完成 Vector Search。

const BASE = process.env.EMBEDDING_URL ?? "http://127.0.0.1:8765";
const PYTHON =
  process.env.EMBEDDING_PYTHON ?? "/home/cjm/actionmind-embed-venv/bin/python";

async function serverReady(): Promise<boolean> {
  try {
    const res = await fetch(`${BASE}/health`, { signal: AbortSignal.timeout(3000) });
    return res.ok;
  } catch {
    return false;
  }
}

const MEMORY_CONTENTS = [
  "和张三在 Meeting Room 3 开项目周会",
  "周五下午三点和客户在星巴克见面",
  "下周三上午去医院复查",
  "和妈妈约好周六去爬香山",
  "周一早上和团队站会",
  "李四换了新邮箱 lisi@example.com",
  "王五的新手机号是 13900000002",
  "赵六在某某公司做研究员",
  "陈晨喜欢喝美式咖啡",
  "张三的生日是 3 月 15 日",
  "钱七住在朝阳区望京",
  "孙八是产品经理",
  "周九的团队做前端开发",
  "吴十每周四晚上健身",
  "计划下个月去杭州出差",
  "月底要给客户提交方案",
  "下周五参加行业峰会",
  "周末要修完门锁",
  "下季度预算会议安排在 11 月初",
  "和张三约了周五下午的面试",
];

// [查询, 期望命中的记忆内容]
const QUERIES: Array<[string, string]> = [
  ["项目周会在哪个会议室开", MEMORY_CONTENTS[0]],
  ["和客户在哪见面", MEMORY_CONTENTS[1]],
  ["医院复查是什么时候", MEMORY_CONTENTS[2]],
  ["和妈妈周末去哪", MEMORY_CONTENTS[3]],
  ["李四的联系邮箱是什么", MEMORY_CONTENTS[5]],
  ["王五的电话是多少", MEMORY_CONTENTS[6]],
  ["赵六在哪个公司工作", MEMORY_CONTENTS[7]],
  ["陈晨喜欢喝什么咖啡", MEMORY_CONTENTS[8]],
  ["张三的生日是哪天", MEMORY_CONTENTS[9]],
  ["下个月的出差计划", MEMORY_CONTENTS[14]],
];

describe("Task 6: Embedding Pipeline（Vector Search）", () => {
  let provider: EmbeddingProvider;
  let child: ChildProcess | null = null;
  const created: string[] = [];

  beforeAll(async () => {
    // 服务已在跑则复用；否则自动拉起
    if (!(await serverReady())) {
      child = spawn(
        PYTHON,
        ["scripts/embed_server.py"],
        {
          cwd: process.cwd(),
          env: { ...process.env, HF_ENDPOINT: "https://hf-mirror.com" },
          stdio: "ignore",
        },
      );
      for (let i = 0; i < 60; i++) {
        if (await serverReady()) break;
        await new Promise((r) => setTimeout(r, 2000));
      }
      expect(await serverReady()).toBe(true);
    }
    provider = createEmbeddingProvider();
  }, 180_000);

  afterAll(async () => {
    for (const id of created) {
      await prisma.memory.delete({ where: { id } }).catch(() => {});
    }
    await prisma.$disconnect();
    if (child) child.kill("SIGTERM");
  });

  it("写入 20 条记忆并全部生成 embedding", async () => {
    for (const content of MEMORY_CONTENTS) {
      const m = await prisma.memory.create({
        data: {
          type: content.includes("邮箱") || content.includes("手机号")
            ? "contact_update"
            : content.includes("会议") || content.includes("面试") || content.includes("站会")
              ? "meeting"
              : content.includes("出差") || content.includes("提交") || content.includes("峰会") || content.includes("预算")
                ? "action"
                : "fact",
          content,
          source: "model_inferred",
          confidence: 0.3,
        },
      });
      created.push(m.id);
    }
    const n = await embedMemoriesMissing(provider);
    expect(n).toBe(MEMORY_CONTENTS.length);
    const rows = await prisma.$queryRaw<Array<{ c: bigint }>>`
      SELECT count(*)::int AS c FROM memories WHERE embedding IS NOT NULL
    `;
    expect(Number(rows[0].c)).toBe(MEMORY_CONTENTS.length);
  }, 60_000);

  it("10 个查询均可完成 Vector Search 且 Top-5 命中预期记忆", async () => {
    for (const [query, expectedContent] of QUERIES) {
      const hits = await searchMemories(provider, query, { k: 5 });
      expect(hits.length).toBeGreaterThan(0);
      expect(hits[0].similarity).toBeGreaterThan(-1);
      expect(hits[0].similarity).toBeLessThanOrEqual(1);
      // 在内存中找 expected 的 id
      const expected = await prisma.memory.findFirst({
        where: { content: expectedContent },
        select: { id: true },
      });
      expect(expected).toBeTruthy();
      const rank = hits.findIndex((h) => h.id === expected!.id);
      expect(rank, `查询「${query}」应命中「${expectedContent}」`).toBeGreaterThanOrEqual(0);
      expect(rank, `查询「${query}」命中排名过高`).toBeLessThan(5);
    }
  }, 120_000);
});
