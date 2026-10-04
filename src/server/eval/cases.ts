// Task 15 — 70-case Evaluation Set（PRD §53 分配：理解 20 + 联系人解析 15 + 记忆检索 20 + 工具安全 15）
// 说明：时间类用例全部使用绝对日期（如"10月9日周五下午三点"），保证 Evaluation 可重复运行、
// 不随系统日期漂移；相对时间推算能力由 Task 2/9 的真实 LLM 测试另行覆盖。

import type { Intent } from "../llm/schemas";

// ---------- 1) Screenshot/聊天理解（20 cases：Intent / Entity / Time） ----------

export interface UnderstandingEvalCase {
  id: string;
  transcript: string;
  userText?: string;
  intent: Intent;
  /** 期望抽取到的关键实体（值比对；email 小写、phone 去非数字后比对） */
  entities: Array<{ kind: "name" | "email" | "phone" | "organization"; value: string }>;
  /** 期望的会议开始时间：{date:"2026-10-09", hour:15}；null 表示期望 start=null */
  time: { date: string; hour: number } | null;
  needsMemory?: boolean;
  note?: string;
}

export const UNDERSTANDING_CASES: UnderstandingEvalCase[] = [
  {
    id: "u01",
    transcript: "张伟：10月9日周五下午三点在星巴克见？\n李娜：可以。",
    intent: "CREATE_MEETING",
    entities: [{ kind: "name", value: "张伟" }, { kind: "name", value: "李娜" }],
    time: { date: "2026-10-09", hour: 15 },
  },
  {
    id: "u02",
    transcript: "王强：我们下个月碰个头吧，具体时间再定。",
    intent: "CREATE_MEETING",
    entities: [{ kind: "name", value: "王强" }],
    time: null,
    note: "缺时间 → missing 应含 time",
  },
  {
    id: "u03",
    transcript: "刘洋：周五下午见？\n赵敏：还是上次那个地方。",
    intent: "CREATE_MEETING",
    entities: [{ kind: "name", value: "刘洋" }, { kind: "name", value: "赵敏" }],
    time: null,
    needsMemory: true,
    note: "历史引用场景：对话无钟点，正确行为是 start=null + needsMemory=true，时间依赖记忆补全",
  },
  {
    id: "u04",
    transcript: "我是陈晨，我的电话是 13800001234，在评测科技做前端。",
    intent: "CREATE_CONTACT",
    entities: [
      { kind: "name", value: "陈晨" },
      { kind: "phone", value: "13800001234" },
      { kind: "organization", value: "评测科技" },
    ],
    time: null,
  },
  {
    id: "u05",
    transcript: "孙丽的新邮箱是 sunli@example.com，麻烦记一下。",
    intent: "CREATE_CONTACT",
    entities: [{ kind: "name", value: "孙丽" }, { kind: "email", value: "sunli@example.com" }],
    time: null,
  },
  {
    id: "u06",
    transcript: "张伟：我换邮箱了，以后用 zhangwei@newmail.com 联系我。",
    intent: "UPDATE_CONTACT",
    entities: [{ kind: "name", value: "张伟" }, { kind: "email", value: "zhangwei@newmail.com" }],
    time: null,
  },
  {
    id: "u07",
    transcript: "李娜：我的手机号换成了 13900005678。",
    intent: "UPDATE_CONTACT",
    entities: [{ kind: "name", value: "李娜" }, { kind: "phone", value: "13900005678" }],
    time: null,
  },
  {
    id: "u08",
    transcript: "王强：我现在在评测集团做产品经理了。",
    intent: "UPDATE_CONTACT",
    entities: [{ kind: "name", value: "王强" }, { kind: "organization", value: "评测集团" }],
    time: null,
  },
  {
    id: "u09",
    transcript: "赵敏：10月9日周五下午三点，老地方，别忘了。\n刘洋：收到。",
    intent: "CREATE_MEETING",
    entities: [{ kind: "name", value: "赵敏" }, { kind: "name", value: "刘洋" }],
    time: { date: "2026-10-09", hour: 15 },
    needsMemory: true,
    note: "老地方 = 历史引用",
  },
  {
    id: "u10",
    transcript: "今天天气不错，你吃饭了吗？",
    intent: "UNKNOWN",
    entities: [],
    time: null,
  },
  {
    id: "u11",
    transcript: "我是周舟，邮箱 zhouzhou@example.com。\n我是吴琼，邮箱 wuqiong@example.com。",
    intent: "CREATE_CONTACT",
    entities: [
      { kind: "name", value: "周舟" },
      { kind: "email", value: "zhouzhou@example.com" },
      { kind: "name", value: "吴琼" },
      { kind: "email", value: "wuqiong@example.com" },
    ],
    time: null,
    note: "多联系人",
  },
  {
    id: "u12",
    transcript: "郑爽：我们开个会吧。\n郑爽：时间你定。",
    intent: "CREATE_MEETING",
    entities: [{ kind: "name", value: "郑爽" }],
    time: null,
    note: "缺时间缺地点 → missing 应含 time/location",
  },
  {
    id: "u13",
    transcript: "冯雪：11月5日周三上午十点会议室开会。\n冯雪：顺便说一句，我新邮箱 fengxue@example.com。",
    intent: "CREATE_MEETING",
    entities: [{ kind: "name", value: "冯雪" }, { kind: "email", value: "fengxue@example.com" }],
    time: { date: "2026-11-05", hour: 10 },
    note: "会议+换邮箱混合，主线为会议",
  },
  {
    id: "u14",
    transcript: "楚云：10月16日周五下午两点，公司楼下咖啡厅。",
    intent: "CREATE_MEETING",
    entities: [{ kind: "name", value: "楚云" }],
    time: { date: "2026-10-16", hour: 14 },
  },
  {
    id: "u15",
    transcript: "韩雪：我们见一面吧。",
    intent: "CREATE_MEETING",
    entities: [{ kind: "name", value: "韩雪" }],
    time: null,
    note: "缺时间 → missing 应含 time",
  },
  {
    id: "u16",
    transcript: "秦朗：确认一下，周五下午三点咱们聊？\n秦朗：地点还是上次那个。",
    intent: "CREATE_MEETING",
    entities: [{ kind: "name", value: "秦朗" }],
    time: { date: "2026-10-09", hour: 15 },
    needsMemory: true,
  },
  {
    id: "u17",
    transcript: "何静：我的号码换了，现在是 13700007890。",
    intent: "UPDATE_CONTACT",
    entities: [{ kind: "name", value: "何静" }, { kind: "phone", value: "13700007890" }],
    time: null,
  },
  {
    id: "u18",
    transcript: "许文：10月9日周五下午三点，记得带上方案。",
    intent: "CREATE_MEETING",
    entities: [{ kind: "name", value: "许文" }],
    time: { date: "2026-10-09", hour: 15 },
  },
  {
    id: "u19",
    transcript: "最近在写论文，忙死了。",
    intent: "UNKNOWN",
    entities: [],
    time: null,
  },
  {
    id: "u20",
    transcript: "我有个朋友叫林峰，下次介绍给你认识。",
    intent: "UNKNOWN",
    entities: [],
    time: null,
    note: "只提名字无联系方式 → 不应 CREATE_CONTACT",
  },
];

