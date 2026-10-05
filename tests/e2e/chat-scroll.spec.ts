import { expect, test, type Page } from "@playwright/test";

// Task 18 (Stage C) Gate 1 — 聊天窗口自动滚动到底部
// 验证：
//   1) 发送多条消息后自动位于底部
//   2) Agent 新消息出现后自动位于底部
//   3) 连续产生多条消息后仍正常
//   4) 用户上滑查看历史时，后台 Agent 消息出现不会强制拉回；「回到底部」可点击恢复

const SCROLL = '[data-testid="chat-scroll"]';
const AGENT_NODES = '[data-testid="agent-text"], [data-testid="ask-question"], [data-testid="action-card"]';

async function sendText(page: Page, text: string) {
  await page.getByTestId("chat-input").fill(text);
  await page.getByRole("button", { name: "发送" }).click();
}

async function nearBottom(page: Page): Promise<boolean> {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel) as HTMLElement;
    if (!el) return true;
    return el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  }, SCROLL);
}

async function scrollTopOf(page: Page): Promise<number> {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel) as HTMLElement;
    return el ? el.scrollTop : -1;
  }, SCROLL);
}

async function scrollToTop(page: Page) {
  await page.evaluate((sel) => {
    const el = document.querySelector(sel) as HTMLElement;
    if (el) el.scrollTop = 0;
  }, SCROLL);
}

test("发送多条消息后自动位于底部（含 Agent 新消息跟随）", async ({ page }) => {
  await page.goto("/");
  const agentNodes = page.locator(AGENT_NODES);

  // 第一轮：发送 → 等 Agent 回应（后台更新）
  await sendText(page, "你好");
  await expect(agentNodes).toHaveCount(1, { timeout: 90_000 });
  await expect.poll(() => nearBottom(page), { timeout: 10_000 }).toBe(true);

  // 第二轮：连续消息后仍在底部
  await sendText(page, "帮我约张三，周五下午三点见");
  await expect(agentNodes).toHaveCount(2, { timeout: 90_000 });
  await expect.poll(() => nearBottom(page), { timeout: 10_000 }).toBe(true);
});

test("上滑查看历史：后台新消息不强制拉回；「回到底部」可恢复", async ({ page }) => {
  await page.goto("/");
  const agentNodes = page.locator(AGENT_NODES);

  // 多轮消息制造足够滚动内容（每轮等 Agent 回复；回复形态由 LLM 决定，多轮确保内容溢出）
  const turns = ["你好", "帮我约张三，周五下午三点见", "张三电话 13800000000", "就按你说的安排吧，电话 13800000000"];
  for (let i = 0; i < turns.length; i++) {
    await sendText(page, turns[i]);
    await expect(agentNodes).toHaveCount(i + 1, { timeout: 90_000 });
  }
  await expect.poll(() => nearBottom(page), { timeout: 10_000 }).toBe(true);

  // 上滑到顶 → 「回到底部」出现 → 点击恢复到底部
  await scrollToTop(page);
  await expect(page.getByTestId("jump-to-bottom")).toBeVisible();
  await page.getByTestId("jump-to-bottom").click();
  await expect.poll(() => nearBottom(page), { timeout: 10_000 }).toBe(true);
  await expect(page.getByTestId("jump-to-bottom")).toBeHidden();

  // 后台更新不拉回：发送第 5 条 → 等 Agent 回复到达（用户在底部，被跟随到底）→
  // 用户上滑查看历史 → 停留期间不被任何后台状态更新强制拉回
  await sendText(page, "地点就公司楼下咖啡厅吧");
  await expect(agentNodes).toHaveCount(5, { timeout: 90_000 });
  await scrollToTop(page);
  await page.waitForTimeout(600); // 模拟停留查看历史（无新消息也绝不滚动）

  const top = await scrollTopOf(page);
  expect(top).toBeLessThan(200); // 仍在顶部，未被强制拉回
  await expect(page.getByTestId("jump-to-bottom")).toBeVisible();
});
