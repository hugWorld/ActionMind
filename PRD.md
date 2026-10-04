# ActionMind MVP PRD

> **项目名称：** ActionMind
> **项目定位：** Context-Aware Personal Action Agent
> **项目形式：** Web MVP
> **核心技术：** Multimodal LLM + Agent + Hybrid RAG + Personal Memory + Tool Calling + Human-in-the-loop

------

# 1. 产品概述

## 1.1 产品背景

日常聊天中存在大量具有实际行动价值的信息，例如：

- “周五下午三点见。”
- “还是上次那个会议室。”
- “我换邮箱了，新邮箱是 [xxx@gmail.com](mailto:xxx@gmail.com)。”
- “帮我记一下，下周一和张三开会。”
- “张三现在负责 XX 项目。”

这些信息通常存在于微信、Teams、邮件或其他聊天工具中，但用户需要手动完成：

1. 阅读聊天记录；
2. 理解人物、时间和事件；
3. 回忆历史上下文；
4. 查询联系人；
5. 创建日历事件；
6. 更新联系人；
7. 后续再次根据历史信息做判断。

ActionMind 希望将这个过程转化为一个：

> **能够理解上下文、主动检索记忆、规划行动、调用工具，并在关键写操作前请求用户确认的个人 Agent。**

------

# 2. 产品核心定位

ActionMind 不是一个普通的 Chatbot，也不是一个简单的固定 Workflow。

核心是：

> **LLM 驱动的 Agent Loop + Hybrid Memory RAG + Tool Calling + Human-in-the-loop。**

Agent 可以根据当前任务自主决定：

- 是否需要查询联系人；
- 是否需要检索 Memory；
- 是否需要进一步搜索；
- 是否需要询问用户；
- 是否可以生成 Action；
- 应该调用哪个 Tool。

但是 Agent 的外部状态写入受到确定性的安全边界约束。

------

# 3. 核心 Agent Loop

```
User Input
    ↓
Agent
    ↓
决定下一步需要什么
    │
    ├──→ Contact Search
    │
    ├──→ Memory RAG
    │
    ├──→ Ask User
    │
    ├──→ Generate Action
    │
    └──→ Call Tool
              ↓
        Human Confirmation
              ↓
         Tool Execution
              ↓
       Verified Memory
              ↓
          Future RAG
              ↓
            Agent
```

核心闭环：

```
Understand
    ↓
Retrieve
    ↓
Reason
    ↓
Plan
    ↓
Confirm
    ↓
Act
    ↓
Verify
    ↓
Remember
```

------

# 4. MVP 目标

MVP 不追求构建一个“万能个人助理”，而是验证完整的 Agent Loop：

```
Screenshot
    ↓
Multimodal Understanding
    ↓
Agent Decision
    ↓
Hybrid Memory RAG
    ↓
Planning
    ↓
Action Card
    ↓
Human Confirmation
    ↓
Tool Calling
    ↓
Execution Result
    ↓
Verified Memory
    ↓
Future Retrieval
```

用户能够：

1. 上传聊天截图；
2. 补充自然语言；
3. Agent 理解聊天内容；
4. 识别联系人、时间、事件和行动意图；
5. 根据需要主动检索历史 Memory；
6. 处理聊天中的相对引用；
7. 生成可编辑 Action Card；
8. 请求用户确认；
9. 调用 Calendar / Contacts Tool；
10. 根据执行结果更新 Memory；
11. 在未来任务中再次检索这些 Memory。

------

# 5. 核心用户场景

## 5.1 场景一：从聊天创建会议

用户上传聊天截图：

```
A：周五有空吗？
B：下午三点可以。
A：那还是上次那个地方？
B：可以。
```

Agent 不直接按照固定流程执行，而是自行判断：

```
当前信息：
- 联系人：B
- 意图：CREATE_MEETING
- 时间：周五 15:00
- 地点：当前未明确
- “上次那个地方”需要查询历史 Memory
```