// ---------- 2) Contact Resolution（15 cases） ----------

export interface ContactSeed {
  name: string;
  email?: string;
  phone?: string;
  organization?: string;
}

export interface ContactEvalCase {
  id: string;
  label: string;
  input: { name?: string; email?: string; phone?: string; organization?: string };
  expected: "unique" | "ambiguous" | "not_found";
  /** expected=unique 时期望命中的种子姓名 */
  expectedName?: string;
}

/** 评估用种子联系人（独特前缀，避免与并行测试文件的联系人冲突） */
export const CONTACT_SEEDS: ContactSeed[] = [
  { name: "评测甲", email: "eval-jia@example.com", phone: "13811110001", organization: "评测公司A" },
  { name: "评测乙", email: "eval-yi@example.com", phone: "13811110002", organization: "评测公司B" },
  { name: "评测同名", email: "eval-tong1@example.com", phone: "13811110003", organization: "评测公司A" },
  { name: "评测同名", email: "eval-tong2@example.com", phone: "13811110004", organization: "评测公司C" },
];

export const CONTACT_CASES: ContactEvalCase[] = [
  { id: "c01", label: "姓名唯一匹配", input: { name: "评测甲" }, expected: "unique", expectedName: "评测甲" },
  { id: "c02", label: "邮箱匹配", input: { email: "eval-yi@example.com" }, expected: "unique", expectedName: "评测乙" },
  { id: "c03", label: "电话匹配", input: { phone: "13811110002" }, expected: "unique", expectedName: "评测乙" },
  { id: "c04", label: "公司匹配（唯一）", input: { organization: "评测公司B" }, expected: "unique", expectedName: "评测乙" },
  { id: "c05", label: "不存在 → not_found", input: { name: "评测不存在的人" }, expected: "not_found" },
  { id: "c06", label: "同名歧义 → ambiguous", input: { name: "评测同名" }, expected: "ambiguous" },
  { id: "c07", label: "邮箱大小写+空格归一", input: { email: "  EVAL-JIA@EXAMPLE.COM  " }, expected: "unique", expectedName: "评测甲" },
  { id: "c08", label: "电话格式归一（连字符）", input: { phone: "138-1111-0001" }, expected: "unique", expectedName: "评测甲" },
  { id: "c09", label: "多字段优先级：邮箱 > 姓名", input: { name: "评测乙", email: "eval-jia@example.com" }, expected: "unique", expectedName: "评测甲" },
  { id: "c10", label: "同名+公司仍歧义", input: { name: "评测同名", organization: "评测公司A" }, expected: "ambiguous" },
  { id: "c11", label: "邮箱不存在 → not_found", input: { email: "nobody@example.com" }, expected: "not_found" },
  { id: "c12", label: "电话不存在 → not_found", input: { phone: "19999999999" }, expected: "not_found" },
  { id: "c13", label: "邮箱 DB insensitive", input: { email: "EVAL-YI@EXAMPLE.COM" }, expected: "unique", expectedName: "评测乙" },
  { id: "c14", label: "电话格式归一（空格）", input: { phone: "138 1111 0003" }, expected: "unique", expectedName: "评测同名" },
  { id: "c15", label: "歧义检测：同名双候选", input: { name: "评测同名" }, expected: "ambiguous" },
];

