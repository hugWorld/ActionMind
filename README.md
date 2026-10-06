# ActionMind — Personal Task & Schedule Agent

一个对话式的个人任务与日程管理 Agent：像聊天一样安排你的日程。Agent 负责理解你的意图、检索上下文、生成可确认的执行计划，并在你确认后落地执行，最后把成功的结果沉淀为长期记忆。

支持创建、查询、修改、取消任务与日程，会议只是任务的一种类型。聊天截图是可选的输入来源，纯文字即可完成全部操作。

## 核心亮点

- **对话式操作** — 创建 / 查询 / 修改 / 取消任务，全部通过自然语言完成，无需表单
- **多模态输入** — 纯文字（Text-only）/ 微信聊天截图（Image-only）/ 图文混合（Text + Image）
- **Human-in-the-loop** — 所有外部状态变更（创建会议、建联系人、改任务、取消任务）都先产出 **Action Card 预览**，用户确认后才执行；用户也可以直接说"改一下"，修改意见回到 Agent 重新生成卡片
- **冲突检测护栏** — 同一时段已有任务时自动提示，绝不静默覆盖；Agent 忘记检查时由确定性护栏兜底
- **记忆沉淀与检索** — 每次成功执行沉淀为 Verified Memory（pgvector 向量 + BM25 混合检索），可以回答"我和张三上次在哪里开的会"这类历史问题
- **日程页** — 月 / 周 / 日三视图，被取消的任务可追溯查看
- **会话持久化** — 刷新页面、在聊天与日程页之间切换，聊天记录不丢失

## 工作原理

```
用户输入（文字 / 截图）
      │
      ▼
   Agent（ReAct 循环）
   LLM 决策 → 工具调用 → 观察结果 → 再决策
      │
      ├─ 工具：contact_search / task_search / memory_search
      │        check_task_conflict / create_action / ask_user / answer
      │
      ├─ 信息不足 → ask_user 追问（Agent 根据上下文决定是否询问，不把所有缺字段都当必填）
      │
      ▼
 Action Card（执行计划预览）
      │
      ├─ 用户确认 ────────────────┐
      │                           │
      ├─ 用户提出修改 ─→ 回到 Agent 更新卡片 │
      ▼                           │
  Deterministic Guard（冲突/字段校验）│
      ▼                           │
  Tool Executor（create_event / create_contact / update_contact / cancel_task）
      ▼                           │
  Verified Memory 沉淀（pgvector）┘
```

关键设计：

- **Agent State**：不只存消息，还结构化保存 `goal / extractedInfo / resolvedContacts / retrievedMemories / missingRequiredInfo / currentAction / phase / trace`
- **字段策略分级**：`Required`（缺失会阻塞执行，如开始时间）必须追问；`Defaultable`（如结束时间默认开始 + 30 分钟）自动补；`Optional`（备注、描述）有则用、没有不追问；`Conditional`（如地点）由 Agent 根据任务和上下文动态决定是否询问
- **防幻觉**：Agent 判定一律以工具返回为准，禁止凭空编造任务、记忆或冲突；LLM 偶发漏查时间冲突时，由确定性护栏在生成卡片前兜底拦截
- **滚动摘要**：长对话超过阈值时，早期轮次自动压缩为要点摘要注入上下文（失败不阻塞、分批控制成本），防止上下文无限膨胀
- **取消即归档**：取消任务采用 `CANCELLED` 状态而非物理删除，保留完整 Memory / Execution / Trace

## 技术栈

| 层 | 技术 |
|---|---|
| 前端 | Next.js 16（App Router）、React 19、TypeScript、Tailwind CSS v4 |
| 后端 | Next.js API Routes、Zod、Prisma 6 |
| 数据 | PostgreSQL 16 + pgvector（向量检索）、Docker Compose |
| LLM | DeepSeek API（`deepseek-flash`，支持文本 + 图像 + 结构化输出） |
| Embedding | 本地服务（fastembed + `BAAI/bge-small-zh-v1.5`，CPU 即可运行） |
| 测试 | Vitest（单元 + 集成）、Playwright（真实浏览器 E2E） |

## 快速开始

前置要求：Node.js ≥ 20、Docker（用于 PostgreSQL + pgvector）、Python 3.9+（仅记忆检索需要）、DeepSeek API Key。

```bash
# 1. 启动数据库（PostgreSQL 16 + pgvector）
docker compose up -d

# 2. 安装依赖并配置环境变量
npm install
cp .env.example .env        # 填入 DEEPSEEK_API_KEY；DATABASE_URL 默认已指向本地 docker compose
npm run prisma:generate

# 3.（推荐）启动本地 embedding 服务 —— 记忆检索（memory_search）依赖它
npm run embed:server        # 首次运行会下载模型（约 100MB），之后常驻 127.0.0.1:8765
# 注：`npm run seed:demo` 与 `npm run eval:memory` 会自动拉起该服务；
#     若服务被系统回收（WSL 后台进程偶发），随时执行 `bash scripts/ensure-embed.sh` 重新拉起

# 4. 启动开发服务器
npm run dev
```