Agent 调用：

```
memory.search(
    query="B 上次会议 地点"
)
```

得到：

```
Meeting Room 3
```

Agent 生成：

```
┌──────────────────────────────┐
│ 创建会议                      │
├──────────────────────────────┤
│ 参与人：张三                  │
│ 时间：2026-10-09 15:00       │
│ 地点：Meeting Room 3          │
│                              │
│ 来源：                        │
│ 当前聊天 + 历史 Memory        │
│                              │
│ [编辑]              [确认执行]│
└──────────────────────────────┘
```

用户确认后：

```
calendar.create_event()
```

Tool 成功：

```
Tool Success
    ↓
Verified Memory
```

------

# 6. 场景二：Agent 主动发现信息缺失

用户：

> “帮我约张三。”

Agent 判断：

```
Intent = CREATE_MEETING
Contact = 张三
Time = Unknown
```

Agent 不应该猜时间。

而应该：

```
Agent
 ↓
发现缺少必要参数
 ↓
Ask User
```

用户：

> “下周五下午三点。”

Agent 再继续：

```
Plan
 ↓
Action Card
 ↓
Confirm
 ↓
Tool
```

这体现 Agent 的核心能力：

> **根据当前状态判断下一步行动，而不是执行预先写死的步骤。**

------

# 7. 场景三：利用长期 Memory

用户：

> “帮我约张三，还是上次那个会议室。”

Agent：

```
需要解决：
1. 张三是谁？
2. 上次会议是哪一次？
3. 上次会议在哪里？
4. 当前会议时间是什么？
```

Agent 自主调用：

```
resolve_contact("张三")
```

然后：

```
memory.search(
    "张三 最近一次会议 地点"
)
```

得到：

```
Meeting Room 3
```

但如果时间仍然缺失：

```
Agent → Ask User
```

而不是直接执行。

------

# 8. 场景四：更新联系人

聊天截图：

```
张三：我换邮箱了
张三：以后联系我用 zhangsan@gmail.com
```

Agent：

```
Intent:
UPDATE_CONTACT

Contact:
张三

Field:
email

New Value:
zhangsan@gmail.com
```

生成：

```
┌──────────────────────────────┐
│ 更新联系人                    │
├──────────────────────────────┤
│ 联系人：张三                  │
│ 新邮箱：zhangsan@gmail.com    │
│                              │
│ [取消]             [确认更新] │
└──────────────────────────────┘
```

用户确认后：

```
contacts.update_contact()
```

执行成功后更新：

```
Profile Memory
+
Episodic Memory
```

------

# 9. MVP 支持的 Action

只支持三个：

```
CREATE_MEETING
CREATE_CONTACT
UPDATE_CONTACT
```

未知 Action：

```
UNKNOWN
```

Agent 不得强行映射到已有 Action。

------

# 10. Agent 与 Workflow 的边界

ActionMind根据当前 State 决定下一步。

```
                    ┌── Contact Search
                    │
                    ├── Memory Search
                    │
User → Agent ───────┼── Ask User
                    │
                    ├── Generate Action
                    │
                    └── Tool
```

------

## 10.1 Agent 可以自主决定

- 是否需要检索 Memory；
- 检索什么；
- 是否需要 Contact Resolution；
- 是否需要进一步调用 Tool；
- 是否缺少信息；
- 是否应该询问用户；
- Action 是否已经具备足够参数。

------

## 10.2 Agent 不可以绕过的边界

外部状态写入必须：

```
Agent
 ↓
Action Card
 ↓
User Confirmation
 ↓
Executor
 ↓
Tool
```

即：

> **Agent 决策可以是动态的，但安全边界必须是确定性的。**

------

# 11. Agent Architecture

