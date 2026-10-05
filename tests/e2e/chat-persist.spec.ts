import { expect, test } from "@playwright/test";

// Task 19 —— 问题③：进入日程页后返回首页，聊天记录必须保留。
// 根因：Home 组件的 messages/sessionId 是组件内 useState，路由切换即卸载销毁。
// 修复：sessionStorage 持久化（挂载恢复 + 变化写回）。本测试验证往返后消息仍在。

test("进入日程页再返回首页，聊天记录保留", async ({ page }) => {
  await page.goto("/");
  const marker = `持久化验证消息${Date.now()}`;

  // 发一条消息并等 Agent 回复（同时保证写回 sessionStorage 已完成）
  await page.getByTestId("chat-input").fill(marker);
  await page.getByRole("button", { name: "发送" }).click();
  await expect(page.getByText(marker)).toBeVisible();
  await expect(page.getByTestId("agent-text").first()).toBeVisible({ timeout: 120_000 });

  // 进入日程页
  await page.getByRole("link", { name: "日程" }).click();
  await expect(page).toHaveURL(/\/schedule/);

  // 返回首页
  await page.getByRole("link", { name: "首页" }).click();
  await expect(page).toHaveURL(/\/$/);

  // 聊天记录仍在（用户消息与输入框均可继续）
  await expect(page.getByText(marker)).toBeVisible();
  await expect(page.getByTestId("chat-input")).toBeVisible();
});
