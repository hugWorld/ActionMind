# ActionMind

Context-Aware Personal Action Agent — 与 Agent 对话（纯文字 / 聊天截图 / 图文混合）安排会议、管理联系人：
Agent 从对话中理解人物、时间、联系方式与行动意图，生成可确认的 Action Card；
用户确认后才调用设备能力（会议 / 联系人，MVP 为 PostgreSQL mock）执行，
并将成功结果沉淀为联系人 Memory，结合上下文与已确认记忆给出有依据的洞察与建议。

- 完整产品说明见 [PRD.md](PRD.md)
- 开发任务拆解见 [task.md](task.md)

## 技术栈（Task 0 基线）

Next.js 16（App Router）· React 19 · TypeScript · Tailwind CSS v4 · Prisma 6 · PostgreSQL 16 + pgvector · Vitest · Playwright · Docker Compose

## 快速开始（WSL 内）

前置：Node 22（`~/.local/bin`）、docker 守护进程、docker compose v2。

```bash
cd ~/ActionMind
docker compose up -d          # 启动 PostgreSQL 16 + pgvector（镜像已本地导入）
cp .env.example .env          # 默认 DATABASE_URL 已可用
npm run prisma:generate
npm run dev                   # 启动后 Windows 浏览器直接打开 http://localhost:3000
```

运行测试：

```bash
npm test            # Vitest：.env 读取 + Prisma 连接 + pgvector 可用（3 tests）
npm run test:e2e    # Playwright：首页渲染 E2E
```

## 环境注意

- npm registry 已配置为 npmmirror；Prisma 引擎下载走 `PRISMA_ENGINES_MIRROR=https://npmmirror.com/mirrors/prisma`。
- Playwright Chromium 所需系统库已解压至 `~/.local/lib-ext`，`~/.bashrc` 已配置 `LD_LIBRARY_PATH`（新开终端生效）。
- 本机网络对 GitHub / Docker Hub 直连不稳定：镜像从国内源（阿里云 / DaoCloud / npmmirror）获取。
- docker 服务仍带有过期代理配置（`/etc/systemd/system/docker.service.d/proxy.conf` 指向失效的 `172.19.208.1:10808`）。
  当前本地已有 pgvector 镜像，不影响 Task 0 使用；如需 `docker pull` 新镜像，请先执行：
  `sudo rm /etc/systemd/system/docker.service.d/proxy.conf && sudo systemctl restart docker`

## Task 0 验收状态（Gate 0）

- [x] Next.js 启动（`npm run dev` / `npm run build` 均通过，Windows 可访问 localhost:3000）
- [x] PostgreSQL 启动（docker compose，healthcheck 通过）
- [x] Prisma 连接（Vitest db smoke 通过）
- [x] pgvector 可用（extension vector 0.8.7）
- [x] .env 可读取（Vitest env smoke 通过）
- [x] Vitest 可运行（3 tests passed）
- [x] Playwright 可运行（1 e2e passed）

## Task 1 验收状态（Gate 1）

- [x] Create Contact（含邮箱/电话多值、verified/active/source）
- [x] Create Memory（type/source/confidence/metadata/embedding 列）
- [x] Create Meeting（contact/title/start/end/location/status）
- [x] Create Action（type/status/payload/evidence）
- [x] Create Execution（tool_name/request/response/status）
- [x] pgvector 扩展随迁移声明（CREATE EXTENSION IF NOT EXISTS vector）

## Task 2 验收状态（Gate 2）