```
┌────────────────────────────────────┐
│               Agent                │
│                                    │
│  Understand                        │
│  Decide Next Action                │
│  Select Tool                       │
│  Interpret Tool Result             │
│  Continue / Ask User / Finish      │
└───────────────┬────────────────────┘
                │
       ┌────────┼────────┐
       ↓        ↓        ↓
   Memory     Contact   User
    Tools      Tools    Input
       │        │
       ↓        ↓
   Hybrid      SQL
    RAG
       │
       └────────┬─────────
                ↓
          Action Planning
                ↓
           Action Card
                ↓
        Human Confirmation
                ↓
           Tool Executor
```

------

# 12. Memory 设计

Memory 不是一个简单的 Vector DB。

采用：

```
Structured Profile Memory
+
Episodic Memory
+
Hybrid Retrieval
```

------

# 13. Profile Memory

保存稳定的联系人信息。

例如：

```
{
  "contact_id": "c_001",
  "name": "张三",
  "emails": [
    {
      "value": "zhangsan@gmail.com",
      "verified": true,
      "active": true
    }
  ],
  "phones": [],
  "organization": "XX公司",
  "role": "Researcher"
}
```

Profile Memory 主要通过 PostgreSQL 查询。

------

# 14. Episodic Memory

保存用户过去发生的事件。

例如：

```
{
  "memory_id": "m_102",
  "type": "meeting",
  "contact_id": "c_001",
  "timestamp": "2026-10-03T15:00:00",
  "content": "与张三讨论 Project A",
  "location": "Meeting Room 3",
  "source": "tool_verified",
  "confidence": 1.0
}
```

Episodic Memory 可以记录：

- 会议；
- 联系方式变化；
- 已执行 Action；
- 用户确认的信息；
- 重要历史事件。

------

# 15. Memory Lifecycle

Memory 采用生命周期管理：

```
Candidate
    ↓
Confirmed
    ↓
Tool Verified
```

完整流程：

```
Screenshot
    ↓
LLM Extraction
    ↓
Memory Candidate
    ↓
Action Card
    ↓
User Confirmation
    ↓
Tool Execution
    ↓
SUCCESS
    ↓
Verified Memory
```

------

# 16. Memory Source

每条 Memory 必须记录来源：

```
screenshot_extracted
user_input
model_inferred
user_confirmed
tool_verified
```

其中：

```
tool_verified
```

代表最高可信度。

模型单纯推测：

```
model_inferred
```

不得直接成为：

```
tool_verified
```

------

# 17. Hybrid RAG

ActionMind 的 RAG 明确使用：

> **Structured Retrieval + BM25 + Embedding + Reranking**

整体架构：

```
                     User Query
                         │
          ┌──────────────┼──────────────┐
          ↓              ↓              ↓
    Structured         BM25         Embedding
     Retrieval         Search         Search
          │              │              │
          │              └──────┬───────┘
          │                     ↓
          │              Candidate Memories
          │                     │
          └──────────────┬──────┘
                         ↓
                     Reranker
                         ↓
                    Top-K Memory
                         ↓
                       Agent
```

------

# 18. Structured Retrieval

Structured Retrieval 负责：

```
Contact
Email
Phone
Organization
Event
Date
Event ID
```

例如：

```
SELECT *
FROM contacts
WHERE name = '张三';
```

Contact 不应该全部通过 Embedding 查找。

------

# 19. BM25 Retrieval

BM25 用于关键词和精确实体匹配。

适合：

```
人名
项目名
地点
邮箱
电话号码
专有名词
日期
```

例如 Memory：

```
张三的新邮箱是 zhangsan@gmail.com
```

用户：

```
张三现在的邮箱？
```

BM25 可以提供非常有效的 lexical matching。

------

# 20. Embedding Retrieval

Embedding 用于语义相似检索。

例如 Memory：

```
10月3日和张三讨论 Project A，
地点是 Meeting Room 3。
```

用户：

```
我上次和张三在哪里讨论项目的？
```

关键词不完全一致，但语义高度相关。

Embedding 可以找到对应 Memory。

------

# 21. Reranking

BM25 和 Embedding 返回候选：

