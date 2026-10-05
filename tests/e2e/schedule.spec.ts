import { expect, test } from "@playwright/test";
import { prisma } from "../../src/server/db";

// Task 18 (Stage C) — 日程页 /schedule（需求九/十/十一）
// 验证：
//   1) 默认周视图展示本周任务（与 Chat 共享 /api/tasks 单一数据源）
//   2) 默认隐藏 CANCELLED，「显示已取消任务」勾选后可见
//   3) 月 / 周 / 日视图切换 + 上一/下一/今天导航
// 种子：本周内两条任务（一条 CONFIRMED、一条 CANCELLED），唯一标题避免冲突。

function thisWeekWednesday10(): Date {
  const now = new Date();
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diff = (d.getDay() + 6) % 7; // 周一=0
  d.setDate(d.getDate() - diff + 2); // 本周三
  d.setHours(10, 0, 0, 0);
  return d;
}

function thisWeekThursday14(): Date {
  const now = new Date();
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diff = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - diff + 3); // 本周四
  d.setHours(14, 0, 0, 0);
  return d;
}

const T1 = "滚动种子会议A";
const T2 = "滚动种子会议B已取消";
const created: string[] = [];

test.beforeAll(async () => {
  const a = await prisma.meeting.create({
    data: { title: T1, taskType: "MEETING", startAt: thisWeekWednesday10(), status: "scheduled", source: "e2e-seed" },
  });
  const b = await prisma.meeting.create({
    data: { title: T2, taskType: "MEETING", startAt: thisWeekThursday14(), status: "cancelled", source: "e2e-seed" },
  });
  created.push(a.id, b.id);
});

test.afterAll(async () => {
  for (const id of created) await prisma.meeting.delete({ where: { id } }).catch(() => {});
  await prisma.$disconnect();
});

test("周视图：默认隐藏 CANCELLED，勾选后可见；月/日视图与导航可用", async ({ page }) => {
  await page.goto("/schedule");

  // 默认周视图：CONFIRMED 任务可见
  await expect(page.getByTestId("view-week")).toHaveClass(/bg-black|dark:bg-white/);
  await expect(page.getByText(T1)).toBeVisible({ timeout: 30_000 });
  // 默认隐藏已取消
  await expect(page.getByText(T2)).toBeHidden();

  // 显示已取消 → CANCELLED 出现（带删除线样式）
  await page.getByTestId("include-cancelled").check();
  await expect(page.getByText(T2)).toBeVisible({ timeout: 30_000 });

  // 月视图切换
  await page.getByTestId("view-month").click();
  await expect(page.getByTestId("month-cell").first()).toBeVisible();
  await expect(page.getByTestId("view-month")).toHaveClass(/bg-black|dark:bg-white/);

  // 日视图切换（时间轴渲染 + 激活态；当前天未必是周三，不断言具体任务可见）
  await page.getByTestId("view-day").click();
  await expect(page.getByTestId("view-day")).toHaveClass(/bg-black|dark:bg-white/);
  await expect(page.getByText("8:00", { exact: true })).toBeVisible();
  await expect(page.getByText("15:00", { exact: true })).toBeVisible();

  // 导航：下一日标题变化 + 今天按钮
  const titleBefore = await page.locator("h2").textContent();
  await page.getByTestId("nav-next").click();
  const titleAfter = await page.locator("h2").textContent();
  expect(titleAfter).not.toBe(titleBefore);
  await page.getByTestId("nav-today").click();
  const titleToday = await page.locator("h2").textContent();
  expect(titleToday).toContain("周");
});
