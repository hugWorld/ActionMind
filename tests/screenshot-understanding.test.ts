import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { POST } from "../src/app/api/understand/route";

// Gate 3 — Screenshot Understanding（Upload → Vision LLM → Structured）
// 视觉能力已在 Task 2 样本7 实测通过，这里用 1 张真实截图覆盖完整 HTTP 管线；
// 覆盖维度（会议/联系人/更新/多人/相对时间/历史引用）由 Task 2 的文本样本补齐。

describe("Task 3: API 校验（确定性，不依赖 LLM）", () => {
  it("缺少截图文件 → 400", async () => {
    const form = new FormData();
    const res = await POST(
      new Request("http://localhost/api/understand", { method: "POST", body: form }),
    );
    expect(res.status).toBe(400);
  });

  it("非图片文件 → 400", async () => {
    const form = new FormData();
    form.append(
      "screenshot",
      new File(["not an image"], "fake.txt", { type: "text/plain" }),
    );
    const res = await POST(
      new Request("http://localhost/api/understand", { method: "POST", body: form }),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.ok).toBe(false);
  });
});

const apiKey = process.env.DEEPSEEK_API_KEY;
const describeMaybe = apiKey ? describe : describe.skip;

describeMaybe("Task 3: Upload → Vision → Structured（真实调用）", () => {
  it("聊天截图：识别会议意图 / 多人 / 相对时间 / 历史引用", async () => {
    const png = fs.readFileSync(
      path.join(__dirname, "assets", "chat-screenshot.png"),
    );
    const form = new FormData();
    form.append(
      "screenshot",
      new File([new Uint8Array(png)], "chat-screenshot.png", { type: "image/png" }),
    );
    form.append("userText", "帮我约张三和李四");
    const res = await POST(
      new Request("http://localhost/api/understand", { method: "POST", body: form }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      understanding?: {
        intent: string;
        contacts: Array<{ name: string | null }>;
        meeting: {
          start: string | null;
          end: string | null;
          location: string | null;
          needsMemory: boolean;
        } | null;
      };
    };
    expect(body.ok).toBe(true);
    const u = body.understanding!;
    expect(u.intent).toBe("CREATE_MEETING");
    expect(u.contacts.some((c) => c.name === "张三")).toBe(true);
    expect(u.contacts.some((c) => c.name === "李四")).toBe(true);
    expect(u.meeting?.start).toMatch(/^2026-10-09T15:00/);
    expect(u.meeting?.end).toBeNull();
    expect(u.meeting?.location).toBeNull();
    expect(u.meeting?.needsMemory).toBe(true);
  });
});