浏览器打开 http://localhost:3000 即可开始对话。

（可选）导入演示数据 —— **100 个联系人 / 300 条任务 / 355 条记忆**（确定性生成、幂等、可随时重跑，覆盖四种任务类型与三种状态）：

```bash
npm run seed:demo        # 会自动拉起本地 embedding 服务
```

## 使用示例

| 你输入 | Agent 行为 |
|---|---|
| `周五下午三点和张三开会` | 检索联系人 → 检查时间冲突 → 生成 Action Card → 你确认后创建 |
| `我周五有什么安排？` | 调用 task_search 查询当天任务并汇总回答 |
| `我和张三上次在哪里开的会？` | 检索 Verified Memory → 回答"星巴克，9月20日" |
| `把和张三的会议改到周六下午三点` | 找到目标任务 → 生成修改卡片 → 确认后更新 |
| `取消我和张三周五的会议` | 找到候选任务（多个候选时请用户选择消歧）→ 确认后取消（归档为 CANCELLED） |
| `周五下午三点上数学课` | 冲突检测 → 提示与"与张三见面"时间重叠，由你选择：仍然创建 / 调整时间 / 放弃 |

任务类型：`MEETING / TODO / REMINDER / OTHER`；状态：`scheduled（=CONFIRMED）/ completed / cancelled`。

## 数据模型

- **Contact** — 联系人，支持多个电话 / 邮箱，可标记 verified / active
- **Memory** — 长期记忆（type：`meeting / contact_update / action / fact`），含 pgvector 向量列与置信度
- **Meeting** — 任务 / 日程单表（Task = ScheduleItem），`taskType` 区分任务类型，`status` 区分状态
- **Action** — 执行计划，生命周期 `DRAFT → USER_CONFIRM → EXECUTE → RESULT`
- **Execution** — 工具执行流水（tool_name / request / response / status），全程可追溯

## 测试

```bash
npm test            # Vitest：单元 + 集成（含真实 LLM 场景），28 个文件 / 121 个用例
npm run test:e2e    # Playwright：真实浏览器 + 真实 LLM 端到端（串行执行，用例间自动清库）
npm run eval:memory # 记忆检索评测：26 个标注查询（精确/语义/噪声）× Hybrid 检索，
                    # 输出 Recall@1 / Recall@5 / MRR（需先 npm run seed:demo）
```

注意：集成与 E2E 测试会调用 DeepSeek API 并写入本地数据库，请先完成环境配置（步骤 1–3）。

## 项目结构

```
src/
  app/                    # Next.js App Router
    page.tsx              #   聊天主页（对话 + Action Card + 执行结果）
    schedule/page.tsx     #   日程页（月 / 周 / 日视图）
    actions/page.tsx      #   Action Card 列表页
    api/
      agent/chat/         #   对话 API（Agent Session 入口）
      actions/            #   Action 确认 / 执行 / 取消
      tasks/              #   任务查询
      understand/         #   截图理解
  server/
    agent/                # ReAct Agent：runtime / tools / state / schema / types
    llm/                  # DeepSeek Provider、结构化输出、截图理解
    planning/             # field-policy（字段策略分级）
    actions/              # Action Card 生成与生命周期
    execution/            # Tool Executor（确定性执行器）
    memory/               # 记忆沉淀管线
    embedding/            # 本地 embedding 服务与向量检索
    contacts/             # 联系人解析 / 管理
    insights/             # 洞察与建议
scripts/
  embed_server.py         # 本地 embedding 服务（fastembed）
  seed-demo.ts            # 演示数据 seed（幂等：100 联系人 / 300 任务 / 355 记忆）
  memory-eval.ts          # 记忆检索评测（Recall@1 / Recall@5 / MRR）
prisma/schema.prisma      # 数据模型
tests/                    # Vitest 单元 / 集成 + e2e（Playwright）
```

## 环境变量

| 变量 | 说明 | 默认 |
|---|---|---|
| `DATABASE_URL` | PostgreSQL 连接串 | `postgresql://actionmind:actionmind_dev@localhost:5432/actionmind` |
| `DEEPSEEK_API_KEY` | DeepSeek API Key（必填） | — |
| `DEEPSEEK_BASE_URL` | DeepSeek API 地址 | `https://api.deepseek.com` |
| `DEEPSEEK_MODEL` | 模型名（支持文本 + 图像 + 结构化输出） | `deepseek-flash` |
| `DEEPSEEK_JSON_MODE` | 是否发送 `response_format: json_object` | `true` |
| `EMBEDDING_URL` | 本地 embedding 服务地址 | `http://127.0.0.1:8765` |
| `EMBEDDING_MODEL` | embedding 模型 | `BAAI/bge-small-zh-v1.5` |
| `EMBEDDING_PORT` | embedding 服务端口 | `8765` |

## Roadmap（可能的演进方向）

- 接入真实设备能力（系统日历 / 通讯录），替换当前 PostgreSQL mock
- 更多任务类型与周期性日程（RRULE）
- 多用户 / 账号隔离
- 更丰富的日程视图（甘特 / 列表导出）

