import { z } from "zod";
import { retrieve } from "../rag/retriever.js";
import type { AgentTool, ToolContext } from "../agent/types.js";

const InputSchema = z.object({
  query: z.string().describe("检索关键词或问题"),
  topK: z.number().int().min(1).max(10).default(3).describe("返回片段数量"),
});

export const searchBusinessRulesTool: AgentTool = {
  name: "search_business_rules",
  description:
    "检索业务规则文档，返回与查询相关的规则片段和来源文件，用于获取指标口径、异常判断规则、权限策略等。",
  riskLevel: "low",
  requiresApproval: false,
  inputSchema: InputSchema,
  execute: async (args, context: ToolContext) => {
    const { query, topK } = InputSchema.parse(args);

    context.logger(`检索业务规则: "${query}", topK=${topK}`);

    try {
      const chunks = await retrieve(query, topK);
      return {
        results: chunks.map((c) => ({
          content: c.content,
          source: c.source,
        })),
        query,
        total: chunks.length,
      };
    } catch (err: any) {
      context.logger(`业务规则检索失败: ${err.message}`);
      return {
        results: [],
        query,
        total: 0,
        fallback: true,
        error: "业务规则检索失败，将使用默认规则",
      };
    }
  },
};
