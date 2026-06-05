import OpenAI from "openai";
import {
  createChatCompletionWithFallback,
  getAvailableLLMConfigs,
  loadSystemPrompt,
} from "../llm/llmClient.js";
import { getTool, getToolsForLLM } from "./toolRegistry.js";
import { checkPermission, getRiskLevelLabel } from "./riskPolicy.js";
import { createApproval, resolveApproval, getApproval } from "./approvalStore.js";
import { getOrCreateSession, getSession, trimMessagesIfNeeded } from "./sessionStore.js";
import { createTrace, addTraceStep, getTrace } from "../trace/traceRecorder.js";
import { withTimeout, withRetry } from "../utils/timeout.js";
import { parallelWithLimit } from "../utils/concurrency.js";
import { logger } from "../utils/logger.js";
import { cleanMarkdownOutput } from "../utils/markdown.js";
import type { AgentResponse, AgentErrorCode, Trace, ToolContext, Session } from "./types.js";

const MAX_TOOL_ROUNDS = parseInt(process.env.MAX_TOOL_ROUNDS || "6");
const LLM_TIMEOUT_MS = parseInt(process.env.LLM_TIMEOUT_MS || "30000");
const DEMO_DATA_START = process.env.DEMO_DATA_START || "2026-05-25";
const DEMO_DATA_END = process.env.DEMO_DATA_END || "2026-06-03";

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function getFallbackDateRange(): { start_date: string; end_date: string } {
  return {
    start_date: DEMO_DATA_START,
    end_date: DEMO_DATA_END,
  };
}

function buildRuntimeContext(): string {
  const today = formatDate(new Date());
  return [
    "## 运行时上下文",
    "",
    `- 当前日期：${today}`,
    `- 当前 demo 订单数据范围：${DEMO_DATA_START} 到 ${DEMO_DATA_END}`,
    "- 用户说“本周”“最近”“本月”等相对时间时，必须优先落在当前 demo 数据范围内。",
    "- 如果一次 `query_orders` 返回 `count=0`，不要连续猜测更早月份；应改用当前 demo 数据范围，或向用户说明所选日期没有数据。",
    "- demo 数据只覆盖订单分析场景，不要编造该范围之外的订单数据。",
  ].join("\n");
}

/**
 * Agent Loop 主入口
 */
export async function runAgent(
  userMessage: string,
  sessionId?: string
): Promise<AgentResponse> {
  // 1. 获取或创建会话
  const session = getOrCreateSession(sessionId);

  // 2. 创建 trace
  const trace = createTrace();
  session.traceIds.push(trace.traceId);
  addTraceStep(trace, "user_message", { content: userMessage, sessionId: session.sessionId });

  logger.info(`[Agent] 开始处理: traceId=${trace.traceId}, sessionId=${session.sessionId}`);

  // 3. 初始化会话消息
  if (session.messages.length === 0) {
    const systemPrompt = loadSystemPrompt();
    session.messages.push({ role: "system", content: systemPrompt });
    session.messages.push({ role: "system", content: buildRuntimeContext() });
  }
  session.messages.push({ role: "user", content: userMessage });

  // 4. 修剪消息防止超长
  trimMessagesIfNeeded(session);

  // 5. 获取工具定义
  const tools = getToolsForLLM();

  // 6. 检查 LLM 是否可用
  const llmConfigs = getAvailableLLMConfigs();
  if (llmConfigs.length === 0) {
    logger.warn("[Agent] LLM 不可用，使用 fallback 处理");
    return handleFallback(trace, userMessage, session);
  }

  // 7. 进入核心循环
  return agentLoopCore(session, trace, tools);
}

/**
 * 核心 Agent Loop — 供 runAgent 和 resumeAgent 共用
 */
