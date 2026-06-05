import type { AgentTool, ToolInfo } from "./types.js";
import { queryOrdersTool } from "../tools/queryOrders.js";
import { calculateMetricsTool } from "../tools/calculateMetrics.js";
import { findAnomaliesTool } from "../tools/findAnomalies.js";
import { searchBusinessRulesTool } from "../tools/searchBusinessRules.js";
import { generateReportTool } from "../tools/generateReport.js";
import { exportReportTool } from "../tools/exportReport.js";
import { sendReportEmailTool } from "../tools/sendReportEmail.js";
import { logger } from "../utils/logger.js";

// 工具注册表
const tools = new Map<string, AgentTool>();

/**
 * 注册工具
 */
export function registerTool(tool: AgentTool): void {
  if (tools.has(tool.name)) {
    logger.warn(`[ToolRegistry] 工具已存在，覆盖: ${tool.name}`);
  }
  tools.set(tool.name, tool);
  logger.info(`[ToolRegistry] 注册工具: ${tool.name} (${tool.riskLevel})`);
}

/**
 * 获取工具
 */
export function getTool(name: string): AgentTool | undefined {
  return tools.get(name);
}

/**
 * 获取所有工具
 */
export function getAllTools(): AgentTool[] {
  return Array.from(tools.values());
}

/**
 * 获取工具列表信息
 */
export function getToolInfos(): ToolInfo[] {
  return getAllTools().map((t) => ({
    name: t.name,
    description: t.description,
    riskLevel: t.riskLevel,
    requiresApproval: t.requiresApproval,
  }));
}

/**
 * 获取 OpenAI 格式的工具定义
 */
export function getToolsForLLM(): any[] {
  return getAllTools().map((t) => ({
    type: "function" as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: zodSchemaToJsonSchema(t.inputSchema),
    },
  }));
}

/**
 * 简单的 Zod Schema -> JSON Schema 转换
 * （仅支持本项目用到的类型）
 */
function zodSchemaToJsonSchema(schema: any): any {
  if (!schema?._def) return {};

  const def = schema._def;

  // ZodObject
  if (def.typeName === "ZodObject") {
    const shape = def.shape();
    const properties: any = {};
    const required: string[] = [];

    for (const [key, value] of Object.entries(shape)) {
      const field = value as any;
      properties[key] = zodFieldToJsonSchema(field);
      if (isRequiredField(field)) {
        required.push(key);
      }
    }

    return {
      type: "object",
      properties,
      required: required.length > 0 ? required : undefined,
    };
  }

  return {};
}

function isRequiredField(field: any): boolean {
  const typeName = field?._def?.typeName;
  return typeName !== "ZodOptional" && typeName !== "ZodDefault";
}

function zodFieldToJsonSchema(field: any): any {
  const def = field._def;
  if (!def) return {};

  // Unwrap optional
  if (def.typeName === "ZodOptional") {
    return zodFieldToJsonSchema(def.innerType);
  }

  // Unwrap default
  if (def.typeName === "ZodDefault") {
    const inner = zodFieldToJsonSchema(def.innerType);
    inner.default = def.defaultValue();
    return inner;
  }

  if (def.typeName === "ZodString") {
    return { type: "string", description: field.description };
  }
  if (def.typeName === "ZodNumber") {
    return { type: "number", description: field.description };
  }
  if (def.typeName === "ZodBoolean") {
    return { type: "boolean", description: field.description };
  }
  if (def.typeName === "ZodEnum") {
    return {
      type: "string",
      enum: def.values,
      description: field.description,
    };
  }
  if (def.typeName === "ZodArray") {
    return {
      type: "array",
      items: zodFieldToJsonSchema(def.type),
      description: field.description,
    };
  }

  return { description: field.description };
}

/**
 * 初始化：注册所有内置工具
 */
export function initToolRegistry(): void {
  registerTool(queryOrdersTool);
  registerTool(calculateMetricsTool);
  registerTool(findAnomaliesTool);
  registerTool(searchBusinessRulesTool);
  registerTool(generateReportTool);
  registerTool(exportReportTool);
  registerTool(sendReportEmailTool);
  logger.info(`[ToolRegistry] 初始化完成，共 ${tools.size} 个工具`);
}
