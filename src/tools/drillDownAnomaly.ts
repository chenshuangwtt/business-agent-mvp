import { z } from "zod";
import { getDataset } from "../business/datasetStore.js";
import { getDiagnosisAnomaly } from "./detectAnomalies.js";
import type { AgentTool, ToolContext } from "../agent/types.js";

const InputSchema = z.object({ dataset_id: z.string(), anomaly_id: z.string() });
export const drillDownAnomalyTool: AgentTool = {
  name: "drill_down_anomaly",
  description: "对已识别异常做维度拆分，返回产品、渠道、地区或退款原因的贡献，不返回订单明细。",
  riskLevel: "low",
  requiresApproval: false,
  inputSchema: InputSchema,
  execute: async (args, context: ToolContext) => {
    const { dataset_id, anomaly_id } = InputSchema.parse(args);
    const dataset = getDataset(dataset_id);
    const anomaly = getDiagnosisAnomaly(anomaly_id);
    if (!anomaly) throw Object.assign(new Error("anomaly_id 无效或已过期"), { code: "INVALID_ARGS" });
    const orders = new Map(dataset.data.orders.map((order) => [order.order_id, order]));
    const products = new Map(dataset.data.products.map((product) => [product.product_id, product]));
    const items = new Map<string, string[]>();
    for (const item of dataset.data.orderItems) items.set(item.order_id, [...(items.get(item.order_id) || []), products.get(item.product_id)?.product_name || item.product_id]);
    const refunds = dataset.data.refunds.filter((refund) => refund.refund_status === "success" && refund.completed_at.slice(0, 10) >= dataset.query.start_date && refund.completed_at.slice(0, 10) <= dataset.query.end_date);
    const groups = new Map<string, number>();
    const dimension = anomaly.type === "channel_sales_decline" ? "channel" : anomaly.type === "high_frequency_ordering" ? "customer" : "product";
    for (const refund of refunds) {
      const order = orders.get(refund.order_id); if (!order) continue;
      const keys = dimension === "product" ? items.get(refund.order_id) || [] : [dimension === "channel" ? order.channel : order.customer_id];
      for (const key of keys) groups.set(key, (groups.get(key) || 0) + refund.refund_amount_cents);
    }
    const contributions = [...groups.entries()].map(([dimension_value, refund_amount_cents]) => ({ dimension, dimension_value, refund_amount_cents })).sort((a, b) => b.refund_amount_cents - a.refund_amount_cents).slice(0, 10);
    context.logger(`下钻异常: ${anomaly_id}`);
    return { dataset_id, anomaly_id, dimension, contributions, note: "贡献按成功退款金额聚合；高频下单需要结合订单证据查看。" };
  },
};
