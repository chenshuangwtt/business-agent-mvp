# Business Agent MVP — 架构与数据流

## 项目结构

```
business-agent-mvp/
├── src/
│   ├── index.ts                    # 入口：启动服务 + 初始化工具注册表 + 会话清理
│   ├── server.ts                   # Express API 路由
│   ├── agent/
│   │   ├── types.ts                # 所有类型定义
│   │   ├── agentLoop.ts            # 核心：runAgent / resumeAgent / agentLoopCore
│   │   ├── toolRegistry.ts         # 工具注册表（7 个工具）
│   │   ├── riskPolicy.ts           # 风险等级判断（critical 直接拒绝）
│   │   ├── approvalStore.ts        # 审批请求存储（内存 Map）
│   │   └── sessionStore.ts         # 会话管理（内存 Map + 30min TTL）
│   ├── tools/
│   │   ├── queryOrders.ts          # 订单查询（读 CSV）
│   │   ├── calculateMetrics.ts     # 指标计算（确定性代码）
│   │   ├── findAnomalies.ts        # 异常识别（规则匹配）
│   │   ├── searchBusinessRules.ts  # 业务规则检索（RAG）
│   │   ├── generateReport.ts       # 报告生成（LLM + 模板 fallback）
│   │   ├── exportReport.ts         # 导出报告（需审批）
│   │   └── sendReportEmail.ts      # 发送邮件（需审批，模拟）
│   ├── rag/
│   │   ├── documentLoader.ts       # Markdown 文档加载 + 切片
│   │   ├── simpleRetriever.ts      # 关键词匹配检索
│   │   └── retriever.ts            # RAG 检索入口
│   ├── trace/
│   │   └── traceRecorder.ts        # Trace 写入 / 读取
│   ├── llm/
│   │   └── llmClient.ts            # LLM 客户端配置
│   └── utils/
│       ├── csv.ts                  # CSV 读取
│       ├── logger.ts               # 日志
│       ├── timeout.ts              # withTimeout / withRetry
│       └── concurrency.ts          # Semaphore 信号量
├── data/
│   ├── orders.csv                  # 200 条订单（含异常数据）
│   ├── products.csv                # 10 条商品
│   ├── customers.csv               # 50 条客户
│   ├── business_rules.md           # 业务规则（指标口径、异常判断）
│   ├── company_policy.md           # 操作权限策略
│   └── report_template.md          # 报告模板
├── prompts/
│   ├── system-prompt.md            # Agent 系统提示词
│   └── report-prompt.md            # 报告生成提示词
├── logs/                           # Trace 日志（按 traceId 分目录）
├── reports/                        # 导出的报告文件
└── frontend/                       # Vue3 前端
```

---

## API 端点

| 方法 | 路径 | 用途 |
|------|------|------|
| POST | `/api/chat` | 用户消息入口 |
| POST | `/api/approve` | 审批通过/拒绝 |
| GET | `/api/tools` | 工具列表 |
| GET | `/api/sessions` | 会话列表 |
| GET | `/api/traces` | Trace 列表 |
| GET | `/api/traces/:traceId` | 单个 Trace 详情 |
| GET | `/api/health` | 健康检查 |

---

## 核心数据流

### 1. 用户发送消息

```
POST /api/chat { message, sessionId? }
       │
       ▼
   server.ts
       │
       ▼
   runAgent(message, sessionId)
```

### 2. runAgent（agentLoop.ts）

```
runAgent(message, sessionId?)
  │
  ├─ getOrCreateSession(sessionId)          ← sessionStore.ts
  │   已有 → 复用 session.messages（包含历史对话）
  │   没有 → 创建新会话，messages = []
  │
  ├─ createTrace()                          ← traceRecorder.ts
  │   生成 trace-{uuid}，写入 logs/{traceId}/trace.json
  │
  ├─ 首次对话：加载 system-prompt.md → session.messages[0]
  │
  ├─ session.messages.push({ role: "user", content: message })
  │
  ├─ trimMessagesIfNeeded(session)          ← 超过 50 条消息时截断
  │
  ├─ getToolsForLLM()                       ← toolRegistry.ts
  │   返回 7 个工具的 function calling 格式
  │
  ├─ 检查 LLM 是否可用
  │   不可用 → handleFallback()
  │
  └─ agentLoopCore(session, trace, tools, model, client)
```

### 3. agentLoopCore（核心循环）