- [x] LLMProvider 抽象：chat（自由文本）+ structured（JSON 结构化输出，Zod 校验失败自动重试并回喂错误）
- [x] DeepSeekProvider：原生 fetch 调用 `/chat/completions`，`response_format=json_object`，自动去除 ```json 围栏
- [x] 多模态：`image_url` 内容块（base64 data URL），模型 deepseek-flash（V4.1 Flash，支持视觉）
- [x] ChatUnderstanding Zod Schema：Intent / contacts / meeting（含 needsMemory）/ contactUpdate / missing
- [x] understandChat（文本）与 understandScreenshot（截图）入口，系统提示词内置当前 Asia/Shanghai 时间
- [x] 契约：无法确定的信息一律 null（空串在 schema 层归一为 null）
- [x] Gate 2 测试：7 个样本（创建会议[有时间/缺时间]、更新邮箱、创建联系人、历史引用 needsMemory、UNKNOWN、截图视觉识别），Intent/Contact/Time/ContactUpdate/null 全部命中

## Task 3 验收状态（Gate 3）

- [x] Screenshot Understanding 管线：Upload Screenshot → Vision LLM → Structured Understanding
- [x] `POST /api/understand`（multipart 上传 / JSON base64 双格式，类型与 10MB 大小校验，key 缺失返回 503）
- [x] 首页上传 UI：选图预览 + 补充文字 + 意图/联系人/会议/更新/缺失参数展示 + 原始 JSON
- [x] 视觉样本：1 张真实聊天截图（张三/李四 多人 + 周五相对时间 + “上次那个地方”历史引用）经 HTTP 管线识别正确
- [x] 覆盖维度（会议/联系人/更新/多人/相对时间/历史引用）：由 Task 2 的 7 个文本+图像样本补齐（Gate 3 截图数按用户指示放宽为 1）
- [x] 校验测试：缺文件 / 非图片 → 400

## Task 4 验收状态（Gate 4）

- [x] Contact Resolution（`src/server/contacts/resolve.ts`）：Name / Email / Phone / Organization
- [x] 确定性优先级：邮箱（最强标识）→ 电话 → 姓名 → 公司（兜底）
- [x] 归一化：邮箱 trim+小写（DB insensitive）；电话去空格/连字符等非数字字符；姓名/公司 trim+insensitive
- [x] 仅 active 的联系方式参与解析；inactive 一律忽略
- [x] Gate 4 测试 9 个：Unique / Not Found / Ambiguous（姓名、邮箱）/ Email Match / Phone Match / Inactive 忽略 / 邮箱优先于姓名 / 空输入

## Task 5 验收状态（Gate 5）

- [x] Memory Pipeline（`src/server/memory/pipeline.ts`）：Candidate → Confirmed → Verified
- [x] 状态映射：model_inferred/0.3 → user_confirmed/0.8 → tool_verified/1.0
- [x] `stageOf` / `isVerifiedMemory`（仅 tool_verified 为 Verified）
- [x] 受保护升级：仅 Candidate 可 confirm、仅 Confirmed 可 verify；重复升级/降级拒绝
- [x] Gate 5 核心不变式：Model Inference ≠ Verified Memory（模型推断记忆不可直接验证）

## Task 6 验收状态（Gate 6）

- [x] EmbeddingProvider 抽象 + HttpEmbeddingProvider（本地 Python 服务，`npm run embed:server` 启动）
- [x] 本地 CPU 模型：fastembed + BAAI/bge-small-zh-v1.5（512 维，独立 venv `~/actionmind-embed-venv`，模型下载走 hf-mirror）
- [x] 迁移：`memories.embedding` vector(1536) → vector(512)（手写迁移——Prisma 不 diff Unsupported() 内部维度，见 `20261004180000_task6_embedding_dim`）
- [x] `embedMemory` / `embedMemoriesMissing`（只补缺失向量）/ `searchMemories`（pgvector 余弦距离 Top-K + similarity）
- [x] Gate 6：20 条记忆全部生成 embedding；10 个查询全部完成 Vector Search，Top-5 命中预期记忆

## Task 7 验收状态（Gate 7）

- [x] BM25 关键词索引（`src/server/search/bm25.ts`，纯 TS 无依赖）
- [x] 分词：中文单字 + bigram（无词典基线），拉丁/数字连续串（电话/邮箱可精确命中）
- [x] `buildBm25Index` / `searchBm25` / `keywordSearchMemories`，输出 Top-K / Score / Memory ID
- [x] 打分 BM25(k1=1.5, b=0.75)，score 降序，score=0 的无关文档不返回
- [x] Gate 7 测试：邮箱/电话/中文关键词精确命中；多文档命中排序；空索引/空查询

## Task 8 验收状态（Gate 8）

- [x] Hybrid RAG 检索器（`src/server/search/hybrid.ts`）：BM25 + Embedding 双通道各取 Top-N
- [x] RRF 融合（小语料 rrfK=2，rank 差异显著）→ 双通道一致加分（crossBonus=0.05）
- [x] Structured Retrieval：查询类型词（会议/邮箱/电话/出差/峰会/预算等）→ 记忆类型加权（structuredBoost=0.03，仅作 tiebreaker 不主导排序）
- [x] 重排后输出 Top-K / Score / Memory ID / 来源标注（bm25|embedding）
- [x] 评估指标（`src/server/eval/metrics.ts`）：Recall@K 与 MRR@K
- [x] Gate 8：同一批数据（`tests/fixtures/eval-set.ts`：20 条记忆 + 13 个查询，含 3 个通道分歧查询）对比三方法：
      BM25 / Embedding / Hybrid 均 Recall@5=1.0、MRR@5=1.0；Hybrid Recall@5 ≥ 单通道最优
- [x] 修复：并行测试竞态（embedding 计数断言限定本测试记忆集）

## Task 9 验收状态（Gate 9）

- [x] Agent Runtime（`src/server/agent/`）：Agent → Tool Selection → Tool Result → Agent → Next Decision
- [x] 四把工具：memory_search（复用 Task 8 Hybrid RAG）/ contact_search（复用 Task 4 解析）/ ask_user / create_action（落库 DRAFT）
- [x] Agent 决策结构化输出（Zod discriminatedUnion，空串归一 null，参数校验失败回喂重试），最大轮数兜底 5
- [x] Gate 9（真实 LLM deepseek-flash，5 场景）：
      - 生成 Action：历史引用 → memory_search → contact_search → create_action（payload 含 Meeting Room 3）
      - 询问用户：缺时间 → ask_user 问时间
      - 选择 Memory：历史询问 → memory_search → answer 引用记忆（含 memoryIds 依据）
      - 选择 Contact：not_found → ask_user 澄清（不假装已解析）
      - 无行动意图 → unknown
- [x] 稳定性修复：embed_server 推理加锁串行化（onnxruntime 并发不保证确定性）；测试种子语料去重（agent 记忆与 eval-set 逐字不同，避免并行歧义）；embedding 断言改为 id 精确映射

## Task 10 验收状态（Gate 10）

- [x] Action Card 服务层（`src/server/actions/`）：View（viewAction/listActions）/ Edit / Cancel / Confirm
- [x] 可编辑字段白名单：title / start / end / location / contact / notes / missing（Gate 10：Time / Location / Contact / Title 均可改）
- [x] 编辑留痕：evidence.edits（at/field/from/to）；未变更字段跳过；其他 payload 字段原样保留
- [x] 状态机：仅 DRAFT 可 Edit/Cancel/Confirm；CONFIRMED 与 CANCELLED 冻结（后续操作抛 INVALID_STATE）
- [x] API：GET /api/actions(?status)、GET/PATCH /api/actions/:id、POST /api/actions/:id/confirm、POST /api/actions/:id/cancel
- [x] Gate 10 测试：服务层 5 项 + 路由层 1 项（含 404 / 400 / 状态流转）

## Task 11 验收状态（Gate 11）

- [x] Human-in-the-loop Guard（`src/server/execution/`）：`assertActionConfirmed` 确定性检查
- [x] 统一执行入口 `executeAction`：守卫（一切写操作之前）→ Execution(RUNNING) → 工具 → SUCCESS/FAILED
- [x] Gate 11：DRAFT→execute 抛 UnauthorizedExecutionError，无 Execution 记录、Action 仍 DRAFT、零副作用（Unauthorized Write = 0）
- [x] CONFIRMED→execute 成功：Execution SUCCESS、Action SUCCESS、真实副作用（联系人创建）发生
- [x] 执行失败 → Action FAILED + Execution FAILED（不抛未捕获错误）；不存在 Action → NOT_FOUND
- [x] 启动脚本修复：HF_HUB_DISABLE_XET=1（huggingface_hub≥1.31 默认 Xet 协议，hf-mirror 401）

### 运维修复（Task 11 后置）

- [x] `scripts/ensure-embed.sh`：幂等拉起 embedding 服务（已健康即退出；否则拉起并等待就绪），解决 WSL 后台进程被 VM 回收导致的 ECONNREFUSED
- [x] 测试 beforeAll 统一改走 `tests/helpers/ensure-embed.ts`（共享进程，不再各文件 spawn+kill）
- [x] `HF_HUB_DISABLE_XET=1` 已固化进启动脚本（huggingface_hub≥1.31 默认 Xet 协议，hf-mirror 401）

## Task 12 验收状态（Gate 12）

- [x] Tool Executor（`src/server/tools/`）：PostgreSQL-backed Tools，mock 设备能力（不调用真实 Windows 日历/联系人）
- [x] `create_event` → meetings 表（title/start/end/location/contactId 关联、eventId mock 标记）
- [x] `create_contact` → contacts + emails/phones 子表（verified/active/source 留痕）
- [x] `update_contact` → 按 contactId 或确定性解析定位（not_found/ambiguous 抛 TOOL_TARGET 错误，不假装成功）；新增渠道去重、保留旧渠道
- [x] `toolForAction` 按 Action.type 分发 + `executeWithTools` 统一入口（复用 Gate 11 守卫与 Execution 留痕）
- [x] Gate 12：完整链路 Agent→Action→Confirm→Executor→Tool→Result（真实 LLM 场景：约李雷建会议；确定性场景：建联系人/更新联系人/工具失败双 FAILED/未确认拒绝）

## Task 13 验收状态（Gate 13）

- [x] Verified Memory（Tool Success → Memory）：`createVerifiedMemory`（source=tool_verified, confidence=1.0）
- [x] 幂等：同 contact+content 的 Verified Memory 已存在则跳过（created=false）
- [x] 可选即时 embedding（pgvector 列走 $executeRaw；失败不阻塞记忆本身，可稍后回填）
- [x] `executeWithTools` 成功路径自动沉淀：create_event→meeting / create_contact→contact_update / update_contact→contact_update（含新增渠道/组织变更明细），metadata 记 actionId 可溯源
- [x] 失败路径零沉淀：工具失败不生成任何 Verified Memory
- [x] 不变式保持：Model Inference ≠ Verified Memory（候选仍须经用户确认才能升级；Verified 唯一来源为工具成功）
- [x] 健壮性修复：`embedMemoriesMissing` 回填容忍记忆被并行删除（findUnique 而非 findUniqueOrThrow）

## Task 14 验收状态（Gate 14）

- [x] Evidence-grounded Insight（`src/server/insights/`）：基于检索到的真实记忆生成事实性洞察
- [x] 输出结构 `{claim, evidenceIds[]}`；LLM 生成后经 `filterInsightsByEvidence` 严格过滤——任何证据 id 不存在/编造 → 整条剔除（不依赖 LLM 自觉）
- [x] 无任何记忆 → 不调 LLM，直接返回「暂无可靠依据。」；全部被剔除/判定无关 → 同样返回说明
- [x] 禁止无记忆支撑的心理/社交推断（prompt 硬约束 + 证据过滤兜底）

## Task 15 — Evaluation（70-case 可重复评估）✅

- 数据集 `src/server/eval/cases.ts`（PRD §53 分配）：理解 20（Intent/Entity/Time）+ 联系人解析 15（含歧义检测）+ 记忆检索 20 queries×20 记忆（独立语料）+ 工具安全 15。
- 运行器 `src/server/eval/run70.ts` + `tests/eval-70.test.ts`；`npm run eval` 一键运行，输出指标表并落盘 `eval-report.md` / `eval-report.json`（含逐 case 明细）。
- 评估口径：Intent/Entity/Resolution Accuracy；BM25·Embedding·Hybrid 的 Recall@5 与 MRR@5（相关命中占比口径）；Unauthorized Execution Rate（目标 0%，PRD §53.4）；Verified Memory Precision（目标 100%，PRD §54）。
- 实测（2026-10-04 快照，可重复运行）：
  - Intent Accuracy 0.95 / Entity 0.9677 / Time 1.0；Contact Resolution 1.0、Ambiguity Detection 1.0
  - BM25 R@5 0.975 / MRR 0.975；Embedding 0.975 / 0.9667；Hybrid 0.975 / 0.9667（与单通道持平）
  - Unauthorized Execution Rate 0.0（7 次未授权尝试全部拒绝）；Verified Memory Precision 1.0（成功 4 case 全部可溯源沉淀、失败 5 case 零沉淀）
- 已知边界（逐 case 可查）：u05「新邮箱」措辞模型判 UPDATE_CONTACT（可接受分歧）；u07「我的手机号换成了 X」句式中号码偶发未入 phone 字段（真实 LLM 抽取抖动）；检索 0.975 来自 q17「周末安排」双相关只命中其一（部分召回口径）。

## Task 16 — E2E & MVP 收尾（Action Card UI + 三完整场景）✅

- **UI（Task 16）**：`src/app/actions/page.tsx` Action Card 列表页——按状态筛选、逐张卡片 View / Edit（白名单字段 + evidence 编辑留痕）/ Confirm / Cancel / Execute；执行成功展示工具结果并提示 Verified Memory 已沉淀；状态机冻结（CANCELLED/FAILED/SUCCESS 不可重跑）。新 API：`POST /api/actions`（由理解结果创建 DRAFT 卡片）、`POST /api/actions/:id/execute`（确认后执行 + 即时 embedding）。
- **首页闭环（Task 17 重构后为对话式）**：与 Agent 多轮对话 → Action Card 预览 → 确认执行 / 对话修改 → Verified Memory（见 Task 17 段）。
- **三个完整场景（Gate 16）**：`tests/e2e-flow.test.ts`（API 级真实 LLM）——CREATE_MEETING / CREATE_CONTACT / UPDATE_CONTACT，每条链路：Understanding → Action Card → 未确认拒绝 → Confirm → Tool → Verified Memory → Future Query（Hybrid RAG + BM25）命中。`tests/e2e/action-cards.spec.ts`（Playwright UI 闭环，Task 17 更新）——纯文字多轮对话 → 建卡 → 确认执行 → SUCCESS + Verified Memory；Image-only 上传截图 → 理解 → 卡片预览。
- **三个 MVP Demo 支持**：Demo1 历史引用（needsMemory → 检索记忆补全地点）；Demo2 缺信息（missing → 用户补全后确认）；Demo3 长期记忆（执行成功后 Verified Memory，未来查询 RAG 命中）。

## Task 17 — 交互模型重构（对话式 Agent，Gate 17）✅

用户提出 13 条重构要求（告别表单 Workflow，改为真正的对话式 ReAct Loop），分三阶段落地，未删除任何既有功能：

- **Stage A — 字段策略**：`src/server/planning/field-policy.ts` 定义 Required / Defaultable / Optional / Conditional 分类与默认值规则——结束时间缺省 = 开始时间 + 30 分钟（用户明确指定时长/结束时间才覆盖）、标题缺省「与{联系人}的会议」；`create_event` 结束时间自动兜底；理解层支持 `durationMinutes`（明确提到时长才填，不猜）。
- **Stage B — 会话化 Agent Runtime**：结构化 `AgentState`（goal / extractedInfo / resolvedContacts / retrievedMemories / missingRequiredInfo / currentAction / toolResults / askedQuestions / phase / trace / messages）持久化于内存 session store（30 分钟 TTL）；`runAgentSession` 在既有 ReAct loop 上增加持久化状态与多轮续跑——ask_user 是 Agent 合法决策，用户回答/修改作为新用户消息回喂（Human Feedback）；Required 护栏（缺失 → Runtime 决定 ask_user，动态决定、不硬编码）；新增 `POST /api/agent/chat` 对话入口，支持 Text only / Image only / Text+Image。
- **Stage C — 前端对话式 UI**：首页重写为聊天界面（纯文字 / 可选截图 / 图文混合）；Action Card 内嵌只读预览 + 「确认并执行」+ 对话式修改（想改直接输入新要求，Agent 重新生成卡片，不退化表单）；Actions 页移除表单式编辑。
- **测试**：`tests/agent-session.test.ts`（历史问答直接回答 / 多轮 ask_user→补全→卡片 / Image-only 建卡）+ Playwright 两个对话场景；vitest 文件级串行消除共享 DB 种子污染。
- **回归**：21 测试文件 94 用例全绿；eval 70-case 指标不变。


---

# 部署与运行教程（自行测试用）

## 0. 前置条件

- Windows + WSL（代码在 `~/ActionMind`，Windows 侧只开浏览器测试）。
- WSL 内已装：Docker（容器 `actionmind-db`）、Node（`~/.local/bin/node`）、Prisma CLI。
- `.env` 已配置：`DEEPSEEK_API_KEY` / `DEEPSEEK_BASE_URL` / `DEEPSEEK_MODEL`（deepseek-flash，支持图像）/ `EMBEDDING_URL=http://127.0.0.1:8765` / `EMBEDDING_MODEL=BAAI/bge-small-zh-v1.5` / `DATABASE_URL=postgresql://actionmind:actionmind_dev@localhost:5432/actionmind?schema=public`。

