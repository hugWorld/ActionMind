/**
 * ActionMind 演示数据 seed（幂等，确定性生成）：
 * - 联系人 100（张三/李四/王老师 锚点 + 97 生成，固定 PRNG 可复现）
 * - 任务 300+（过去 60 天 ~ 未来 90 天，覆盖 MEETING/TODO/REMINDER/OTHER 与 scheduled/completed/cancelled）
 * - Verified/Confirmed Memory 350+（每联系人 3 条含同主题干扰 + 全局噪声，供检索评测区分度）
 * 运行：bash -c 'set -a; source .env; set +a; npx tsx scripts/seed-demo.ts'
 */
import "dotenv/config";
import { prisma } from "../src/server/db";
import { createEmbeddingProvider, embedMemoriesMissing } from "../src/server/embedding";

// ---------- 确定性 PRNG（mulberry32，seed=42） ----------
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rng = mulberry32(42);
const pick = <T,>(arr: T[]): T => arr[Math.floor(rng() * arr.length)];
const ri = (min: number, max: number) => Math.floor(rng() * (max - min + 1)) + min;

const SURNAMES =
  "赵钱孙李周吴郑王冯陈褚卫蒋沈韩杨朱秦尤许何吕施张孔曹严华金魏陶姜戚谢邹喻柏水窦章云苏潘葛奚范彭郎鲁韦昌马苗凤花方俞任袁柳酆鲍史唐费廉岑薛雷贺倪汤滕殷罗毕郝邬安常乐于时傅皮卞齐康伍余元卜顾孟平黄和穆萧尹姚邵湛汪祁毛禹狄米贝明臧计伏成戴谈宋茅庞熊纪舒屈项祝董梁杜阮蓝闵席季麻强贾路娄危江童颜郭梅盛林刁钟徐邱骆高夏蔡田樊胡凌霍虞万支柯昝管卢莫经房裘缪干解应宗丁宣贲邓郁单杭洪包诸左石崔吉钮龚程嵇邢滑裴陆荣翁荀羊於惠甄麹家封芮羿储靳汲邴糜松井段富巫乌焦巴弓牧隗山谷车侯宓蓬全郗班仰秋仲伊宫宁仇栾暴甘斜厉戎祖武符刘景詹束龙叶幸司韶郜黎蓟薄印宿白怀蒲邰从鄂索咸籍赖卓蔺屠蒙池乔阴郁胥能苍双闻莘党翟谭贡劳逄姬申扶堵冉宰郦雍却璩桑桂濮牛寿通边扈燕冀郏浦尚农温别庄晏柴瞿阎充慕连茹习宦艾鱼容向古易慎戈廖庾终暨居衡步都耿满弘匡国文寇广禄阙东欧殳沃利蔚越夔隆师巩厍聂晁勾敖融冷訾辛阚那简饶空曾毋沙乜养鞠须丰巢关蒯相查后荆红游竺权逯盖益桓公";
const GIVEN =
  "伟芳娜敏静丽强磊洋勇艳杰娟涛明超霞平刚文辉建华红玉兰志强桂兰婷婷晓明子涵雨桐欣怡浩然梓萱俊杰诗涵嘉懿梦琪宇航思远晨曦慕晴乐瑶明轩若曦泽洋思雨嘉木亦辰安澜清欢知远可心书瑶沐宸芷若星阑";

function genName(used: Set<string>): string {
  for (let i = 0; i < 200; i++) {
    const s = SURNAMES[Math.floor(rng() * SURNAMES.length)];
    const g1 = GIVEN[Math.floor(rng() * GIVEN.length)];
    const g2 = GIVEN[Math.floor(rng() * GIVEN.length)];
    const name = g2 === undefined ? s + g1 : rng() < 0.4 ? s + g1 + g2 : s + g1;
    if (!used.has(name)) {
      used.add(name);
      return name;
    }
  }
  throw new Error("name pool exhausted");
}

const ORGS = ["研究生院", "产品部", "数学系", "研发部", "市场部", "运营部", "设计组", "教务处", "实验室", "人事部", "财务部", "销售组", "战略部", "测试组"];
const ROLES = ["同学", "产品负责人", "老师", "工程师", "研究员", "设计师", "主管", "顾问", "客户", "同事", "组长", "经理"];
const DOMAINS = ["example.com", "mail.com", "work.cn", "corp.io", "team.dev"];

