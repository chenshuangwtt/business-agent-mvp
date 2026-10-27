import { z } from "zod";
import { getDataset } from "../business/datasetStore.js";
import { calculateMetricSnapshot } from "../business/metrics.js";
import type { AgentTool, ToolContext } from "../agent/types.js";

const InputSchema = z.object({ dataset_id: z.string().min(1).describe("query_orders 返回的数据集 ID") });

export const calculateMetricsTool: AgentTool = {
  name: "calculate_metrics",
  description: "按数据集统计创建订单、成功支付、成功退款、净现金流、客单价及渠道/地区/品类分布，金额单位为分。",
  riskLevel: "low",
  requiresApproval: false,
  inputSchema: InputSchema,
  execute: async (args, context: ToolContext) => {
    const { dataset_id } = InputSchema.parse(args);
    const dataset = getDataset(dataset_id);
    context.logger(`计算指标: ${dataset_id}`);
    return { dataset_id, metrics: calculateMetricSnapshot(dataset.data, dataset.query) };
  },
};