## 1. 启动（三件事，按序）

在 WSL 里执行：

```bash
cd ~/ActionMind
export PATH="$HOME/.local/bin:$PATH"

# ① 数据库（已建容器则秒起）
docker start actionmind-db 2>/dev/null || docker compose up -d
# 首次部署：npx prisma migrate deploy && npx prisma generate

# ② Embedding 服务（幂等；首次会下载模型 ~90MB，约 1-2 分钟）
bash scripts/ensure-embed.sh
# 看到 "ready" 即 OK；服务被系统回收后可随时重跑本命令自愈

# ③ Web 应用
npm run dev
# 显示 ready 后，Windows 浏览器打开 http://localhost:3000
```

> 注意：全部命令在 WSL 里跑；浏览器测试在 Windows 侧（访问 localhost:3000 即可，无需跨网络）。

## 2. 自己测试的路径（对话式 Demo，Task 17 起）

### Demo 1：创建会议（纯文字）

1. 首页直接输入：`帮我约张三，周五下午三点见`（不强制截图，Text-only）。
2. Agent 缺联系人/时间时会反过来问你（ask_user 气泡），你接着回复即可（同一会话多轮续跑）。
3. 信息足够 → 出现 Action Card 预览：结束时间自动 = 开始 + 30 分钟（默认，不用填）。
4. 点「确认并执行」→ 成功并沉淀 Verified Memory。