// 主题池（刻意复用 → 形成跨联系人的同主题干扰，用于检索区分度评测）
const THEMES = ["毕业论文", "季度预算", "产品原型", "项目周报", "技术方案", "健身计划", "旅行攻略", "健康检查", "读书分享", "报销流程", "招聘面试", "课程设计"];

const MEETING_TITLES: Array<(n: string) => string> = [
  (n) => `与${n}的会议`,
  (n) => `和${n}开周会`,
  (n) => `${n}的产品评审`,
  (n) => `和${n}聊${pick(THEMES)}`,
  (n) => `${n}的技术方案讨论`,
  (n) => `客户${n}来访`,
  (n) => `和${n}的${pick(THEMES)}沟通`,
  (n) => `${n}的项目站会`,
  (n) => `和${n}碰头`,
  (n) => `${n}的季度复盘会`,
];
const TODO_TITLES: Array<() => string> = [
  () => `提交${pick(["周报", "月报", "报销单", "实验报告", "课程作业"])}`,
  () => `准备${pick(["PPT", "演讲", "面试材料", "组会汇报", "期末材料"])}`,
  () => `读书《${pick(["三体", "深入理解计算机系统", "设计心理学", "金字塔原理", "人类简史"])}》`,
  () => `整理${pick(["笔记", "代码", "照片", "书单", "报销凭证"])}`,
  () => `买${pick(["生日礼物", "日用品", "实验耗材", "办公用品"])}`,
  () => `复习${pick(["数学", "操作系统", "网络原理", "英语", "数据库"])}`,
];
const REMINDER_TITLES: Array<() => string> = [
  () => `提醒：给${pick(["妈妈", "爸爸", "导师", "房东"])}打电话`,
  () => "健身",
  () => "体检预约",
  () => "快递取件",
  () => `买${pick(["牛奶", "咖啡豆", "感冒药", "打印纸"])}`,
  () => "交水电费",
  () => "信用卡还款",
];
const OTHER_TITLES: Array<(n: string) => string> = [
  (n) => `${n}的婚礼`,
  () => "搬家",
  () => "维修洗衣机",
  () => "宽带续费",
  (n) => `${n}的生日`,
  () => "车检",
];

const LOCATIONS = ["会议室A", "星巴克", "图书馆204", "三楼会议室", "线上会议", "体育馆", "咖啡厅", "教室302", "健身房", "万达影城", "餐厅", "公园"];

// 记忆模板（每联系人生成 3 条：2 meeting + 1 fact；meeting 复用主题池 → 同主题干扰）
const MEETING_MEM_T: Array<(n: string, theme: string, loc: string, when: string) => string> = [
  (n, theme, loc, when) => `${when}和${n}在${loc}聊了${theme}`,
  (n, theme, loc, when) => `${when}与${n}开会讨论${theme}，约在${loc}`,
  (n, theme, _loc, when) => `${when}和${n}碰头，主题是${theme}`,
];
const FACT_MEM_T: Array<(n: string, org: string, role: string) => string> = [
  (n) => `${n}习惯提前十分钟到，见面常约${pick(["星巴克", "图书馆", "线上会议"])}`,
  (n, org, role) => `${n}在${org}做${role}，主要对接${pick(["项目", "排期", "预算", "课程"])}`,
  (n) => `${n}的微信回复比较慢，事情紧急建议直接打电话`,
  (n) => `${n}周三上午有课，下午时间相对宽裕`,
  (n) => `${n}喜欢${pick(["线上会议", "线下喝咖啡", "打球", "散步聊"])}，不喜欢太正式的场合`,
];