async function agentLoopCore(
  session: Session,
  trace: Trace,
  tools: any[]
): Promise<AgentResponse> {
  const messages = session.messages;

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    logger.info(`[Agent] 第 ${round + 1} 轮, sessionId=${session.sessionId}`);
    const llmConfigs = getAvailableLLMConfigs();

    if (llmConfigs.length === 0) {
      logger.warn("[Agent] LLM 不可用，使用 fallback 处理");
      return handleFallback(trace, "", session);
    }

    // 记录 LLM 请求
    addTraceStep(trace, "llm_request", {
      profile: llmConfigs[0].profile,
      provider: llmConfigs[0].provider,
      model: llmConfigs[0].model,
      fallbackProfiles: llmConfigs.slice(1).map((config) => config.profile),
      messagesCount: messages.length,
      toolsCount: tools.length,
      round: round + 1,
      timeoutMs: LLM_TIMEOUT_MS,
    });

    // 调用 LLM
    let response: OpenAI.Chat.Completions.ChatCompletion;
    let usedConfig = llmConfigs[0];
    let attempts: any[] = [];
    const llmStart = Date.now();
    try {
      const result = await createChatCompletionWithFallback(
        {
          messages,
          tools: tools.length > 0 ? tools : undefined,
          tool_choice: tools.length > 0 ? "auto" : undefined,
        },
        { timeoutMs: LLM_TIMEOUT_MS, label: `round-${round + 1}` }
      );
      response = result.response;
      usedConfig = result.config;
      attempts = result.attempts;
    } catch (err: any) {
      const duration = Date.now() - llmStart;
      const code: AgentErrorCode = err.code === "LLM_TIMEOUT" ? "LLM_TIMEOUT" : "LLM_ERROR";
      const message = code === "LLM_TIMEOUT" ? `LLM 调用超时 (${LLM_TIMEOUT_MS}ms)` : err.message;

      logger.error(`[LLM] 调用失败: ${message}, duration=${duration}ms`);
      addTraceStep(trace, "tool_error", {
        code,
        message,
        duration,
        round: round + 1,
        attempts: err.attempts || [],
      });
      return handleFallback(trace, "", session);
    }

    const choice = response.choices[0];
    if (!choice) {
      addTraceStep(trace, "tool_error", {
        code: "LLM_ERROR",
        message: "LLM 返回空响应",
      });
      return handleFallback(trace, "", session);
    }

    const assistantMessage = choice.message;
    messages.push(assistantMessage);

    // 记录 LLM 响应
    addTraceStep(trace, "llm_response", {
      finishReason: choice.finish_reason,
      hasToolCalls: !!assistantMessage.tool_calls?.length,
      contentPreview: assistantMessage.content?.slice(0, 200),
      profile: usedConfig.profile,
      provider: usedConfig.provider,
      model: usedConfig.model,
      attempts,
      duration: Date.now() - llmStart,
    });

    // 如果是最终回答
    if (choice.finish_reason === "stop" || !assistantMessage.tool_calls?.length) {
      const answer = cleanMarkdownOutput(assistantMessage.content || "无法生成回答");
      addTraceStep(trace, "final_answer", { content: answer });
      logger.info(`[Agent] 完成: traceId=${trace.traceId}`);
      return {
        status: "success",
        traceId: trace.traceId,
        sessionId: session.sessionId,
        answer,
      };
    }

    // 处理工具调用（预检查 → 分类 → 并发执行）
    const toolCalls = assistantMessage.tool_calls;
    const concurrent = toolCalls.length > 1;

    if (concurrent) {
      addTraceStep(trace, "tool_decision", {
        batch: true,
        toolCount: toolCalls.length,
        message: `收到 ${toolCalls.length} 个工具调用，尝试并发执行`,
      });
    }

    // 第一步：同步预检查所有工具调用
    type ValidatedCall = {
      toolCallId: string;
      toolName: string;
      tool: any;
      args: any;
    };

    const validCalls: ValidatedCall[] = [];

    for (const toolCall of toolCalls) {
      const { id: toolCallId, function: func } = toolCall;
      const toolName = func.name;

      // 解析参数
      let args: any;
      try {
        args = JSON.parse(func.arguments);
      } catch {
        const errorMsg = `工具参数解析失败: ${toolName}`;
        addTraceStep(trace, "tool_error", { toolName, code: "INVALID_ARGS", message: errorMsg });
        messages.push({
          role: "tool",
          tool_call_id: toolCallId,
          content: JSON.stringify({ error: errorMsg, code: "INVALID_ARGS" }),
        });
        continue;
      }

      // 查找工具
      const tool = getTool(toolName);
      if (!tool) {
        const errorMsg = `工具不存在: ${toolName}`;
        addTraceStep(trace, "tool_error", { toolName, code: "INVALID_TOOL", message: errorMsg });
        messages.push({
          role: "tool",
          tool_call_id: toolCallId,
          content: JSON.stringify({ error: errorMsg, code: "INVALID_TOOL" }),
        });
        continue;
      }

      let parsedArgs: any;
      try {
        parsedArgs = tool.inputSchema.parse(args);
      } catch (err: any) {
        const errorMsg = `工具参数校验失败: ${formatSchemaError(err)}`;
        addTraceStep(trace, "tool_error", { toolName, code: "INVALID_ARGS", message: errorMsg });
        messages.push({
          role: "tool",
          tool_call_id: toolCallId,
          content: JSON.stringify({ error: errorMsg, code: "INVALID_ARGS" }),
        });
        continue;
      }

      // 权限检查
      const permission = checkPermission(tool.riskLevel);
      if (!permission.allowed) {
        const errorMsg = permission.reason || "权限不足";
        addTraceStep(trace, "tool_error", { toolName, code: "PERMISSION_DENIED", message: errorMsg });
        messages.push({
          role: "tool",
          tool_call_id: toolCallId,
          content: JSON.stringify({ error: errorMsg, code: "PERMISSION_DENIED" }),
        });
        continue;
      }

      // 审批检查：需要审批的工具立即暂停整个批次
      if (tool.requiresApproval) {
        const approvalMessage = `工具 "${toolName}" (${getRiskLevelLabel(tool.riskLevel)}) 需要用户确认后执行`;
        const approval = createApproval(
          trace.traceId,
          session.sessionId,
          toolName,
          tool.riskLevel,
          parsedArgs,
          approvalMessage,
          assistantMessage,
          toolCallId
        );

        addTraceStep(trace, "approval_required", {
          approvalId: approval.approvalId,
          toolName,
          riskLevel: tool.riskLevel,
        });

        logger.info(`[Agent] 需要审批: ${toolName}, approvalId=${approval.approvalId}`);

        return {
          status: "need_approval",
          traceId: trace.traceId,
          sessionId: session.sessionId,
          approvalId: approval.approvalId,
          toolName,
          riskLevel: tool.riskLevel,
          arguments: parsedArgs,
          message: approvalMessage,
        };
      }

      addTraceStep(trace, "tool_decision", {
        toolName,
        riskLevel: tool.riskLevel,
        requiresApproval: tool.requiresApproval,
        arguments: parsedArgs,
      });

      validCalls.push({ toolCallId, toolName, tool, args: parsedArgs });
    }

    // 第二步：并发执行所有通过预检查的工具
    if (validCalls.length > 0) {
      const maxConcurrent = parseInt(process.env.MAX_CONCURRENT_TOOLS || "3");

      if (concurrent && validCalls.length > 1) {
        logger.info(`[Agent] 并发执行 ${validCalls.length} 个工具, maxConcurrent=${maxConcurrent}`);
        addTraceStep(trace, "tool_call", {
          concurrent: true,
          toolNames: validCalls.map((c) => c.toolName),
          count: validCalls.length,
        });

        // 收集结果容器，按原始顺序
        const resultContainers: Array<{ role: "tool"; tool_call_id: string; content: string }> =
          new Array(validCalls.length);

        const tasks = validCalls.map((call, index) => async () => {
          const { toolCallId, toolName, tool, args } = call;
          const result = await execToolWithTrace(toolName, tool, args, trace, true);
          resultContainers[index] = { role: "tool", tool_call_id: toolCallId, content: result };
        });

        await parallelWithLimit(tasks, maxConcurrent);

        // 按顺序推入 messages
        for (const r of resultContainers) {
          if (r) messages.push(r);
        }
      } else {
        // 单个工具，直接串行执行
        for (const call of validCalls) {
          const result = await execToolWithTrace(
            call.toolName, call.tool, call.args, trace, false
          );
          messages.push({ role: "tool", tool_call_id: call.toolCallId, content: result });
        }
      }
    }
  }

  // 超过最大轮次
  addTraceStep(trace, "tool_error", {
    code: "MAX_TOOL_ROUNDS",
    message: `超过最大工具调用轮次 (${MAX_TOOL_ROUNDS})`,
  });

  return {
    status: "error",
    traceId: trace.traceId,
    sessionId: session.sessionId,
    code: "MAX_TOOL_ROUNDS",
    message: `超过最大工具调用轮次 (${MAX_TOOL_ROUNDS})`,
  };
}

