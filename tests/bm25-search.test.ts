import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "../src/server/db";
import { buildBm25Index, searchBm25, tokenize } from "../src/server/search";

// Gate 7 — BM25 Keyword Index：独立 Keyword Search，输出 Top-K / Score / Memory ID

const DOCS = [
  "李四的联系邮箱是 lisi@example.com",
  "王五的电话是 13900000002",
  "和张三在 Meeting Room 3 开项目周会",
  "周五下午三点和客户在星巴克见面",
  "陈晨喜欢喝美式咖啡",
  "张三的生日是 3 月 15 日",
  "下周三上午去医院复查",
  "和妈妈约好周六去爬香山",
  "赵六在某某公司做研究员",
  "钱七住在朝阳区望京",
  "计划下个月去杭州出差",
  "李四在会议室和客户开会",
  "下季度预算会议安排在 11 月初",
  "王五的产品原型会议",
  "周九的团队做前端开发",
];

describe("Task 7: BM25 Keyword Search", () => {
  const created: string[] = [];
  let ids: string[] = [];

  afterAll(async () => {
    for (const id of created) {
      await prisma.memory.delete({ where: { id } }).catch(() => {});
    }
    await prisma.$disconnect();
  });

  it("分词：中文单字+bigram、拉丁/数字串", () => {
    const t = tokenize("李四的邮箱是 lisi@example.com");
    expect(t).toContain("李四");
    expect(t).toContain("邮箱");
    expect(t).toContain("lisi");
    expect(t).toContain("example");
    expect(t).toContain("com");
  });

  it("BM25 检索：输出 Top-K / Score / Memory ID，命中预期文档", async () => {
    // 先落库，拿到真实 memory id
    for (const content of DOCS) {
      const m = await prisma.memory.create({
        data: { type: "fact", content, source: "model_inferred", confidence: 0.3 },
      });
      created.push(m.id);
      ids.push(m.id);
    }
    const docs = DOCS.map((content, i) => ({ id: ids[i], content }));
    const index = buildBm25Index(docs);

    const cases: Array<[string, number]> = [
      // [查询, 预期命中的文档下标]
      ["lisi@example.com", 0],
      ["13900000002", 1],
      ["星巴克", 3],
      ["香山", 7],
      ["望京", 9],
      ["前端开发", 14],
      ["zhangsan", -1], // 英文查询兜底：无命中 → expectedIdx=-1
    ];

    for (const [query, expectedIdx] of cases) {
      const hits = searchBm25(index, query, { k: 5 });
      for (const h of hits) {
        expect(h.memoryId).toBeTruthy();
        expect(typeof h.score).toBe("number");
      }
      if (expectedIdx >= 0) {
        expect(hits.length).toBeGreaterThan(0);
        expect(hits[0].memoryId, `查询「${query}」应命中「${DOCS[expectedIdx]}」`).toBe(ids[expectedIdx]);
        expect(hits[0].score).toBeGreaterThan(0);
      } else {
        expect(hits.length).toBe(0);
      }
    }
  });

  it("多文档命中：按 score 降序，无关文档（score=0）不返回", () => {
    const docs = DOCS.map((content, i) => ({ id: ids[i], content }));
    const index = buildBm25Index(docs);
    const hits = searchBm25(index, "会议", { k: 20 });
    // 含"会议"的文档：下标 2, 11, 12, 13
    const meetingIdx = [2, 11, 12, 13];
    expect(hits.length).toBe(meetingIdx.length);
    for (let i = 1; i < hits.length; i++) {
      expect(hits[i].score).toBeLessThanOrEqual(hits[i - 1].score);
    }
    const hitIds = hits.map((h) => h.memoryId);
    for (const idx of meetingIdx) {
      expect(hitIds).toContain(ids[idx]);
    }
    // 不包含"会议"的文档不应出现
    for (let i = 0; i < DOCS.length; i++) {
      if (!meetingIdx.includes(i)) expect(hitIds).not.toContain(ids[i]);
    }
  });

  it("空索引 / 空查询 → 空结果", () => {
    const empty = buildBm25Index([]);
    expect(searchBm25(empty, "任何词")).toEqual([]);
    expect(searchBm25(buildBm25Index([{ id: "x", content: "内容" }]), "")).toEqual([]);
  });
});