// ---------- 3) Memory Retrieval（20 memories + 20 queries，独特语料避免并行污染） ----------

export const EVAL70_MEMORIES: string[] = [
  "与测评张三在六楼会议室开项目周会",
  "10月9日周五下午三点和测评客户在星巴克见面",
  "11月8日上午去医院复查",
  "和测评妈妈约好10月10日去爬香山",
  "每周一早上和测评团队站会",
  "测评李四换了新邮箱 eval-lisi@example.com",
  "测评王五的新手机号是 13900000002",
  "测评赵六在评测科技做研究员",
  "测评陈晨喜欢喝美式咖啡",
  "测评张三的生日是 3 月 15 日",
  "测评钱七住在朝阳区望京",
  "测评孙八是产品经理",
  "测评周九的团队做前端开发",
  "测评吴十每周四晚上健身",
  "计划下个月去杭州出差",
  "月底要给测评客户提交方案",
  "11月13日周五参加行业峰会",
  "周末要修完门锁",
  "下季度预算会议安排在 11 月初",
  "与测评张三约了11月6日周五下午的面试",
];

export interface RetrievalEvalCase70 {
  query: string;
  relevantContent: string[];
}

export const EVAL70_QUERIES: RetrievalEvalCase70[] = [
  { query: "项目周会在哪个会议室开", relevantContent: [EVAL70_MEMORIES[0]] },
  { query: "和客户在哪见面", relevantContent: [EVAL70_MEMORIES[1]] },
  { query: "医院复查是什么时候", relevantContent: [EVAL70_MEMORIES[2]] },
  { query: "和妈妈周末去哪", relevantContent: [EVAL70_MEMORIES[3]] },
  { query: "测评李四的联系邮箱是什么", relevantContent: [EVAL70_MEMORIES[5]] },
  { query: "测评王五的电话是多少", relevantContent: [EVAL70_MEMORIES[6]] },
  { query: "测评赵六在哪个公司工作", relevantContent: [EVAL70_MEMORIES[7]] },
  { query: "测评陈晨喜欢喝什么咖啡", relevantContent: [EVAL70_MEMORIES[8]] },
  { query: "测评张三的生日是哪天", relevantContent: [EVAL70_MEMORIES[9]] },
  { query: "下个月的出差计划", relevantContent: [EVAL70_MEMORIES[14]] },
  { query: "每周一和团队碰头的时间", relevantContent: [EVAL70_MEMORIES[4]] },
  { query: "13900000002 是谁的号码", relevantContent: [EVAL70_MEMORIES[6]] },
  { query: "下季度预算会议安排在什么时候", relevantContent: [EVAL70_MEMORIES[18]] },
  { query: "测评孙八是做什么的", relevantContent: [EVAL70_MEMORIES[11]] },
  { query: "测评周九的团队做什么技术", relevantContent: [EVAL70_MEMORIES[12]] },
  { query: "测评钱七住在哪里", relevantContent: [EVAL70_MEMORIES[10]] },
  { query: "这个周末有什么安排", relevantContent: [EVAL70_MEMORIES[3], EVAL70_MEMORIES[17]] },
  { query: "和测评张三约了什么面试", relevantContent: [EVAL70_MEMORIES[19]] },
  { query: "什么时候给客户交方案", relevantContent: [EVAL70_MEMORIES[15]] },
  { query: "门锁什么时候修", relevantContent: [EVAL70_MEMORIES[17]] },
];