### Demo 2：上传聊天截图（Image-only / Text+Image）

1. 点「截图」选图（内置微信风格示例 `tests/assets/chat-wechat.png` / `chat-wechat-simple.png`，对方在左白气泡、你在右绿气泡；也可传自己的微信/QQ 截图）。
2. 只传图直接「发送」，或图文一起发（图 + 补充文字）→ Agent 从截图理解意图并建卡。
3. 想改卡片？不要填表——直接在输入框说 `时间改到周五上午十点`，Agent 会更新状态重新生成卡片。

### Demo 3：历史问答 + 长期记忆

1. 先完成一次会议执行（Demo 1/2），Verified Memory 已沉淀。
2. 新会话直接问：`我和张三上次是什么时候开的会？` → Agent 通过 Contact Search + Memory Retrieval 直接回答，无需截图。

### Demo 4：查询 / 修改 / 取消（自然语言，Task 18）

1. 查询：`我周五有什么安排？` / `我和张三下次什么时候见？` → Agent 通过 task_search + Memory 直接回答，不建卡。
2. 取消：`取消我和张三周五的会议` → task_search 定位 → 唯一则生成「即将取消」卡片；**多条候选则先 ask_user 让你选择**，选完再建卡、确认执行（CANCELLED 保留记录）。
3. 修改：`把和张三的会议改到周六下午三点` → 生成「即将修改」卡片 → 确认执行。
4. 日程页：导航栏「日程」→ `/schedule`，月 / 周 / 日视图切换，上一 / 下一 / 今天导航；默认隐藏已取消，可勾选「显示已取消任务」。

