# ActionMind

Context-Aware Personal Action Agent — 从聊天截图与补充文字中理解人物、时间、联系方式与行动意图，
生成可编辑、可逐张确认的 Action Card；用户确认后才调用设备能力（会议 / 联系人）执行，
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