```
Candidate Memories
```

然后进行综合排序。

初始可以考虑：

```
score =
0.35 × semantic_score
+
0.25 × bm25_score
+
0.20 × entity_match
+
0.10 × recency
+
0.10 × confidence
```

具体权重不是固定设计，后续通过 Evaluation 调整。

------

# 22. 为什么需要 Hybrid RAG

单独使用 Embedding：

```
优势：
语义理解

不足：
精确实体匹配可能较弱
```

单独使用 BM25：

```
优势：
关键词、实体、编号匹配

不足：
对自然语言改写不敏感
```

因此：

```
BM25
+
Embedding
```

更适合个人 Memory。

------

# 23. RAG Example

用户：

> “我上次和张三在哪里见面的？”

系统：

```
Query
 ↓
Entity Resolution
 ↓
张三 → contact_001
```

然后并行：

```
BM25:
“张三 见面 地点”

Embedding:
“与张三最近一次会议地点”
```

得到：

```
Memory 102
Memory 087
Memory 041
```

Reranker：

```
Memory 102
score = 0.93

Memory 087
score = 0.71

Memory 041
score = 0.44
```

最终：

```
Top-1 = Memory 102
```

Agent 获得：

```
Meeting Room 3
```

------

# 24. Agent Tool Set

Agent 至少拥有：

```
memory_search
contact_search
calendar_create_event
contact_create
contact_update
ask_user
```

------

# 25. Memory Search Tool

```
{
  "name": "memory_search",
  "description": "Search user's historical memories",
  "parameters": {
    "query": "string",
    "contact_id": "string|null",
    "top_k": "number"
  }
}
```

返回：

```
{
  "memories": [
    {
      "memory_id": "m_102",
      "content": "与张三在 Meeting Room 3 开会",
      "score": 0.93,
      "source": "tool_verified"
    }
  ]
}
```

Agent 可以根据结果决定：

```
继续执行
```

或者：

```
再次搜索
```

或者：

```
询问用户
```

------

# 26. Contact Search Tool

```
contact_search
```

用于：

```
姓名
Email
Phone
Organization
```

例如：

```
contact_search("张三")
```

返回：

```
contact_001
```

如果存在多个：

```
contact_001
contact_023
```

Agent 必须请求用户确认。

------

# 27. Ask User Tool

Agent 如果发现缺少必要信息，可以主动暂停：

```
ask_user
```

例如：

```
Agent：
我找到了张三和上次会议地点，但没有确定这次会议的时间。
请告诉我具体时间。
```

用户：

```
下周五下午三点。
```

Agent 继续执行。

这也是 Agent 与固定 Workflow 的重要区别。

------

# 28. Tool Architecture

Agent 不直接访问数据库。

采用：

```
Agent
  ↓
Tool Interface
  ↓
Executor
  ↓
Implementation
```

例如：

```
calendar.create_event
       ↓
CalendarExecutor
       ↓
PostgreSQL
```

以后可以替换为：

```
Microsoft Graph
Windows Calendar
```

而 Agent 无需修改。

------

# 29. Human-in-the-loop

Action Card 是整个系统的安全边界。

Agent 可以：

```
理解
检索
推理
规划
```

但不能直接执行：

```
CREATE
UPDATE
```

完整流程：

```
Agent
 ↓
Action Plan
 ↓
Action Card
 ↓
User Review
 ↓
User Confirm
 ↓
Executor
 ↓
Tool
```

------

# 30. Permission Boundary

| 操作         | 是否需要确认 |
| ------------ | ------------ |
| 读取截图     | 否           |
| 分析截图     | 否           |
| 查询 Memory  | 否           |
| 查询 Contact | 否           |
| 生成 Action  | 否           |
| 生成 Insight | 否           |
| 创建会议     | 是           |
| 创建联系人   | 是           |
| 更新联系人   | 是           |
| 删除联系人   | 不支持       |
| 发送消息     | 不支持       |

