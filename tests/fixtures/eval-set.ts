/**
 * 共享评估数据集（Gate 6 / Gate 8 同一批数据）
 * 20 条记忆（会议/联系人更新/事实/行动）+ 10 个查询（含期望命中的记忆内容）
 */

export const EVAL_MEMORIES: string[] = [
  "和张三在 Meeting Room 3 开项目周会",
  "周五下午三点和客户在星巴克见面",
  "下周三上午去医院复查",
  "和妈妈约好周六去爬香山",
  "周一早上和团队站会",
  "李四换了新邮箱 lisi@example.com",
  "王五的新手机号是 13900000002",
  "赵六在某某公司做研究员",
  "陈晨喜欢喝美式咖啡",
  "张三的生日是 3 月 15 日",
  "钱七住在朝阳区望京",
  "孙八是产品经理",
  "周九的团队做前端开发",
  "吴十每周四晚上健身",
  "计划下个月去杭州出差",
  "月底要给客户提交方案",
  "下周五参加行业峰会",
  "周末要修完门锁",
  "下季度预算会议安排在 11 月初",
  "和张三约了周五下午的面试",
];

export const EVAL_QUERIES: Array<{ query: string; expectedContent: string }> = [
  { query: "项目周会在哪个会议室开", expectedContent: EVAL_MEMORIES[0] },
  { query: "和客户在哪见面", expectedContent: EVAL_MEMORIES[1] },
  { query: "医院复查是什么时候", expectedContent: EVAL_MEMORIES[2] },
  { query: "和妈妈周末去哪", expectedContent: EVAL_MEMORIES[3] },
  { query: "李四的联系邮箱是什么", expectedContent: EVAL_MEMORIES[5] },
  { query: "王五的电话是多少", expectedContent: EVAL_MEMORIES[6] },
  { query: "赵六在哪个公司工作", expectedContent: EVAL_MEMORIES[7] },
  { query: "陈晨喜欢喝什么咖啡", expectedContent: EVAL_MEMORIES[8] },
  { query: "张三的生日是哪天", expectedContent: EVAL_MEMORIES[9] },
  { query: "下个月的出差计划", expectedContent: EVAL_MEMORIES[14] },
  // 通道分歧型：paraphrase（BM25 词面弱）/ 精确词面（Embedding 语义弱）
  { query: "下周和团队碰头的时间", expectedContent: EVAL_MEMORIES[4] },
  { query: "13900000002 是谁的号码", expectedContent: EVAL_MEMORIES[6] },
  { query: "下季度预算会议安排在什么时候", expectedContent: EVAL_MEMORIES[18] },
];
