import { expect, test } from "@playwright/test";

// Gate 0: Next.js 页面可访问
test("home page renders", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle(/ActionMind|Next\.js|Create Next App/i);
});
