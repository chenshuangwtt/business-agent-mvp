import { z } from "zod";
import type OpenAI from "openai";
import type { ResolvedDateRange } from "../utils/timeMode.js";

// ========== 风险等级 ==========
export type RiskLevel = "low" | "medium" | "high" | "critical";

// ========== 错误码 ==========
export type AgentErrorCode =
  | "INVALID_TOOL"
  | "INVALID_ARGS"
  | "TOOL_TIMEOUT"
  | "TOOL_ERROR"
  | "PERMISSION_DENIED"
  | "APPROVAL_REQUIRED"
  | "USER_REJECTED"
  | "MAX_TOOL_ROUNDS"
  | "LLM_TIMEOUT"
  | "LLM_ERROR"
  | "FALLBACK_USED";

// ========== 工具上下文 ==========
export interface ToolContext {
  traceId: string;
  logger: (msg: string) => void;
}

// ========== 工具定义 ==========
export interface AgentTool {
  name: string;
  description: string;
  riskLevel: RiskLevel;
  requiresApproval: boolean;
  inputSchema: z.ZodSchema<any>;
  execute: (args: any, context: ToolContext) => Promise<any>;
}

// ========== Trace 步骤类型 ==========
export type TraceStepType =
  | "user_message"
  | "skill_selected"
  | "llm_request"
  | "llm_response"
  | "tool_decision"
  | "approval_required"
  | "approval_result"
  | "tool_call"
  | "tool_result"
  | "tool_error"
  | "fallback"
  | "final_answer";

// ========== Trace 步骤 ==========
export interface TraceStep {
  id: string;
  type: TraceStepType;
  timestamp: string;
  data: any;
}

// ========== Trace ==========
export interface Trace {
  traceId: string;
  steps: TraceStep[];
  createdAt: string;
  updatedAt: string;
}

// ========== 会话 ==========
export interface Session {
  sessionId: string;
  messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[];
  createdAt: string;
  lastActivity: string;
  traceIds: string[];
  activeSkill?: {
    name: string;
    tools: string[];
  };
  activeTimeRange?: ResolvedDateRange;
}

// ========== 审批请求 ==========
export interface ApprovalRequest {
  approvalId: string;
  traceId: string;
  sessionId: string;
  toolName: string;
  riskLevel: RiskLevel;
  arguments: any;
  message: string;
  assistantMessage: OpenAI.Chat.Completions.ChatCompletionMessageParam;
  toolCallId: string;
  status: "pending" | "approved" | "rejected";
  createdAt: string;
  resolvedAt?: string;
}

// ========== Agent 响应状态 ==========
export type AgentResponseStatus = "success" | "need_approval" | "error";

// ========== Agent 响应 ==========
export interface AgentResponse {
  status: AgentResponseStatus;
  traceId: string;
  sessionId: string;
  answer?: string;
  approvalId?: string;
  toolName?: string;
  riskLevel?: RiskLevel;
  arguments?: any;
  message?: string;
  code?: AgentErrorCode;
}

// ========== 订单数据 ==========
export interface Order {
  order_id: string;
  order_date: string;
  customer_id: string;
  product_id: string;
  category: string;
  quantity: number;
  unit_price: number;
  total_amount: number;
  status: "paid" | "refunded" | "cancelled";
  channel: string;
  region: string;
  refund_amount: number;
}

// ========== 经营指标 ==========
export interface Metrics {
  period?: {
    start_date: string;
    end_date: string;
    label: string;
  };
  gmv: number;
  net_sales: number;
  paid_orders: number;
  total_orders: number;
  refund_amount: number;
  refund_rate: number;
  avg_order_value: number;
  sales_by_channel: Record<string, number>;
  sales_by_region: Record<string, number>;
  top_categories: Array<{ category: string; sales: number; count: number }>;
}

// ========== 异常 ==========
export interface Anomaly {
  type: string;
  severity: "low" | "medium" | "high";
  reason: string;
  evidence: any;
}

// ========== 工具列表响应 ==========
export interface ToolInfo {
  name: string;
  description: string;
  riskLevel: RiskLevel;
  requiresApproval: boolean;
}
