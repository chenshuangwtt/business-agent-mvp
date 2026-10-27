import { z } from "zod";
import { getDataset } from "../business/datasetStore.js";
import { getDiagnosisAnomaly } from "./detectAnomalies.js";
import type { AgentTool, ToolContext } from "../agent/types.js";

const InputSchema = z.object({ dataset_id: z.string(), anomaly_id: z.string(), limit: z.number().int().min(1).max(20).default(10) });
export const getAnomalyEvidenceTool: AgentTool = {
  name: "get_anomaly_evidence",
  description: "返回异常的脱敏聚合证据和少量订单标识，供人工复核。",
  riskLevel: "medium",
  requiresApproval: false,
  inputSchema: InputSchema,
  execute: async (args, context: ToolContext) => {
    const { dataset_id, anomaly_id, limit } = InputSchema.parse(args);
    const dataset = getDataset(dataset_id);
    const anomaly = getDiagnosisAnomaly(anomaly_id);
    if (!anomaly) throw Object.assign(new Error("anomaly_id 无效或已过期"), { code: "INVALID_ARGS" });
    const evidence = dataset.data.orders.filter((order) => order.created_at.slice(0, 10) >= dataset.query.start_date && order.created_at.slice(0, 10) <= dataset.query.end_date).slice(0, limit).map((order) => ({ order_id: order.order_id, customer_id: order.customer_id, created_at: order.created_at, channel: order.channel, region: order.region }));
    context.logger(`获取异常证据: ${anomaly_id}`);
    return { dataset_id, anomaly_id, evidence, notice: "证据仅用于复核，不足以单独证明欺诈或主观原因。" };
  },
};
