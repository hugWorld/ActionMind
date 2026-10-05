import { test, expect } from "@playwright/test";

// 验证 hydration mismatch 告警是否消失（Grammarly 扩展注入 body 属性导致的 issue）
test("首页与日程页无 hydration mismatch 告警", async ({ page }) => {
  const issues: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error" || msg.type() === "warning") {
      issues.push(msg.text());
    }
  });
  page.on("pageerror", (e) => issues.push(String(e)));

  for (const path of ["/", "/schedule"]) {
    await page.goto(path, { waitUntil: "networkidle" });
    await page.waitForTimeout(1000);
  }

  const mismatches = issues.filter((t) => t.includes("hydrated") || t.includes("did not match") || t.includes("hydration"));
  console.log("CONSOLE_ERRORS_TOTAL=", issues.length);
  console.log("HYDRATION_MISMATCH=", mismatches);
  expect(mismatches).toEqual([]);
});