------

# 31. Action Card

示例：

```
┌──────────────────────────────┐
│ 创建会议                      │
├──────────────────────────────┤
│ 参与人：张三                  │
│ 时间：2026-10-09 15:00       │
│ 地点：Meeting Room 3          │
│                              │
│ 依据：                        │
│ • 当前聊天                    │
│ • Memory #m_102               │
│                              │
│ [编辑]             [确认执行] │
└──────────────────────────────┘
```

------

# 32. Action Schema

```
{
  "action_id": "a_001",
  "type": "CREATE_MEETING",
  "status": "DRAFT",
  "payload": {
    "title": "Project A Meeting",
    "contact_id": "c_001",
    "start": "2026-10-09T15:00:00",
    "end": "2026-10-09T16:00:00",
    "location": "Meeting Room 3"
  },
  "evidence": [
    "screenshot",
    "memory_102"
  ]
}
```

状态：

```
DRAFT
CONFIRMED
EXECUTING
SUCCESS
FAILED
CANCELLED
```

------

# 33. Tool Execution

Tool：

```
calendar.create_event
```

输入：

```
{
  "title": "Project A Meeting",
  "start": "2026-10-09T15:00:00",
  "end": "2026-10-09T16:00:00",
  "location": "Meeting Room 3",
  "contact_ids": ["c_001"]
}
```

返回：

```
{
  "success": true,
  "tool": "calendar.create_event",
  "resource_id": "event_123",
  "message": "Event created successfully"
}
```

------

# 34. Verified Memory

Tool 成功：

```
Tool Success
    ↓
Persist Memory
```

例如：

```
{
  "type": "meeting",
  "source": "tool_verified",
  "confidence": 1.0,
  "content": "已创建与张三的会议",
  "event_id": "event_123"
}
```

Tool 失败：

```
Tool Failure
    ↓
不得创建 Verified Memory
```

------

# 35. Memory Conflict

例如：

旧邮箱：

```
old@gmail.com
```

新邮箱：

```
new@gmail.com
```

不删除旧记录，而是：

```
old@gmail.com
status = historical

new@gmail.com
status = active
verified = true
```

可以进一步记录：

```
valid_from
valid_to
```

------

# 36. Evidence-grounded Insight

Agent 可以基于 Memory 给出简单的事实性建议。

例如：

```
你最近一次与张三的会议地点是 Meeting Room 3。
```

内部结构：

```
{
  "claim": "你和张三最近一次会议在 Meeting Room 3。",
  "evidence": [
    "memory_102"
  ]
}
```

没有可靠证据：

```
暂无可靠依据。
```

禁止生成没有 Memory 支撑的心理或社交推断。

------

# 37. Multimodal Understanding

截图不是简单 OCR。

Agent 需要理解：

```
人物
角色
上下文
相对时间
代词
历史引用
行动意图
```

例如：

```
A：周五有空吗？
B：下午三点可以。
A：还是上次那个地方？
B：可以。
B：对了，我换邮箱了。
```

Agent 应理解：

```
Meeting
    ↓
Friday 15:00
    ↓
Location = Previous Meeting Location
    ↓
Need Memory Retrieval

Contact Update
    ↓
Email
```

------

# 38. 技术架构

```
┌──────────────────────────────────────┐
│            Next.js Web               │
│       React + TypeScript             │
└──────────────────┬───────────────────┘
                   │
                   ↓
┌──────────────────────────────────────┐
│            Agent Runtime             │
│             LangGraph.js             │
│                                      │
│  LLM Decision / Tool Calling         │
│  State Management / Loop             │
└───────────────┬──────────────────────┘
                │
       ┌────────┼───────────┐
       ↓        ↓           ↓
    DeepSeek  Memory       Tools
      API       RAG
                │
        ┌───────┼────────┐
        ↓       ↓        ↓
       SQL     BM25   Embedding
        │                │
        └───────┬────────┘
                ↓
            PostgreSQL
             + pgvector
```