```
agentLoopCore(session, trace, tools, model, client)
  │
  │  ┌──────────────── 最多 MAX_TOOL_ROUNDS=6 轮 ────────────────┐
  │  │                                                            │
  │  ▼                                                            │
  │  client.chat.completions.create({ model, messages, tools })   │
  │  │                                                            │
  │  ├─ finish_reason="stop" 或无 tool_calls                      │
  │  │  → addTraceStep("final_answer")                            │
  │  │  → return { status: "success", answer }                    │
  │  │                                                            │
  │  └─ tool_calls: [A, B, C, ...]                                │
  │     │                                                         │
  │     ▼                                                         │
  │     预检查（同步，逐个）                                        │
  │     ├─ JSON.parse(arguments)                                  │
  │     ├─ getTool(name) → 查工具是否存在                           │
  │     ├─ checkPermission(riskLevel)                             │
  │     │   critical → 拒绝，推入 error 消息                       │
  │     └─ requiresApproval?                                      │
  │         true  → createApproval() → return need_approval       │
  │         false → 加入 validCalls 队列                           │
  │                                                             │
  │     并发执行 validCalls                                        │
  │     ├─ 1 个工具 → 直接串行                                     │
  │     └─ 多个工具 → parallelWithLimit(tasks, maxConcurrent=3)   │
  │                                                             │
  │     每个工具调用：                                              │
  │     execToolWithTrace(toolName, tool, args, trace, concurrent)│
  │     │                                                        │
  │     │  ├─ addTraceStep("tool_call", { toolName, args })      │
  │     │  │                                                     │
  │     │  ├─ withRetry(                                         │
  │     │  │    withTimeout(                                     │
  │     │  │      tool.execute(args, toolContext)                 │
  │     │  │    , TOOL_TIMEOUT_MS=10000)                         │
  │     │  │  , MAX_RETRY=2)                                     │
  │     │  │                                                     │
  │     │  ├─ 成功 → addTraceStep("tool_result", { duration })   │
  │     │  │        return JSON.stringify(result)                 │
  │     │  │                                                     │
  │     │  └─ 失败 → tryFallback(toolName)                       │
  │     │           search_business_rules → 返回空结果 + 标记     │
  │     │           其他工具 → 返回 error JSON                    │
  │     │                                                        │
  │     结果按原始顺序推入 session.messages                         │
  │     { role: "tool", tool_call_id, content: JSON }            │
  │                                                             │
  │     → 回到循环顶部，继续下一轮 LLM 调用                         │
  │  └────────────────────────────────────────────────────────────┘
  │
  └─ 超过 6 轮 → return { status: "error", code: "MAX_TOOL_ROUNDS" }
```

### 4. 审批流程

```
LLM 返回 tool_calls: [export_report]
       │
       │  tool.requiresApproval = true
       │
       ▼
createApproval(traceId, sessionId, toolName, riskLevel, args, assistantMessage, toolCallId)
       │
       │  保存到内存 Map
       │
       ▼
return { status: "need_approval", approvalId, toolName, riskLevel }
       │
       │  前端显示审批卡片
       │
       ▼
POST /api/approve { approvalId, approved: true/false }
       │
       ▼
resumeAgent(approvalId, approved)
       │
       ├─ 从 approval 恢复：sessionId, traceId, toolCallId, assistantMessage
       │
       ├─ 确保 assistantMessage 在 session.messages 中
       │
       ├─ approved=false:
       │   推入 { error: "用户拒绝", code: "USER_REJECTED" }
       │   → agentLoopCore 让 LLM 生成自然回复
       │
       └─ approved=true:
           execToolWithTrace(toolName, tool, args, trace)
           → 推入结果到 session.messages
           → agentLoopCore 让 LLM 基于结果继续推理
```

---

## 工具定义

| 工具名 | 中文名 | 风险 | 需审批 | 输入 | 输出 |
|--------|--------|------|--------|------|------|
| `query_orders` | 订单查询 | low | 否 | start_date, end_date, status, channel, region | orders[], count |
| `calculate_metrics` | 指标计算 | low | 否 | orders[] | gmv, net_sales, refund_rate, avg_order_value, sales_by_channel, sales_by_region, top_categories |
| `find_anomalies` | 异常发现 | low | 否 | orders[], metrics? | anomalies[] (type, severity, reason, evidence) |
| `search_business_rules` | 规则检索 | low | 否 | query, topK | results[] (content, source) |
| `generate_report` | 报告生成 | low | 否 | metrics, anomalies, rules[], template | content (Markdown), method, fallback? |
| `export_report` | 导出报告 | medium | 是 | filename, content | success, path, size |
| `send_report_email` | 发送邮件 | high | 是 | to, subject, content | simulated: true, message |

---

## RAG 检索流程

```
searchBusinessRules.execute({ query, topK })
  │
  ▼
retriever.retrieve(query, topK)
  │
  └─ simpleRetriever.retrieve(query, topK)
      │
      ├─ loadAndSplit("business_rules.md")    ← 按标题切分 + 超长二次切分
      ├─ loadAndSplit("company_policy.md")
      ├─ 提取中文短语和英文关键词
      ├─ 计算关键词重叠 + 中文字符匹配综合分
      ├─ 按相关性降序排序
      └─ 返回 topK chunks
```

## 稳定性治理

### 超时 withTimeout

```typescript
withTimeout(promise, ms = 10000, label)
// 超时抛出 TimeoutError { code: "TOOL_TIMEOUT" }
```

### 重试 withRetry

```typescript
withRetry(fn, maxRetry = 2, label)
// 不可重试：INVALID_ARGS, PERMISSION_DENIED, USER_REJECTED, ZodError
// 可重试：TOOL_TIMEOUT, TOOL_ERROR
// 指数退避：1s → 2s → 5s（上限）
```