const NOISE_MEMS: string[] = [
  "下周三上午去医院复查牙齿",
  "家里宽带下月到期，记得续费",
  "书单：三体、操作系统导论、设计心理学",
  "跑步配速记录：5 公里配速 6 分 20 秒",
  "阳台的绿萝每周浇一次水",
  "信用卡 25 号还款日",
  "小区的垃圾分类回收点是周二和周五",
  "高铁票改签要在发车前 30 分钟办理",
  "猫三联疫苗今年 12 月要打第三针",
  "打印机墨盒剩 20%，提前买备用的",
  "楼下超市 8 点后生鲜打折",
  "驾照 2027 年 3 月到期换证",
  "老家的宽带密码是 wifi888888",
  "热水器 60 度省电，设置好了",
  "健身房周二晚上人少，适合去",
  "论文查重要用知网，先做预算",
  "咖啡豆买半磅装保存更新鲜",
  "地铁 15 号线年底开通到公司",
  "体检报告要带去给医生看",
  "邻居阿姨帮忙收了两次快递，要道谢",
  "植物园菊花展到这个月底结束",
  "充电宝和雨伞放包里备用",
  "每周五下午组会前整理一下问题清单",
  "银行柜台办理业务要取号排队",
  "月饼礼盒退了，记得跟进退款",
  "航班晚点险可以线上理赔",
  "宠物狗 10 月要打狂犬疫苗",
  "空调滤网拆下来清洗过一次",
  "移动套餐下月可以升级 5G",
  "图书馆闭馆时间周三是晚 8 点",
  "毕业证复印件多准备几份备用",
  "公司楼下新开了家面馆，口味不错",
  "洗衣机除垢剂用完要补货",
  "春秋被换季要拿出来晒",
  "电动车充电器在公司放着",
  "快递柜取件码 886 过期了",
  "饮水机滤芯半年换一次",
  "社保卡升级电子版已办好",
  "老同学聚会定在月底的周六",
  "冰箱除霜计划排在周末",
  "楼道里的感应灯坏了报修",
  "窗帘轨道滑轮要上油",
  "护照有效期到 2028 年",
  "车载灭火器过期要换新的",
  "血压计校准一下再用",
  "周末把冬天的衣服翻出来洗",
  "公司团建改到月底，地点待定",
  "手环充电线放在办公室抽屉",
  "项目服务器备份脚本周三跑一次",
  "门禁卡丢失已补办，旧卡作废",
];

const at = (iso: string) => new Date(iso);
const DAY = 86_400_000;
const NOW = new Date();