------

# 39. 技术选型

| 模块            | 技术                                       |
| --------------- | ------------------------------------------ |
| Frontend        | Next.js                                    |
| Language        | TypeScript                                 |
| UI              | Tailwind CSS                               |
| Agent           | LangGraph.js                               |
| LLM             | DeepSeek API                               |
| Validation      | Zod                                        |
| ORM             | Prisma                                     |
| Database        | PostgreSQL                                 |
| Vector          | pgvector                                   |
| Keyword Search  | PostgreSQL FTS / BM25-compatible retrieval |
| Reranker        | Provider abstraction                       |
| Unit Test       | Vitest                                     |
| E2E             | Playwright                                 |
| Environment     | WSL2                                       |
| Infrastructure  | Docker Compose                             |
| Version Control | Git                                        |

------

# 40. Embedding Provider

Embedding 不和 Agent 逻辑绑定。

设计：

```
EmbeddingProvider
```

接口：

```
interface EmbeddingProvider {
  embed(text: string): Promise<number[]>;
  embedBatch(texts: string[]): Promise<number[][]>;
}
```

以后可以替换：

```
OpenAI embedding
BGE
Qwen embedding
其他 embedding API
```

Agent 不需要修改。

------

# 41. RAG 数据流

Memory 写入：

```
New Memory
    ↓
Normalize
    ↓
Generate Search Text
    ↓
Embedding
    ↓
PostgreSQL
    ↓
pgvector
```

查询：

```
User Query
    ↓
Query Embedding
    ↓
┌──────────────┐
│ BM25 Search  │
│ Vector Search│
└──────┬───────┘
       ↓
Merge
       ↓
Rerank
       ↓
Top-K
       ↓
Agent
```

------

# 42. 数据模型

核心 Entity：

```
Contact
Memory
Meeting
Action
Execution
```

关系：

```
Contact
   │
   ├── Memory
   │
   ├── Meeting
   │
   └── Action
```

------

# 43. Contact Schema

```
contacts

id
name
organization
role
created_at
updated_at
```

Email：

```
contact_emails

id
contact_id
email
verified
active
source
created_at
```

Phone：

```
contact_phones

id
contact_id
phone
verified
active
source
created_at
```

------

# 44. Memory Schema

```
memories

id
type
contact_id
content
timestamp
source
confidence
embedding
metadata
created_at
```

Type：

```
meeting
contact_update
action
fact
```

------

# 45. Action Schema

```
actions

id
type
status
payload
source
created_at
updated_at
```

------

# 46. Execution Schema

```
executions

id
action_id
tool_name
request
response
status
created_at
```

用于记录：

```
Action
 ↓
Tool
 ↓
Result
```

------

# 47. Agent State

```
type AgentState = {
  input: UserInput;

  messages: Message[];

  understanding: Understanding | null;

  resolvedContacts: Contact[];

  retrievedMemories: Memory[];

  currentGoal: string | null;

  actionPlan: ActionPlan | null;

  actionCard: ActionCard | null;

  executionResult: ExecutionResult | null;

  verifiedMemories: Memory[];

  status:
    | "THINKING"
    | "WAITING_USER"
    | "WAITING_CONFIRMATION"
    | "EXECUTING"
    | "COMPLETED"
    | "FAILED";
};
```

------

# 48. Agent Loop

伪代码：

```
while (!finished) {

  decision = await agent.decide(state);

  switch (decision.type) {

    case "SEARCH_CONTACT":
      result = await contactSearch(decision.query);
      state = update(state, result);
      break;

    case "SEARCH_MEMORY":
      result = await memorySearch(decision.query);
      state = update(state, result);
      break;

    case "ASK_USER":
      return waitForUser(decision.question);

    case "CREATE_ACTION":
      return createActionCard(decision.action);

    case "CALL_TOOL":
      return executeTool(decision.tool);

    case "FINISH":
      return finish(state);
  }
}
```

