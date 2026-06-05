# 公司操作权限策略

## 一、风险等级定义

### 1.1 Low（低风险）

- **定义**：只读操作，不影响系统状态和数据完整性
- **审批要求**：无需审批，可直接执行
- **监控要求**：记录 Trace 日志

### 1.2 Medium（中风险）

- **定义**：写入操作，影响非关键数据
- **审批要求**：需要用户确认后执行
- **监控要求**：记录 Trace 日志，记录审批结果

### 1.3 High（高风险）

- **定义**：对外操作，影响用户感知或业务状态
- **审批要求**：需要用户明确确认
- **监控要求**：记录 Trace 日志，记录审批结果，发送通知

### 1.4 Critical（极高风险）

- **定义**：破坏性操作，不可逆或影响核心数据
- **审批要求**：直接拒绝，不提供执行入口
- **监控要求**：记录拒绝日志

## 二、工具风险分类

### 2.1 低风险工具（无需审批）

| 工具名称 | 风险等级 | 说明 |
|---------|---------|------|
| `query_orders` | low | 查询订单数据，只读操作 |
| `calculate_metrics` | low | 计算指标，只读操作 |
| `find_anomalies` | low | 识别异常，只读操作 |
| `search_business_rules` | low | 检索业务规则，只读操作 |
| `generate_report` | low | 生成报告，内存操作 |

### 2.2 中风险工具（需要审批）

| 工具名称 | 风险等级 | 说明 |
|---------|---------|------|
| `export_report` | medium | 导出报告到本地文件，写入操作 |

### 2.3 高风险工具（需要审批）

| 工具名称 | 风险等级 | 说明 |
|---------|---------|------|
| `send_report_email` | high | 发送报告邮件，对外操作 |

### 2.4 极高风险工具（直接拒绝）

| 操作类型 | 风险等级 | 说明 |
|---------|---------|------|
| 删除数据 | critical | 不可逆操作 |
| 修改订单 | critical | 影响核心业务数据 |
| 执行任意 SQL | critical | 安全风险极高 |
| 修改用户权限 | critical | 影响系统安全 |

## 三、审批流程

### 3.1 审批触发条件

当工具的 `requiresApproval` 字段为 `true` 时，Agent Loop 会暂停执行，返回 `need_approval` 状态，等待用户确认。

### 3.2 审批请求格式

```json
{
  "status": "need_approval",
  "traceId": "trace-xxx",
  "approvalId": "approval-xxx",
  "toolName": "export_report",
  "riskLevel": "medium",
  "arguments": {},
  "message": "该操作需要用户确认"
}
```

### 3.3 审批响应格式

```json
{
  "approvalId": "approval-xxx",
  "approved": true
}
```

### 3.4 审批结果处理

- **approved = true**：继续执行工具，恢复 Agent Loop
- **approved = false**：取消执行，在 Trace 中记录 `UserRejected`

## 四、Critical 操作处理

对于 Critical 风险的操作，Agent 应：

1. **识别操作类型**：判断是否属于 Critical 操作
2. **直接拒绝**：不提供执行入口，返回明确的拒绝信息
3. **记录 Trace**：在 Trace 中记录拒绝原因
4. **提示用户**：告知用户该操作不支持

### 拒绝响应示例

```json
{
  "status": "error",
  "code": "PERMISSION_DENIED",
  "message": "该操作属于 Critical 风险，已拒绝执行"
}
```
