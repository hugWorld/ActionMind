import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  classifyField,
  requiredFieldsOf,
  defaultableFieldsOf,
  defaultMeetingEnd,
  defaultMeetingTitle,
  applyFieldDefaults,
  DEFAULT_MEETING_DURATION_MINUTES,
} from "../src/server/planning/field-policy";
import { createEvent } from "../src/server/tools";
import { prisma } from "../src/server/db";

// Task 17 (Stage A) — 字段策略（Field Policy）：
// Required / Defaultable / Optional / Conditional 分类与默认值规则；create_event 结束时间缺省 = 开始 + 30 分钟。

const START = "2026-10-09T15:00:00+08:00";

describe("field-policy：字段分类", () => {
  it("CREATE_MEETING 字段四类齐全", () => {
    expect(classifyField("CREATE_MEETING", "start")).toBe("required");
    expect(classifyField("CREATE_MEETING", "contact")).toBe("optional");
    expect(classifyField("CREATE_MEETING", "end")).toBe("defaultable");
    expect(classifyField("CREATE_MEETING", "title")).toBe("defaultable");
    expect(classifyField("CREATE_MEETING", "notes")).toBe("optional");
    expect(classifyField("CREATE_MEETING", "location")).toBe("conditional");
    expect(classifyField("CREATE_MEETING", "不存在的字段")).toBeNull();
  });

  it("联系人字段 Required；联系方式 Optional", () => {
    expect(requiredFieldsOf("CREATE_CONTACT")).toEqual(["name"]);
    expect(classifyField("CREATE_CONTACT", "email")).toBe("optional");
    expect(classifyField("CREATE_CONTACT", "phone")).toBe("optional");
  });

  it("UPDATE_CONTACT 三字段 Required", () => {
    expect(requiredFieldsOf("UPDATE_CONTACT")).toEqual([
      "contactName",
      "field",
      "newValue",
    ]);
  });

  it("requiredFieldsOf / defaultableFieldsOf 与 policy 一致", () => {
    expect(requiredFieldsOf("CREATE_MEETING")).toEqual(["start"]);
    expect(defaultableFieldsOf("CREATE_MEETING")).toEqual(["title", "end"]);
  });
});

describe("field-policy：默认值规则", () => {
  it("默认时长 = 30 分钟", () => {
    expect(DEFAULT_MEETING_DURATION_MINUTES).toBe(30);
  });

  it("end 缺失 → start + 30 分钟", () => {
    const end = defaultMeetingEnd({ start: START });
    expect(end).toBe("2026-10-09T07:30:00.000Z");
    expect(new Date(end!).getTime() - new Date(START).getTime()).toBe(30 * 60_000);
  });

  it("end 已存在 → 不覆盖（返回 undefined）", () => {
    expect(defaultMeetingEnd({ start: START, end: "2026-10-09T16:00:00+08:00" })).toBeUndefined();
  });

  it("用户明确时长 durationMinutes=60 → 覆盖默认 30 分钟", () => {
    const end = defaultMeetingEnd({ start: START, durationMinutes: 60 });
    expect(new Date(end!).getTime() - new Date(START).getTime()).toBe(60 * 60_000);
  });

  it("start 缺失/无效 → 无默认结束时间", () => {
    expect(defaultMeetingEnd({})).toBeUndefined();
    expect(defaultMeetingEnd({ start: "not-a-date" })).toBeUndefined();
  });

  it("标题默认：有联系人 →「与{联系人}的会议」；无 →「新建会议」", () => {
    expect(defaultMeetingTitle({ contact: { name: "张三" } })).toBe("与张三的会议");
    expect(defaultMeetingTitle({ name: "李四" })).toBe("与李四的会议");
    expect(defaultMeetingTitle({})).toBe("新建会议");
  });

  it("applyFieldDefaults：补齐 end/title，不覆盖已有值", () => {
    const out = applyFieldDefaults("CREATE_MEETING", {
      start: START,
      contact: { name: "张三" },
    });
    expect(out.end).toBe("2026-10-09T07:30:00.000Z");
    expect(out.title).toBe("与张三的会议");

    // 已有 end 与 title 不被覆盖
    const out2 = applyFieldDefaults("CREATE_MEETING", {
      start: START,
      title: "项目周会",
      end: "2026-10-09T16:00:00+08:00",
    });
    expect(out2.end).toBe("2026-10-09T16:00:00+08:00");
    expect(out2.title).toBe("项目周会");
  });
});

describe("field-policy：create_event 工具层默认值接线（真实 DB）", () => {
  beforeAll(() => {
    // 需要 PostgreSQL（actionmind-db）可用
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("end 缺省 → 落库 endAt = start + 30 分钟", async () => {
    const m = await createEvent({
      id: "unit-test",
      type: "CREATE_MEETING",
      payload: { title: "与张三的会议", start: START },
    });
    expect(m.endAt).toBe("2026-10-09T07:30:00.000Z");
    expect(new Date(m.endAt!).getTime() - new Date(START).getTime()).toBe(30 * 60_000);
  });

  it("durationMinutes=45 → endAt = start + 45 分钟", async () => {
    const m = await createEvent({
      id: "unit-test",
      type: "CREATE_MEETING",
      payload: { title: "与张三的会议", start: START, durationMinutes: 45 },
    });
    expect(new Date(m.endAt!).getTime() - new Date(START).getTime()).toBe(45 * 60_000);
  });

  it("end 明确指定 → 保留用户指定值", async () => {
    const m = await createEvent({
      id: "unit-test",
      type: "CREATE_MEETING",
      payload: { title: "与张三的会议", start: START, end: "2026-10-09T17:00:00+08:00" },
    });
    expect(m.endAt).toBe("2026-10-09T09:00:00.000Z"); // 17:00 +08:00 == 09:00Z
  });
});
