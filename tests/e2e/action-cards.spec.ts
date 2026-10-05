import { expect, test } from "@playwright/test";

// Task 16 / Gate 16 — UI 闭环（Playwright，真实浏览器 + 真实 LLM）：
// 上传截图 → 理解 → 生成 Action Card → 编辑补全标题 → 确认 → 执行 → SUCCESS + Verified Memory 沉淀提示

// 微信风格截图：对方「张三」在左白色气泡，自己「李四」在右绿色气泡
const SCREENSHOT = "tests/assets/chat-wechat.png";

test("UI 闭环：截图 → 理解 → Action Card → 编辑 → 确认 → 执行 → Verified Memory", async ({ page }) => {
  await page.goto("/");

  // 上传截图并提交
  await page.setInputFiles('input[type="file"]', SCREENSHOT);
  await page.getByRole("button", { name: /上传并理解/ }).click();

  // 等待真实 LLM 理解结果（Intent 徽章）
  await expect(page.getByText("CREATE_MEETING").first()).toBeVisible({ timeout: 150_000 });

  // 生成 Action Card → 跳转 Actions 页
  await page.getByRole("button", { name: /生成 Action Card/ }).click();
  await page.waitForURL(/\/actions/);
  await expect(page.getByRole("button", { name: "编辑" }).first()).toBeVisible({
    timeout: 30_000,
  });

  // 编辑补全标题（截图对话没有会议标题，工具会拒绝空标题 → 先补全）
  await page.getByRole("button", { name: "编辑" }).first().click();
  await page.locator("label", { hasText: "标题" }).locator("input").fill("与张三的会议");
  await page.getByRole("button", { name: "保存" }).click();

  // 确认 → 执行
  await expect(page.getByRole("button", { name: "确认" }).first()).toBeVisible();
  await page.getByRole("button", { name: "确认" }).first().click();
  await expect(page.getByRole("button", { name: "执行" }).first()).toBeVisible();
  await page.getByRole("button", { name: "执行" }).first().click();

  // 最终目标：执行成功 + Verified Memory 沉淀提示（唯一文本，不受筛选按钮干扰）
  await expect(page.getByText(/执行成功，已沉淀 Verified Memory/).first()).toBeVisible({
    timeout: 90_000,
  });
  await expect(
    page.locator('[data-testid="action-status"]', { hasText: "SUCCESS" }).first(),
  ).toBeVisible();
});
