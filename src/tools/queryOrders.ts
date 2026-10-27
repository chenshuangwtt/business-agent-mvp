import { z } from "zod";
import { createDataset } from "../business/datasetStore.js";
import type { AgentTool, ToolContext } from "../agent/types.js";

const DateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "日期格式必须为 YYYY-MM-DD");
const InputSchema = z.object({
  start_date: DateSchema.describe("开始日期，格式 YYYY-MM-DD"),
  end_date: DateSchema.describe("结束日期，格式 YYYY-MM-DD"),
  status: z.enum(["all", "paid", "refunded", "cancelled"]).default("all").describe("保留字段；支付与退款以独立事件表计算"),
  channel: z.string().default("all"),
  region: z.string().default("all"),
  product_id: z.string().optional(),
});

export const queryOrdersTool: AgentTool = {
  name: "query_orders",
  description: "在服务端创建订单分析数据集，返回 dataset_id、记录数和查询范围，不返回原始订单明细。",
  riskLevel: "low",
  requiresApproval: false,
  inputSchema: InputSchema,
  execute: async (args, context: ToolContext) => {
    const { start_date, end_date, status: _status, ...filters } = InputSchema.parse(args);
    if (start_date > end_date) throw Object.assign(new Error("开始日期不能晚于结束日期"), { code: "INVALID_ARGS" });
    context.logger(`创建数据集: ${start_date} ~ ${end_date}`);
    return createDataset({ start_date, end_date, ...filters });
  },
};
