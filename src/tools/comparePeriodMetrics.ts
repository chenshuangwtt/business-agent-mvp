import { z } from "zod";
import { getDataset } from "../business/datasetStore.js";
import { compareMetricPeriods } from "../business/metrics.js";
import type { AgentTool, ToolContext } from "../agent/types.js";

const InputSchema = z.object({ dataset_id: z.string().min(1) });
export const comparePeriodMetricsTool: AgentTool = {
  name: "compare_period_metrics",
  description: "将当前数据集与等长上一周期对比，返回支付、退款、净现金流和退款率变化。",
  riskLevel: "low",
  requiresApproval: false,
  inputSchema: InputSchema,
  execute: async (args, context: ToolContext) => {
    const { dataset_id } = InputSchema.parse(args);
    const dataset = getDataset(dataset_id);
    context.logger(`对比上一周期: ${dataset_id}`);
    return compareMetricPeriods(dataset.data, dataset_id, dataset.query);
  },
};
