import { describe, expect, it } from "vitest";
import { createSessionState, type AgentSessionState } from "../src/server/agent/state";
import {
  buildContextMessages,
  maybeRollingSummary,
} from "../src/server/agent/runtime";
import type { ChatMessage, LLMProvider } from "../src/server/llm/types";

// Task 26 — 滚动摘要（Rolling Summary）
// 纯单元测试：mock LLM，验证
//   1) 未超阈值不压缩
//   2) 超阈值压缩最老一批进 summary
//   3) 单轮最多压缩批数上限
//   4) 摘要失败不阻塞对话（保留原文）
//   5) 多次触发追加合并
//   6) buildContextMessages 拼装（system + summary + 最近 N 条）

const FAKE_SUMMARY = "要点：用户要与张三周五三点开会；已确认周五下午三点；尚未确认地点。";

function mockProvider(chatImpl?: (msgs: ChatMessage[]) => string): LLMProvider {
  return {
    async chat(input) {
      return chatImpl ? chatImpl(input.messages) : FAKE_SUMMARY;
    },
    async structured() {
      throw new Error("不应触发 structured");
    },
  };
}

function mkState(messageCount: number): AgentSessionState {
  const s = createSessionState("sess_test");
  for (let i = 0; i < messageCount; i++) {
    s.messages.push(
      i % 2 === 0
        ? { role: "user", content: `用户第 ${i} 条消息：周五下午三点和张三开会` }
        : { role: "assistant", content: `Agent 第 ${i} 条回复（工具结果等）` },
    );
  }
  return s;
}

describe("maybeRollingSummary", () => {
  it("消息数未超阈值时不压缩", async () => {
    const s = mkState(10);
    const changed = await maybeRollingSummary(s, mockProvider());
    expect(changed).toBe(false);
    expect(s.summary).toBeNull();
    expect(s.messages.length).toBe(10);
  });

  it("超阈值时压缩最老 6 条进 summary", async () => {
    const s = mkState(11);
    const changed = await maybeRollingSummary(s, mockProvider());
    expect(changed).toBe(true);
    expect(s.summary).toContain("周五下午三点");
    expect(s.messages.length).toBe(11 - 6);
    // 剩余消息应是最新的（从第 6 条开始）
    expect(s.messages[0].content).toContain("用户第 6 条消息");
  });

  it("单轮最多压缩 2 批（大量历史时控制成本）", async () => {
    const s = mkState(30);
    await maybeRollingSummary(s, mockProvider());
    expect(s.messages.length).toBe(30 - 6 * 2);
    expect(s.summary?.split("\n").filter(Boolean).length).toBe(2);
  });

  it("摘要生成失败时不阻塞对话（保留原文）", async () => {
    const s = mkState(12);
    const provider = mockProvider(() => {
      throw new Error("LLM timeout");
    });
    const changed = await maybeRollingSummary(s, provider);
    expect(changed).toBe(false);
    expect(s.summary).toBeNull();
    expect(s.messages.length).toBe(12);
  });

  it("多次触发追加合并 summary", async () => {
    const s = mkState(12);
    const provider = mockProvider(() => "批次A要点");
    await maybeRollingSummary(s, provider);
    expect(s.summary).toBe("批次A要点");
    // 再塞一批消息，再次触发
    for (let i = 0; i < 6; i++) {
      s.messages.push({ role: "user", content: `新轮次 ${i}` });
    }
    await maybeRollingSummary(s, provider);
    expect(s.summary).toContain("批次A要点");
  });
});

describe("buildContextMessages", () => {
  it("无摘要时只拼 system + 全部消息", () => {
    const s = mkState(4);
    const msgs = buildContextMessages(s, "SYSTEM_PROMPT");
    expect(msgs.length).toBe(5);
    expect(msgs[0]).toEqual({ role: "system", content: "SYSTEM_PROMPT" });
  });

  it("有摘要时注入摘要消息并只保留最近 8 条", () => {
    const s = mkState(30);
    s.summary = "早期摘要：已确认周五三点和张三开会";
    const msgs = buildContextMessages(s, "SYSTEM_PROMPT");
    expect(msgs.length).toBe(2 + 8);
    expect(msgs[0].content).toBe("SYSTEM_PROMPT");
    expect(msgs[1].role).toBe("system");
    expect(msgs[1].content).toContain("早期摘要");
    // 最近 8 条是最新的消息
    expect(msgs[2].content).toContain("用户第 22 条消息");
  });
});