async function main() {
  // 1) 清空（幂等）
  await prisma.$executeRawUnsafe(
    "TRUNCATE TABLE meetings, actions, memories, contacts, contact_phones, contact_emails RESTART IDENTITY CASCADE",
  );

  // 2) 联系人（100：3 锚点 + 97 生成）
  const zhang = await prisma.contact.create({
    data: {
      name: "张三", organization: "研究生院", role: "同学",
      phones: { create: [{ phone: "13800001111", verified: true, source: "user_input" }] },
      emails: { create: [{ email: "zhangsan@example.com", verified: true, source: "user_input" }] },
    },
  });
  const li = await prisma.contact.create({
    data: {
      name: "李四", organization: "产品部", role: "产品负责人",
      phones: { create: [{ phone: "13900002222", verified: true, source: "user_input" }] },
    },
  });
  const wang = await prisma.contact.create({
    data: {
      name: "王老师", organization: "数学系", role: "老师",
      phones: { create: [{ phone: "13700003333", verified: false, source: "user_input" }] },
    },
  });
  const anchorContacts = [zhang, li, wang];
  const contactNameId = new Map<string, string>([
    ["张三", zhang.id],
    ["李四", li.id],
    ["王老师", wang.id],
  ]);
  const usedNames = new Set(["张三", "李四", "王老师"]);
  const generatedContacts: Array<{ name: string; id: string; org: string; role: string }> = [];
  for (let i = 0; i < 97; i++) {
    const name = genName(usedNames);
    const org = pick(ORGS);
    const role = pick(ROLES);
    const c = await prisma.contact.create({
      data: {
        name,
        organization: org,
        role,
        phones: { create: [{ phone: `13${ri(0, 9)}${ri(100000000, 999999999)}`, verified: rng() < 0.7, source: "seed-demo" }] },
        ...(rng() < 0.6
          ? {
              emails: {
                create: [{ email: `${name.toLowerCase()}@${pick(DOMAINS)}`, verified: rng() < 0.5, source: "seed-demo" }],
              },
            }
          : {}),
      },
    });
    contactNameId.set(name, c.id);
    generatedContacts.push({ name, id: c.id, org, role });
  }

  // 3) 任务（300：9 锚点 + 291 生成）
  const anchorTasks: Array<{
    title: string; taskType: string; startAt: string; endAt?: string; location?: string; notes?: string; status: string; contactId?: string;
  }> = [
    { title: "与张三的会议", taskType: "MEETING", startAt: "2026-09-20T15:00:00+08:00", endAt: "2026-09-20T16:00:00+08:00", location: "星巴克", notes: "聊毕业论文选题", status: "completed", contactId: zhang.id },
    { title: "和张三看电影", taskType: "MEETING", startAt: "2026-09-27T19:00:00+08:00", endAt: "2026-09-27T20:30:00+08:00", location: "万达影城", status: "cancelled", contactId: zhang.id },
    { title: "和张三的羽毛球", taskType: "MEETING", startAt: "2026-10-04T14:00:00+08:00", endAt: "2026-10-04T15:30:00+08:00", location: "体育馆", status: "completed", contactId: zhang.id },
    { title: "提醒：给妈妈打电话", taskType: "REMINDER", startAt: "2026-10-05T19:30:00+08:00", endAt: "2026-10-05T19:45:00+08:00", status: "scheduled" },
    { title: "数据结构课", taskType: "TODO", startAt: "2026-10-06T09:00:00+08:00", endAt: "2026-10-06T10:30:00+08:00", location: "教学楼302", notes: "带上次作业", status: "scheduled" },
    { title: "产品评审会", taskType: "MEETING", startAt: "2026-10-07T14:00:00+08:00", endAt: "2026-10-07T15:00:00+08:00", location: "会议室A", status: "scheduled", contactId: li.id },
    { title: "与张三见面", taskType: "MEETING", startAt: "2026-10-09T15:00:00+08:00", endAt: "2026-10-09T15:30:00+08:00", status: "scheduled", contactId: zhang.id },
    { title: "健身", taskType: "REMINDER", startAt: "2026-10-09T20:00:00+08:00", endAt: "2026-10-09T21:00:00+08:00", location: "健身房", status: "scheduled" },
    { title: "上数学课", taskType: "TODO", startAt: "2026-10-10T10:00:00+08:00", endAt: "2026-10-10T11:30:00+08:00", location: "图书馆204", status: "scheduled", contactId: wang.id },
  ];
  const taskRows: typeof anchorTasks = [...anchorTasks];
  for (let i = 0; i < 291; i++) {
    const withContact = rng() < 0.6;
    const contact = withContact ? pick(generatedContacts) : null;
    const type = pick(["MEETING", "MEETING", "TODO", "REMINDER", "OTHER"] as const);
    let title: string;
    if (type === "MEETING") title = pick(MEETING_TITLES)(contact ? contact.name : pick(generatedContacts).name);
    else if (type === "TODO") title = pick(TODO_TITLES)();
    else if (type === "REMINDER") title = pick(REMINDER_TITLES)();
    else title = pick(OTHER_TITLES)(contact ? contact.name : pick(generatedContacts).name);
    // 时间：过去 60 天 ~ 未来 90 天
    const offset = ri(-60, 90);
    const start = new Date(NOW.getTime() + offset * DAY);
    start.setHours(ri(8, 21), pick([0, 0, 30]) as number, 0, 0);
    const past = start.getTime() < NOW.getTime();
    const status = past ? pick(["completed", "completed", "scheduled", "cancelled"]) : pick(["scheduled", "scheduled", "scheduled", "cancelled"]);
    taskRows.push({
      title,
      taskType: type,
      startAt: start.toISOString(),
      endAt: new Date(start.getTime() + (pick([30, 45, 60, 90]) as number) * 60_000).toISOString(),
      location: rng() < 0.5 ? pick(LOCATIONS) : undefined,
      notes: rng() < 0.15 ? `备注：${pick(THEMES)}相关` : undefined,
      status,
      contactId: contact?.id,
    });
  }
  for (const t of taskRows) {
    await prisma.meeting.create({
      data: {
        title: t.title, taskType: t.taskType,
        startAt: at(t.startAt), endAt: t.endAt ? at(t.endAt) : undefined,
        location: t.location, notes: t.notes, status: t.status,
        contactId: t.contactId, source: "seed-demo",
      },
    });
  }

  // 4) 记忆（5 锚点 + 生成 ~350）
  const memRows: Array<{ type: string; content: string; contactId?: string; timestamp?: string; source: string; confidence: number }> = [
    { type: "meeting", content: "9月20日下午3点和张三在星巴克开的会，聊了毕业论文选题", contactId: zhang.id, timestamp: "2026-09-20T15:00:00+08:00", source: "tool_verified", confidence: 1 },
    { type: "fact", content: "张三习惯提前十分钟到，见面常约星巴克", contactId: zhang.id, source: "user_confirmed", confidence: 0.95 },
    { type: "fact", content: "王老师周三上午有课，下午时间相对宽裕", contactId: wang.id, source: "user_confirmed", confidence: 0.9 },
    { type: "meeting", content: "10月4日下午和张三在体育馆打了羽毛球", contactId: zhang.id, timestamp: "2026-10-04T14:00:00+08:00", source: "tool_verified", confidence: 1 },
    { type: "fact", content: "李四是产品组负责人，习惯线上会议", contactId: li.id, source: "user_confirmed", confidence: 0.9 },
  ];
  const whenList = (offsetDays: number) => {
    const d = new Date(NOW.getTime() + offsetDays * DAY);
    return `${d.getMonth() + 1}月${d.getDate()}日`;
  };
  const allForMem = [...generatedContacts, ...anchorContacts.map((c) => ({ name: c.name, id: c.id, org: c.organization ?? "", role: c.role ?? "" }))];
  // 每联系人生成 3 条（2 meeting 同主题 + 1 fact 习惯）
  for (const c of allForMem) {
    const theme1 = pick(THEMES);
    let theme2 = pick(THEMES);
    while (theme2 === theme1) theme2 = pick(THEMES);
    const loc1 = pick(LOCATIONS);
    const loc2 = pick(LOCATIONS);
    const off1 = ri(-50, -1);
    const off2 = ri(-10, 20);
    memRows.push({ type: "meeting", content: pick(MEETING_MEM_T)(c.name, theme1, loc1, whenList(off1)), contactId: c.id, timestamp: new Date(NOW.getTime() + off1 * DAY).toISOString(), source: "tool_verified", confidence: 1 });
    memRows.push({ type: "meeting", content: pick(MEETING_MEM_T)(c.name, theme2, loc2, whenList(off2)), contactId: c.id, timestamp: new Date(NOW.getTime() + off2 * DAY).toISOString(), source: "user_confirmed", confidence: 0.8 });
    memRows.push({ type: "fact", content: pick(FACT_MEM_T)(c.name, c.org, c.role), contactId: c.id, source: "user_confirmed", confidence: 0.9 });
  }
  // 全局噪声（无联系人，主题与个人无关）
  for (const content of NOISE_MEMS) {
    memRows.push({ type: "fact", content, source: "user_confirmed", confidence: 0.8 });
  }
  for (const m of memRows) {
    await prisma.memory.create({
      data: {
        type: m.type, content: m.content, contactId: m.contactId,
        timestamp: m.timestamp ? at(m.timestamp) : undefined,
        source: m.source, confidence: m.confidence,
      },
    });
  }

  // 5) 补全记忆 embedding（memory_search / hybrid 检索依赖 pgvector）
  const provider = createEmbeddingProvider();
  const missing = await embedMemoriesMissing(provider, 800);

  // 6) 汇总
  const c = await prisma.contact.count();
  const t = await prisma.meeting.count();
  const m = await prisma.memory.count();
  const emb = await prisma.$queryRawUnsafe<Array<{ n: bigint }>>(
    "SELECT COUNT(*) AS n FROM memories WHERE embedding IS NOT NULL",
  );
  const byStatus = await prisma.meeting.groupBy({ by: ["status"], _count: true });
  const byType = await prisma.meeting.groupBy({ by: ["taskType"], _count: true });
  console.log(`SEED_OK contacts=${c} tasks=${t} memories=${m} embedded=${String(emb[0].n)} embeddingWritten=${missing}`);
  console.log(`TASK_STATUS ${JSON.stringify(byStatus)}`);
  console.log(`TASK_TYPE ${JSON.stringify(byType)}`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error("SEED_FAIL", e);
  process.exit(1);
});