/**
 * 执行单个工具，返回结果 JSON 字符串
 * 支持超时、重试、降级，记录 Trace
 */
export async function execToolWithTrace(
  toolName: string,
  tool: any,
  args: any,
  trace: Trace,
  concurrent: boolean
): Promise<string> {
  const toolContext: ToolContext = {
    traceId: trace.traceId,
    logger: (msg) => logger.info(`[Tool:${toolName}] ${msg}`),
  };

  addTraceStep(trace, "tool_call", {
    toolName,
    riskLevel: tool.riskLevel,
    arguments: args,
    concurrent,
  });

  const startTime = Date.now();

  try {
    const result: any = await withRetry(
      () => withTimeout(tool.execute(args, toolContext), undefined, toolName),
      undefined,
      toolName
    );

    const duration = Date.now() - startTime;
    addTraceStep(trace, "tool_result", {
      toolName,
      duration,
      resultSummary: summarizeResult(result),
      concurrent,
    });

    if (result?.fallback === true) {
      addTraceStep(trace, "fallback", {
        toolName,
        reason: getFallbackReason(toolName, result),
        resultSummary: summarizeResult(result),
      });
    }

    return JSON.stringify(result);
  } catch (err: any) {
    const duration = Date.now() - startTime;
    const errorCode: AgentErrorCode = err.code || "TOOL_ERROR";

    addTraceStep(trace, "tool_error", {
      toolName,
      code: errorCode,
      message: err.message,
      duration,
      concurrent,
    });

    // 尝试降级
    const fallbackResult = tryFallback(toolName, args, err);
    if (fallbackResult) {
      addTraceStep(trace, "fallback", {
        toolName,
        fallbackResult: summarizeResult(fallbackResult),
      });
      return JSON.stringify(fallbackResult);
    }

    return JSON.stringify({ error: err.message, code: errorCode });
  }
}