### 降级

| 场景 | 降级策略 |
|------|----------|
| LLM 不可用 | handleFallback：query→metrics→anomaly→report |
| LLM 调用失败 | handleFallback：同上 |
| generate_report LLM 失败 | 读取 data/report_template.md 填充数据 |
| search_business_rules 失败 | 返回空结果 + fallback 标记 |
| demo 日期解析不确定 | 优先使用 `DEMO_DATA_START` 到 `DEMO_DATA_END` |

### 并发控制

```typescript
// Semaphore 信号量
const semaphore = new Semaphore(MAX_CONCURRENT_TOOLS = 3);
await semaphore.run(() => tool.execute(args));

// parallelWithLimit：结果按原始顺序排列
const results = await parallelWithLimit(tasks, 3);
```

---

## Trace 记录

每次请求生成 `trace-{uuid}`，保存到 `logs/{traceId}/trace.json`。

### 步骤类型

| type | 含义 | data 字段 |
|------|------|-----------|
| `user_message` | 用户输入 | content, sessionId |
| `llm_request` | LLM 调用前 | provider, model, messagesCount, toolsCount, round |
| `llm_response` | LLM 响应 | finishReason, hasToolCalls, contentPreview |
| `tool_decision` | 工具决策 | toolName, riskLevel, requiresApproval, batch?, toolCount? |
| `tool_call` | 工具执行开始 | toolName, riskLevel, arguments, concurrent? |
| `tool_result` | 工具执行成功 | toolName, duration, resultSummary, concurrent? |
| `tool_error` | 工具执行失败 | toolName?, code, message, duration? |
| `approval_required` | 需要审批 | approvalId, toolName, riskLevel |
| `approval_result` | 审批结果 | approvalId, approved, toolName |
| `fallback` | 降级处理 | reason 或 toolName + fallbackResult |
| `final_answer` | 最终回答 | content |

---

## 会话管理

```typescript
interface Session {
  sessionId: string;          // "session-{uuid}"
  messages: ChatMessage[];    // 完整对话历史
  createdAt: string;
  lastActivity: string;
  traceIds: string[];         // 关联的所有 trace
}
```

- 存储：内存 Map
- TTL：30 分钟（可通过 SESSION_TTL_MS 配置）
- 清理：每 5 分钟定时器自动删除过期会话
- 消息截断：超过 50 条时保留 system prompt + 最近 49 条

---

## 前端结构

```
frontend/src/
├── App.vue                   # 主布局：左侧面板 + 主对话区 + Trace 抽屉
├── components/
│   ├── ToolsList.vue         # 能力卡片列表（中文名 + 图标 + 说明）
│   ├── ChatPanel.vue         # 对话区：欢迎页 + 消息流 + 输入框
│   ├── ApprovalCard.vue      # 审批卡片（批准/拒绝）
│   └── TraceDrawer.vue       # 右侧 Trace 抽屉（时间线 + 耗时条）
├── composables/
│   ├── useApi.ts             # API 封装（loading/error 状态）
│   └── useTheme.ts           # 主题切换（localStorage 持久化）
├── types/
│   └── api.ts                # 前端类型定义
├── style.css                 # 设计系统（OKLCH 色板 + CSS 变量）
└── main.ts                   # 入口
```

---

## 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `LLM_PROVIDER` | `openai` | LLM provider 标签 |
| `LLM_API_KEY` | - | LLM API Key（不设置则 fallback 模式） |
| `LLM_BASE_URL` | `https://api.openai.com/v1` | OpenAI 兼容 API 地址 |
| `LLM_MODEL` | `gpt-4o-mini` | 模型名称 |
| `LLM_PROFILES` | - | 多模型 profile 顺序，如 `primary,backup,third` |
| `LLM_<PROFILE>_PROVIDER` | - | 指定 profile 的 provider 标签 |
| `LLM_<PROFILE>_API_KEY` | - | 指定 profile 的 API Key |
| `LLM_<PROFILE>_BASE_URL` | - | 指定 profile 的 API 地址 |
| `LLM_<PROFILE>_MODEL` | - | 指定 profile 的模型名称 |
| `PORT` | `3001` | 服务端口 |
| `HOST` | `0.0.0.0` | 监听地址 |
| `MAX_TOOL_ROUNDS` | `6` | 最大工具调用轮次 |
| `LLM_TIMEOUT_MS` | `30000` | LLM 调用超时（ms） |
| `TOOL_TIMEOUT_MS` | `10000` | 工具执行超时（ms） |
| `MAX_RETRY` | `2` | 最大重试次数 |
| `MAX_CONCURRENT_TOOLS` | `3` | 最大并发工具数 |
| `SESSION_TTL_MS` | `1800000` | 会话过期时间（ms） |
| `DEMO_DATA_START` | `2026-05-25` | demo 订单数据开始日期 |
| `DEMO_DATA_END` | `2026-06-03` | demo 订单数据结束日期 |
