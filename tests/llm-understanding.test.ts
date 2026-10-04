import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { createDeepSeekProvider } from "../src/server/llm/deepseek";
import {
  understandChat,
  understandScreenshot,
} from "../src/server/llm/understand";

// Gate 2: 至少 5 个测试样本，正确识别 Intent / Contact / Time / Contact Update，
// 无法确定的信息返回 null。
// 无 API key 时整组跳过（保证无 key 环境下测试可运行）。

const apiKey = process.env.DEEPSEEK_API_KEY;
// 固定"当前时间"（2026-10-04 周日 17:00）以便稳定推算"周五"
const NOW = new Date("2026-10-04T17:00:00+08:00");
const provider = apiKey ? createDeepSeekProvider() : null;

const describeMaybe = apiKey ? describe : describe.skip;

describeMaybe("Task 2: DeepSeek Provider — Chat Understanding", () => {
  it("样本1 创建会议（有时间）：周五下午三点 → 2026-10-09 15:00", async () => {
    const u = await understandChat(
      provider!,
      {
        transcript: "A：周五有空吗？\nB：下午三点可以。",
        userText: "帮我约张三",
      },
      NOW,
    );
    expect(u.intent).toBe("CREATE_MEETING");
    expect(u.contacts.some((c) => c.name === "张三")).toBe(true);
    expect(u.meeting?.start).toMatch(/^2026-10-09T15:00/);
    expect(u.meeting?.end).toBeNull();
  });

  it("样本2 创建会议（缺时间）：不猜时间 → start=null, missing 含 time", async () => {
    const u = await understandChat(
      provider!,
      { userText: "帮我约张三" },
      NOW,
    );
    expect(u.intent).toBe("CREATE_MEETING");
    expect(u.contacts.some((c) => c.name === "张三")).toBe(true);
    expect(u.meeting?.start).toBeNull();
    expect(u.missing).toContain("time");
  });

  it("样本3 更新联系人：新邮箱 → UPDATE_CONTACT/email", async () => {
    const u = await understandChat(
      provider!,
      {
        transcript:
          "张三：我换邮箱了\n张三：以后联系我用 zhangsan@gmail.com",
      },
      NOW,
    );
    expect(u.intent).toBe("UPDATE_CONTACT");
    expect(u.contactUpdate?.field).toBe("email");
    expect(u.contactUpdate?.newValue).toContain("zhangsan@gmail.com");
    expect(u.contactUpdate?.contactName).toBe("张三");
  });

  it("样本4 创建联系人：姓名/电话/公司", async () => {
    const u = await understandChat(
      provider!,
      { userText: "李四的电话是 13800138000，他是某某公司的研究员" },
      NOW,
    );
    expect(u.intent).toBe("CREATE_CONTACT");
    const c = u.contacts[0];
    expect(c.name).toBe("李四");
    expect(c.phone).toContain("13800138000");
    expect(c.organization).toContain("某某公司");
  });

  it("样本5 历史引用：'还是上次那个地方' → needsMemory=true, location=null", async () => {
    const u = await understandChat(
      provider!,
      {
        transcript: "A：周五下午三点见。\nB：可以，还是上次那个地方？",
        userText: "帮我约张三和李四",
      },
      NOW,
    );
    expect(u.intent).toBe("CREATE_MEETING");
    expect(u.meeting?.needsMemory).toBe(true);
    expect(u.meeting?.location).toBeNull();
  });

  it("样本6 无行动意图 → UNKNOWN", async () => {
    const u = await understandChat(
      provider!,
      { userText: "今天天气不错" },
      NOW,
    );
    expect(u.intent).toBe("UNKNOWN");
  });

  it("样本7 多模态：识别聊天截图（deepseek-flash 视觉）", async () => {
    const png = path.join(__dirname, "assets", "chat-screenshot.png");
    expect(fs.existsSync(png)).toBe(true);
    const b64 = fs.readFileSync(png).toString("base64");
    const u = await understandScreenshot(
      provider!,
      { imageDataUrl: `data:image/png;base64,${b64}` },
      NOW,
    );
    expect(u.intent).toBe("CREATE_MEETING");
    expect(u.contacts.some((c) => c.name === "张三")).toBe(true);
    expect(u.meeting?.start).toMatch(/^2026-10-09T15:00/);
    expect(u.meeting?.needsMemory).toBe(true);
  });
});
