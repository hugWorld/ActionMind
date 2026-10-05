import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { createDeepSeekProvider } from "../src/server/llm/deepseek";
import { understandScreenshot } from "../src/server/llm/understand";
import { prisma } from "../src/server/db";

// 微信风格聊天截图 → 理解（贴近真实使用场景：对方「张三」在左白色气泡，自己「李四」在右绿色气泡）
describe("微信风格截图理解（Task 16 演示资产）", () => {
  const apiKey = process.env.DEEPSEEK_API_KEY;

  beforeAll(() => {
    if (!apiKey) throw new Error("缺少 DEEPSEEK_API_KEY，无法跑真实 LLM 视觉理解");
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it(
    "识别会议意图、对方张三、会议时间与历史引用（needsMemory）",
    async () => {
      const provider = createDeepSeekProvider();
      const file = fs.readFileSync(path.join(__dirname, "assets", "chat-wechat.png"));
      const b64 = file.toString("base64");
      const u = await understandScreenshot(provider, {
        imageDataUrl: `data:image/png;base64,${b64}`,
      });

      expect(u.intent).toBe("CREATE_MEETING");
      expect(u.contacts.some((c) => c.name === "张三")).toBe(true);
      expect(u.meeting?.start).toBeTruthy(); // 周五下午三点 → 2026-10-09T15:00:00+08:00
      expect(u.meeting?.needsMemory).toBe(true); // 「还是上次那个地方」→ 历史引用
    },
    120_000,
  );
});