实际执行时，Tool Executor 和 Confirmation Guard 必须位于 Agent 之外。

------

# 49. Safety Guard

关键安全检查不能依赖 LLM。

例如：

```
if (action.status !== "CONFIRMED") {
  throw new Error("Action requires user confirmation");
}
```

也就是说：

```
LLM
 ↓
Agent Decision
 ↓
Deterministic Guard
 ↓
Executor
 ↓
Tool
```

而不是：

```
LLM
 ↓
直接执行数据库操作
```

------

# 50. 错误处理

## LLM 错误

```
Retry
 ↓
仍失败
 ↓
提示用户稍后重试
```

------

## Structured Output 错误

使用：

```
Zod Validation
```

失败后重新生成。

------

## Contact 歧义

例如两个张三：

```
张三 - XX公司
张三 - YY大学
```

Agent：

```
Ask User
```

不能自行选择。

------

## 时间缺失

例如：

```
周五见。
```

如果无法确定具体时间：

```
Ask User
```

不能猜。

------

## Memory 不存在

返回：

```
没有找到可靠的历史记录。
```

不能让模型凭空补全。

------

# 51. 安全与隐私

聊天截图可能包含敏感个人信息。

MVP：

- 不做多用户；
- 不做公开分享；
- API Key 只放后端；
- 前端不得暴露 API Key；
- 日志不记录完整截图；
- 日志不记录完整联系人信息；
- 不保存 Chain-of-Thought；
- Memory 必须记录来源；
- 外部写操作必须确认。

------

# 52. Observability

每次 Agent Run 至少记录：

```
run_id
model
latency
tool_calls
retrieval_count
retrieval_latency
action_type
tool_status
final_status
```

例如：

```
Run: run_001

LLM: 1.8s
Memory Search: 0.3s
Contact Search: 0.1s
Planning: 1.0s
Tool: 0.2s

Total: 3.4s
```

------

# 53. Evaluation

MVP 必须包含独立 Evaluation。

至少准备：

```
70 Cases
```

------

## 53.1 Screenshot Understanding

20 cases：

- CREATE_MEETING
- CREATE_CONTACT
- UPDATE_CONTACT
- 多人聊天
- 相对时间
- 缺失时间
- 历史引用
- 多联系人

指标：

```
Intent Accuracy
Entity Extraction Accuracy
Time Extraction Accuracy
```

------

## 53.2 Contact Resolution

15 cases：

- 唯一匹配；
- 无匹配；
- 同名联系人；
- Email 匹配；
- Phone 匹配。

指标：

```
Resolution Accuracy
Ambiguity Detection Accuracy
```

------

## 53.3 Memory Retrieval

20 cases：

- 最近会议；
- 历史地点；
- 联系方式；
- 联系人信息；
- 模糊自然语言查询；
- 相对引用。

指标：

```
Recall@5
MRR@5
```

同时比较：

```
BM25
Embedding
Hybrid
```

从而验证 Hybrid RAG 是否真的有效。

------

## 53.4 Tool Safety

15 cases：

- 未确认执行；
- Confirm 后执行；
- Tool Success；
- Tool Failure；
- Failure 后 Memory；
- Success 后 Memory。

核心指标：

```
Unauthorized Execution Rate
```

目标：

```
0%
```

------

# 54. Memory Evaluation

指标：

```
Verified Memory Precision
```

目标：

```
100%
```

含义：

> 所有 VERIFIED Memory 都必须来源于用户确认后的成功 Tool Execution 或明确的用户确认。

------

# 55. RAG Evaluation

必须单独比较：

```
BM25
Embedding
Hybrid
```

例如：

```
                 Recall@5    MRR@5

BM25               0.72       0.65
Embedding          0.78       0.71
Hybrid             0.86       0.82
```

以上数字只是示例，实际结果必须通过实验得到。

这样项目中“Hybrid RAG”就不是为了堆技术，而是有 Evaluation 支撑。