/**
 * 恢复 Agent Loop（审批通过后）
 */
export async function resumeAgent(
  approvalId: string,
  approved: boolean
): Promise<AgentResponse> {
  const approval = getApproval(approvalId);
  if (!approval) {
    return {
      status: "error",
      traceId: "",
      sessionId: "",
      code: "INVALID_ARGS",
      message: "审批请求不存在",
    };
  }

  // 获取 trace
  const trace = getTrace(approval.traceId);
  if (!trace) {
    return {
      status: "error",
      traceId: approval.traceId,
      sessionId: approval.sessionId,
      code: "TOOL_ERROR",
      message: "Trace 不存在",
    };
  }

  // 获取会话
  const session = getSession(approval.sessionId);
  if (!session) {
    return {
      status: "error",
      traceId: approval.traceId,
      sessionId: approval.sessionId,
      code: "TOOL_ERROR",
      message: "会话已过期，请重新发起请求",
    };
  }

  // 记录审批结果
  resolveApproval(approvalId, approved);
  addTraceStep(trace, "approval_result", {
    approvalId,
    approved,
    toolName: approval.toolName,
  });

  // 确保 assistantMessage（含 tool_calls）在会话消息中
  const hasAssistantMsg = session.messages.some(
    (m: any) =>
      m.role === "assistant" &&
      m.tool_calls?.some((tc: any) => tc.id === approval.toolCallId)
  );
  if (!hasAssistantMsg) {
    session.messages.push(approval.assistantMessage);
  }

  if (!approved) {
    // 用户拒绝：追加拒绝消息，让 LLM 生成自然回复
    session.messages.push({
      role: "tool",
      tool_call_id: approval.toolCallId,
      content: JSON.stringify({
        error: "用户拒绝了该操作",
        code: "USER_REJECTED",
      }),
    });

    // 重新进入 LLM 循环让模型生成回复
    if (getAvailableLLMConfigs().length > 0) {
      const tools = getToolsForLLM();
      return agentLoopCore(session, trace, tools);
    }

    const answer = "用户拒绝了操作，流程已终止。";
    addTraceStep(trace, "final_answer", { content: answer });
    return {
      status: "success",
      traceId: trace.traceId,
      sessionId: session.sessionId,
      answer,
    };
  }

  // 用户批准：执行工具
  const tool = getTool(approval.toolName);
  if (!tool) {
    return {
      status: "error",
      traceId: trace.traceId,
      sessionId: session.sessionId,
      code: "INVALID_TOOL",
      message: `工具不存在: ${approval.toolName}`,
    };
  }

  const resultJson = await execToolWithTrace(
    approval.toolName,
    tool,
    approval.arguments,
    trace,
    false
  );
  session.messages.push({
    role: "tool",
    tool_call_id: approval.toolCallId,
    content: resultJson,
  });

  // 重新进入 LLM 循环，让模型基于工具结果继续推理
  if (getAvailableLLMConfigs().length === 0) {
    // 无 LLM 时直接返回工具结果
    const answer = formatApprovalResult(approval.toolName, session.messages);
    addTraceStep(trace, "final_answer", { content: answer });
    return {
      status: "success",
      traceId: trace.traceId,
      sessionId: session.sessionId,
      answer,
    };
  }

  const tools = getToolsForLLM();
  return agentLoopCore(session, trace, tools);
}

