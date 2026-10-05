import { expect, test, type Page } from "@playwright/test";

// Task 17 (Stage C) — 对话式 UI 闭环（Playwright，真实浏览器 + 真实 LLM）：
//   Text-only 多轮对话 → Agent ask_user → 用户回复 → Action Card → 确认执行 → Verified Memory
//   Image-only 上传截图 → Agent 理解 → Action Card

const SCREENSHOT = "tests/assets/chat-wechat-simple.png";

/** 等待 ask_user 问题或 Action Card 任一出现（真实 LLM 决策不确定，两者都可能是下一状态） */
async function waitAskOrCard(page: Page, timeout = 150_000) {
  const q = page.getByTestId("ask-question").first();
  const c = page.getByTestId("action-card").first();
  await Promise.race([
    q.waitFor({ state: "visible", timeout }),
    c.waitFor({ state: "visible", timeout }),
  ]);
}

async function replyAndWaitCard(page: Page, text: string) {
  await page.getByTestId("chat-input").fill(text);
  await page.getByRole("button", { name: "发送" }).click();
  await expect(page.getByTestId("action-card").first()).toBeVisible({ timeout: 150_000 });
}

test("对话式 UI 闭环：纯文字 → Agent 询问/建卡 → 确认执行 → Verified Memory", async ({ page }) => {
  await page.goto("/");

  // 纯文字输入（Text-only）
  await page.getByTestId("chat-input").fill("帮我约张三，周五下午三点见，张三电话 13800000000");
  await page.getByRole("button", { name: "发送" }).click();

  // Agent 可能先问（ask_user）或直接建卡；等待任一出现
  await waitAskOrCard(page);

  const askVisible = await page.getByTestId("ask-question").first().isVisible().catch(() => false);
  if (askVisible) {
    // 用户回复补齐信息（多轮 ReAct 续跑）
    await replyAndWaitCard(page, "就按你说的安排吧，电话 13800000000，没有其他信息了");
  }

  // Action Card 已生成（预览，非表单）
  const card = page.getByTestId("action-card").first();
  await expect(card).toBeVisible({ timeout: 150_000 });
  await expect(card.getByText(/创建会议/)).toBeVisible();

  // 确认并执行 → 成功 + Verified Memory 沉淀提示
  await card.getByRole("button", { name: "确认并执行" }).click();
  await expect(page.getByTestId("exec-result")).toBeVisible({ timeout: 90_000 });
  await expect(page.getByText(/执行成功，已沉淀 Verified Memory/).first()).toBeVisible();
});

test("对话式 UI：上传截图（Image-only）→ Agent 理解 → Action Card 预览", async ({ page }) => {
  await page.goto("/");

  // 仅上传截图，不输入文字
  await page.setInputFiles('input[type="file"]', SCREENSHOT);
  await page.getByRole("button", { name: "发送" }).click();

  await waitAskOrCard(page);
  const askVisible = await page.getByTestId("ask-question").first().isVisible().catch(() => false);
  if (askVisible) {
    await replyAndWaitCard(page, "按截图安排，电话 13800000000");
  }

  const card = page.getByTestId("action-card").first();
  await expect(card).toBeVisible({ timeout: 150_000 });
  await expect(card.getByText(/创建会议/)).toBeVisible();
  await expect(card.getByText(/张三/).first()).toBeVisible();
});