------

# 56. 开发任务拆解

整个项目按照：

```
Task → Implementation → Gate
```

推进。

------

# 57. MVP 最终验收

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

------

# 58. 项目范围控制

## 原则 1：Agent 必须真正拥有决策权

不要做成：

```
固定 DAG
```

而是：

```
Agent
 ↓
Decision
 ↓
Tool
 ↓
Observation
 ↓
Next Decision
```

------

## 原则 2：RAG 必须是真正的 Hybrid RAG

不要只做：

```
Vector DB
```

而是：

```
Structured Retrieval
+
BM25
+
Embedding
+
Reranking
```

并通过 Evaluation 比较：

```
BM25 vs Embedding vs Hybrid
```

------

## 原则 3：Memory 不是简单数据库

Memory 必须具备：

```
Source
Confidence
Lifecycle
Timestamp
Entity
Embedding
```

------

## 原则 4：Agent 不直接写数据库

必须：

```
Agent
 ↓
Action
 ↓
Human Confirmation
 ↓
Guard
 ↓
Executor
 ↓
Tool
```

------

## 原则 5：不要过早接 Windows 原生 API

第一阶段：

```
Internal Tool
```

第二阶段：

```
Microsoft Graph / Windows Adapter
```

Agent Core 不变。

------

## 原则 6：不要扩张成万能助手

MVP 只解决：

```
聊天信息
    ↓
个人事务
```

只支持：

```
CREATE_MEETING
CREATE_CONTACT
UPDATE_CONTACT
```

------

# 59. 后续演进

## Phase 2

增加：

```
Microsoft Graph
Windows Calendar
Windows Contacts
```

------

## Phase 3

增加：

```
Semantic Memory
Memory Reranking
更复杂的 Evidence
```

------

## Phase 4

增加：

```
Email
Teams
更多 Productivity Tools
```

------

## Phase 5

如果产品价值验证成立，再考虑：

```
Next.js Web
      ↓
React Native for Windows
```

Agent Backend 不需要改变。

------

# 60. 项目最终定位

ActionMind 不定位为：

> “一个能够和用户聊天的 AI。”

而定位为：

> **一个能够从非结构化社交信息中理解上下文、主动检索长期记忆、动态规划下一步行动，并在用户确认后调用工具执行事务的 Context-Aware Personal Action Agent。**

核心技术：

```
Multimodal LLM
        +
Agent Loop
        +
LangGraph
        +
Hybrid RAG
        +
BM25
        +
Embedding
        +
Personal Memory
        +
Entity Resolution
        +
Planning
        +
Tool Calling
        +
Human-in-the-loop
        +
Verified Memory
        +
Evidence-grounded Reasoning
```

最终形成：

```
                  ┌──────────────┐
                  │ User Input   │
                  └──────┬───────┘
                         ↓
                  ┌──────────────┐
                  │    Agent     │
                  │              │
                  │ Decide Next  │
                  │    Action    │
                  └──────┬───────┘
                         │
          ┌──────────────┼──────────────┐
          ↓              ↓              ↓
    Contact Search   Hybrid RAG     Ask User
          │              │
          │       ┌──────┴──────┐
          │       ↓             ↓
          │     BM25       Embedding
          │       └──────┬──────┘
          │              ↓
          │          Reranker
          │              ↓
          └──────────→ Agent
                         ↓
                    Action Plan
                         ↓
                    Action Card
                         ↓
                  Human Confirm
                         ↓
                    Tool Calling
                         ↓
                    Tool Result
                         ↓
                Verified Memory
                         ↓
                  Future RAG
                         ↓
                       Agent
```

**ActionMind 的核心不是“把几个 LLM API 串起来”，而是让 Agent 在 `Memory → Decision → Tool → Observation → Decision` 的循环中自主推进任务，同时通过 `Human Confirmation + Deterministic Guard` 控制真实世界的状态变更。**