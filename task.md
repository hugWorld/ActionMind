# 1. 开发任务拆解

整个项目按照：

```
Task → Implementation → Gate
```

推进。

------

## Task 0 — 项目初始化 & 技术基线

### 工作内容

- 创建 Next.js
- TypeScript
- Tailwind
- Docker Compose
- PostgreSQL
- pgvector
- Prisma
- Vitest
- Playwright
- 环境变量

### Gate 0

必须满足：

```
Next.js 启动
PostgreSQL 启动
Prisma 连接
pgvector 可用
.env 可读取
Vitest 可运行
Playwright 可运行
```

------

## Task 1 — Core Schema

实现：

```
Contact
Memory
Meeting
Action
Execution
```

### Gate 1

可以完成：

```
Create Contact
Create Memory
Create Meeting
Create Action
Create Execution
```

------

## Task 2 — LLM Provider

实现：

```
DeepSeek Provider
```

支持：

```
Text
Image
Structured Output
```

使用：

```
Zod
```

验证输出。

### Gate 2

至少 5个测试样本。

正确识别：

```
Intent
Contact
Time
Contact Update
```

无法确定的信息返回：

```
null
```

------

## Task 3 — Screenshot Understanding

实现：

```
Upload Screenshot
       ↓
Vision LLM
       ↓
Structured Understanding
```

### Gate 3

至少：

```
10 screenshots
```

覆盖：

- 会议；
- 联系人；
- 联系方式更新；
- 多人；
- 相对时间；
- 历史引用。

------

## Task 4 — Contact Resolution

实现：

```
Name
Email
Phone
Organization
```

### Gate 4

必须正确处理：

```
Unique
Not Found
Ambiguous
Email Match
Phone Match
```

------

## Task 5 — Memory Pipeline

实现：

```
Candidate
Confirmed
Verified
```

### Gate 5

验证：

```
Model Inference
≠
Verified Memory
```

------

## Task 6 — Embedding Pipeline

实现：

```
Memory
 ↓
Embedding
 ↓
pgvector
```

实现：

```
EmbeddingProvider
```

### Gate 6

至少：

```
20 memories
10 queries
```

能够完成 Vector Search。

------

## Task 7 — BM25 Retrieval

实现：

```
Memory
 ↓
Keyword Index
 ↓
BM25 Search
```

### Gate 7

能够独立完成：

```
Keyword Search
```

并输出：

```
Top-K
Score
Memory ID
```

------

## Task 8 — Hybrid RAG

实现：

```
BM25
+
Embedding
+
Structured Retrieval
+
Reranking
```

### Gate 8

对同一批测试数据比较：

```
BM25
Embedding
Hybrid
```

输出：

```
Recall@5
MRR@5
```

------

## Task 9 — Agent Runtime

实现真正的 Agent Loop：

```
Agent
 ↓
Tool Selection
 ↓
Tool Result
 ↓
Agent
 ↓
Next Decision
```

Agent 至少拥有：

```
memory_search
contact_search
ask_user
create_action
```

### Gate 9

Agent 能够根据不同输入：

```
选择 Memory
选择 Contact
询问用户
生成 Action
```

------

## Task 10 — Action Card

实现：

```
View
Edit
Cancel
Confirm
```

### Gate 10

用户能够修改：

```
Time
Location
Contact
Title
```

------

## Task 11 — Human-in-the-loop Guard

实现确定性安全检查：

```
Action.status === CONFIRMED
```

才能执行。

### Gate 11

测试：

```
DRAFT → execute
```

必须失败。

```
CONFIRMED → execute
```

才能成功。

目标：

```
Unauthorized Write = 0
```

------

## Task 12 — Tool Executor

实现：

```
create_event
create_contact
update_contact
```

第一阶段使用：

```
PostgreSQL-backed Tool
```

### Gate 12

完整：

```
Agent
 ↓
Action
 ↓
Confirm
 ↓
Executor
 ↓
Tool
 ↓
Result
```

------

## Task 13 — Verified Memory

实现：

```
Tool Success
 ↓
Verified Memory
```

### Gate 13

成功：

```
source = tool_verified
confidence = 1.0
```

失败：

```
不生成 Verified Memory
```

------

## Task 14 — Evidence-grounded Insight

实现：

```
Memory
 ↓
Insight
 ↓
Evidence
```

### Gate 14

每条 Insight 必须引用真实 Memory。

无证据：

```
暂无可靠依据。
```

------

## Task 15 — Evaluation

建立：

```
70-case evaluation set
```

实现：

```
npm run eval
```

输出：

```
Intent Accuracy
Entity Accuracy
Resolution Accuracy

BM25 Recall@5
Embedding Recall@5
Hybrid Recall@5

BM25 MRR@5
Embedding MRR@5
Hybrid MRR@5

Unauthorized Execution Rate
Verified Memory Precision
```

### Gate 15

Evaluation 可以重复运行。

------

## Task 16 — E2E & MVP 收尾

最终完整测试：

```
Screenshot
    ↓
Agent
    ↓
Contact Search
    ↓
Memory RAG
    ↓
Planning
    ↓
Action Card
    ↓
User Confirm
    ↓
Tool
    ↓
Verified Memory
    ↓
Future Query
    ↓
Hybrid RAG
    ↓
Agent
```

### Gate 16

至少完成三个完整场景：

```
CREATE_MEETING
CREATE_CONTACT
UPDATE_CONTACT
```

------

# 2. MVP 最终验收

## Demo 1：创建会议

```
上传聊天截图
      ↓
Agent Understanding
      ↓
发现“上次那个地方”
      ↓
调用 Memory Search
      ↓
Hybrid RAG
      ↓
找到 Meeting Room 3
      ↓
生成 Action Card
      ↓
用户修改 / 确认
      ↓
Calendar Tool
      ↓
执行成功
      ↓
Verified Memory
```

------

## Demo 2：缺少信息

用户：

```
帮我约张三。
```

Agent：

```
找到张三
发现时间缺失
 ↓
Ask User
```

用户：

```
下周五下午三点。
```

Agent：

```
继续 Planning
 ↓
Action Card
 ↓
Confirm
 ↓
Tool
```

------

## Demo 3：长期 Memory

第一次：

```
与张三在 Meeting Room 3 开会
```

经过：

```
User Confirm
+
Tool Success
```

成为：

```
Verified Memory
```

未来：

```
帮我约张三，还是上次那个会议室。
```

Agent：

```
Contact Search
 ↓
Hybrid Memory RAG
 ↓
Meeting Room 3
 ↓
继续完成 Action
```