## 3. 测试与评估命令

```bash
npm run test          # 全部单元/集成测试（含 Task 0-16 + 70-case eval + 三场景 E2E flow）
npm run eval          # 70-case 评估报告（落盘 eval-report.md / eval-report.json，逐 case 可查）
npm run test:e2e      # Playwright UI 测试（需已装 chromium 系统依赖）
npx tsc --noEmit      # 类型检查
```

## 4. 常用运维速查

| 需求 | 命令 |
| --- | --- |
| 看数据库 | `docker exec actionmind-db psql -U actionmind -d actionmind` |
| 重启 embedding | `bash scripts/ensure-embed.sh`（幂等） |
| 回填缺失向量 | 服务端已自动（embedMemoriesMissing）；测试环境用 `npm run embed:server` |
| 查看 Action 状态 | `SELECT id,type,status FROM actions ORDER BY created_at DESC LIMIT 10;` |
| 看 Verified Memory | `SELECT id,source,confidence,content FROM memories WHERE source='tool_verified' ORDER BY created_at DESC LIMIT 10;` |

## 5. 已知边界（自己测试时留意）

- 会议标题为空时执行会被工具拒绝（正确防御）——先编辑补标题再确认。
- 首次上传截图理解约需几秒（DeepSeek API）；Embedding 服务被 WSL 回收后需重跑 ensure-embed.sh。
- 设备能力（日历/联系人）为 mock：写的是 PostgreSQL 表（meetings/contacts），未接真实 Windows API，但状态机与守卫逻辑与真实一致。

