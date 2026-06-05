import { v4 as uuid } from "uuid";
import type { ApprovalRequest, RiskLevel } from "./types.js";
import type OpenAI from "openai";
import { logger } from "../utils/logger.js";

// 内存存储审批请求
const approvals = new Map<string, ApprovalRequest>();

/**
 * 创建审批请求
 */
export function createApproval(
  traceId: string,
  sessionId: string,
  toolName: string,
  riskLevel: RiskLevel,
  arguments_: any,
  message: string,
  assistantMessage: OpenAI.Chat.Completions.ChatCompletionMessageParam,
  toolCallId: string
): ApprovalRequest {
  const approvalId = `approval-${uuid().slice(0, 8)}`;
  const request: ApprovalRequest = {
    approvalId,
    traceId,
    sessionId,
    toolName,
    riskLevel,
    arguments: arguments_,
    message,
    assistantMessage,
    toolCallId,
    status: "pending",
    createdAt: new Date().toISOString(),
  };
  approvals.set(approvalId, request);
  logger.info(`[Approval] 创建审批: ${approvalId} (${toolName})`);
  return request;
}

/**
 * 处理审批结果
 */
export function resolveApproval(
  approvalId: string,
  approved: boolean
): ApprovalRequest | null {
  const request = approvals.get(approvalId);
  if (!request) {
    logger.warn(`[Approval] 审批不存在: ${approvalId}`);
    return null;
  }
  if (request.status !== "pending") {
    logger.warn(`[Approval] 审批已处理: ${approvalId} (${request.status})`);
    return request;
  }

  request.status = approved ? "approved" : "rejected";
  request.resolvedAt = new Date().toISOString();
  logger.info(
    `[Approval] 审批结果: ${approvalId} -> ${request.status}`
  );
  return request;
}

/**
 * 获取审批请求
 */
export function getApproval(approvalId: string): ApprovalRequest | null {
  return approvals.get(approvalId) || null;
}