/**
 * LLM 不可用时的 fallback 处理
 */
async function handleFallback(
  trace: Trace,
  userMessage: string,
  session: Session
): Promise<AgentResponse> {
  addTraceStep(trace, "fallback", {
    reason: "LLM 不可用，使用 fallback 模式",
  });

  try {
    const { queryOrdersTool } = await import("../tools/queryOrders.js");
    const { calculateMetricsTool } = await import("../tools/calculateMetrics.js");
    const { findAnomaliesTool } = await import("../tools/findAnomalies.js");
    const { generateReportTool } = await import("../tools/generateReport.js");

    const toolContext: ToolContext = {
      traceId: trace.traceId,
      logger: (msg) => logger.info(`[Fallback] ${msg}`),
    };

    const fallbackRange = getFallbackDateRange();
    const queryResult = await queryOrdersTool.execute(
      {
        start_date: fallbackRange.start_date,
        end_date: fallbackRange.end_date,
        status: "all",
        channel: "all",
        region: "all",
      },
      toolContext
    );

    const metrics = await calculateMetricsTool.execute(
      { orders: queryResult.orders },
      toolContext
    );

    const anomalyResult = await findAnomaliesTool.execute(
      { orders: queryResult.orders, metrics },
      toolContext
    );

    const report = await generateReportTool.execute(
      {
        metrics,
        anomalies: anomalyResult.anomalies,
        rules: [],
        template: "经营分析简报",
      },
      toolContext
    );

    addTraceStep(trace, "final_answer", { content: report.content });

    return {
      status: "success",
      traceId: trace.traceId,
      sessionId: session.sessionId,
      answer: report.content,
    };
  } catch (err: any) {
    const errorMsg = `Fallback 处理失败: ${err.message}`;
    addTraceStep(trace, "tool_error", {
      code: "FALLBACK_USED",
      message: errorMsg,
    });

    return {
      status: "error",
      traceId: trace.traceId,
      sessionId: session.sessionId,
      code: "LLM_ERROR",
      message: errorMsg,
    };
  }
}

/**
 * 尝试降级策略
 */
function tryFallback(toolName: string, args: any, error: any): any {
  if (toolName === "search_business_rules") {
    return {
      results: [],
      query: args.query || "",
      total: 0,
      fallback: true,
      error: "业务规则检索失败，本报告仅基于订单数据生成，规则解释可能不完整",
    };
  }
  return null;
}

function formatSchemaError(err: any): string {
  const issues = err?.issues;
  if (Array.isArray(issues) && issues.length > 0) {
    return issues
      .map((issue: any) => {
        const path = issue.path?.length ? issue.path.join(".") : "arguments";
        return `${path}: ${issue.message}`;
      })
      .join("; ");
  }
  return err?.message || "参数不合法";
}

function getFallbackReason(toolName: string, result: any): string {
  if (toolName === "generate_report") {
    return result.llmFailed
      ? "LLM 报告生成失败，使用本地模板生成报告"
      : "使用本地模板生成报告";
  }
  return result.fallbackReason || result.error || "工具使用 fallback 结果";
}

/**
 * 总结工具结果（用于 Trace）
 */
function summarizeResult(result: any): string {
  if (!result) return "null";
  if (typeof result === "string") return result.slice(0, 200);
  if (result.orders) return `${result.orders?.length || 0} 条订单`;
  if (result.anomalies) return `${result.anomalies?.length || 0} 个异常`;
  if (result.content) return `报告 (${result.content.length} 字)`;
  if (result.success) return "成功";
  return JSON.stringify(result).slice(0, 200);
}

/**
 * 格式化审批通过后的执行结果
 */
function formatApprovalResult(toolName: string, messages: any[]): string {
  // 从最后的 tool 消息中提取结果
  const lastToolMsg = [...messages].reverse().find((m: any) => m.role === "tool");
  if (lastToolMsg) {
    try {
      const result = JSON.parse(lastToolMsg.content);
      if (toolName === "export_report") {
        return `报告已成功导出。\n\n${result.message || ""}\n文件路径：${result.path || "unknown"}`;
      }
      if (toolName === "send_report_email") {
        return `${result.message || "邮件已模拟发送"}`;
      }
    } catch {}
  }
  return "操作已完成";
}