// ---------- 4) Tool Safety（15 cases） ----------

export type ToolSafetyExpect =
  | { kind: "unauthorized" }
  | { kind: "success"; expectVerified: boolean }
  | { kind: "fail"; expectVerified: boolean };

export interface ToolSafetyCase {
  id: string;
  label: string;
  type: "CREATE_MEETING" | "CREATE_CONTACT" | "UPDATE_CONTACT";
  payload: Record<string, unknown>;
  /** 初始状态：默认 DRAFT；true 表示先 confirm */
  confirm: boolean;
  /** 期望执行结果 */
  expect: ToolSafetyExpect;
}

export const TOOL_SAFETY_CASES: ToolSafetyCase[] = [
  { id: "t01", label: "DRAFT 建会议 → 拒绝", type: "CREATE_MEETING", payload: { title: "评测会1", start: "2026-11-05T10:00:00+08:00" }, confirm: false, expect: { kind: "unauthorized" } },
  { id: "t02", label: "DRAFT 建联系人 → 拒绝", type: "CREATE_CONTACT", payload: { name: "评测工具甲" }, confirm: false, expect: { kind: "unauthorized" } },
  { id: "t03", label: "DRAFT 更新联系人 → 拒绝", type: "UPDATE_CONTACT", payload: { name: "评测工具甲", email: "x@example.com" }, confirm: false, expect: { kind: "unauthorized" } },
  { id: "t04", label: "DRAFT 建会议（完整信息）→ 拒绝", type: "CREATE_MEETING", payload: { title: "评测会2", start: "2026-11-05T14:00:00+08:00", location: "六楼" }, confirm: false, expect: { kind: "unauthorized" } },
  { id: "t05", label: "CANCELLED 后执行 → 拒绝", type: "CREATE_CONTACT", payload: { name: "评测工具乙" }, confirm: false, expect: { kind: "unauthorized" }, },
  { id: "t06", label: "CONFIRMED 建会议 → 成功 + Verified", type: "CREATE_MEETING", payload: { title: "评测会3", start: "2026-11-05T15:00:00+08:00", location: "六楼会议室", contact: { name: "评测张三" } }, confirm: true, expect: { kind: "success", expectVerified: true } },
  { id: "t07", label: "CONFIRMED 建联系人 → 成功 + Verified", type: "CREATE_CONTACT", payload: { name: "评测工具丙", email: "toolc@example.com", phone: "13700000001", organization: "评测公司" }, confirm: true, expect: { kind: "success", expectVerified: true } },
  { id: "t08", label: "CONFIRMED 更新联系人 → 成功 + Verified", type: "UPDATE_CONTACT", payload: { name: "评测工具丙", email: "toolc-new@example.com" }, confirm: true, expect: { kind: "success", expectVerified: true } },
  { id: "t09", label: "CONFIRMED 建会议缺标题 → 失败", type: "CREATE_MEETING", payload: { start: "2026-11-05T10:00:00+08:00" }, confirm: true, expect: { kind: "fail", expectVerified: false } },
  { id: "t10", label: "CONFIRMED 更新不存在联系人 → 失败", type: "UPDATE_CONTACT", payload: { name: "评测不存在的工具人", email: "ghost@example.com" }, confirm: true, expect: { kind: "fail", expectVerified: false } },
  { id: "t11", label: "CONFIRMED 更新歧义联系人 → 失败", type: "UPDATE_CONTACT", payload: { name: "评测同名", email: "new@example.com" }, confirm: true, expect: { kind: "fail", expectVerified: false } },
  { id: "t12", label: "CONFIRMED 建会议时间非法 → 失败", type: "CREATE_MEETING", payload: { title: "评测会4", start: "不是时间" }, confirm: true, expect: { kind: "fail", expectVerified: false } },
  { id: "t13", label: "CONFIRMED 建联系人缺姓名 → 失败", type: "CREATE_CONTACT", payload: { email: "nobody@example.com" }, confirm: true, expect: { kind: "fail", expectVerified: false } },
  { id: "t14", label: "EXECUTING 状态不可重复执行（状态机完整性）", type: "CREATE_MEETING", payload: { title: "评测会5", start: "2026-11-05T16:00:00+08:00" }, confirm: true, expect: { kind: "unauthorized" } },
  { id: "t15", label: "已执行的 Action 不可重复执行（SUCCESS 冻结）", type: "CREATE_MEETING", payload: { title: "评测会6", start: "2026-11-05T17:00:00+08:00" }, confirm: true, expect: { kind: "success", expectVerified: true } },
];
