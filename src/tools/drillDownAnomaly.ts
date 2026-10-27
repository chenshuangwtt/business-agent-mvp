import { z } from "zod";
import { calculateContributions } from "../business/contribution.js";
import { previousPeriod } from "../business/metrics.js";
import { getDataset } from "../business/datasetStore.js";
import { getBusinessDiagnosisAnomaly } from "./diagnoseBusiness.js";
import { getDiagnosisAnomaly } from "./detectAnomalies.js";
import type { AgentTool, ToolContext } from "../agent/types.js";

const InputSchema = z.object({ dataset_id: z.string(), anomaly_id: z.string() });

export const drillDownAnomalyTool: AgentTool = {
  name: "drill_down_anomaly",
  description: "按异常类型使用对应的支付或退款事件做周期贡献拆分，不返回订单明细。",
  riskLevel: "low",
  requiresApproval: false,
  inputSchema: InputSchema,
  execute: async (args, context: ToolContext) => {
    const { dataset_id, anomaly_id } = InputSchema.parse(args);
    const dataset = getDataset(dataset_id);
    const anomaly = getDiagnosisAnomaly(anomaly_id) || getBusinessDiagnosisAnomaly(anomaly_id);
    if (!anomaly || anomaly.dataset_id !== dataset_id) throw Object.assign(new Error("anomaly_id 与数据集不匹配或已过期"), { code: "INVALID_ARGS" });

    const period = { current: dataset.query, previous: previousPeriod(dataset.query) };
    if (anomaly.type === "channel_sales_decline") {
      const channel = anomaly.scope?.channel;
      if (!channel) return emptyResult(dataset_id, anomaly_id, "缺少渠道异常范围", period);
      const query = { ...dataset.query, channel };
      const contributions = calculateContributions(dataset.data, query, "payment", "product").slice(0, 10);
      context.logger(`下钻渠道支付异常: ${anomaly_id}`);
      return {
        dataset_id,
        anomaly_id,
        metric: "successful_payment_amount_cents",
        dimension: "product",
        scope: { channel },
        period,
        contributions,
        note: "仅比较该渠道在当前与上一等长周期内的成功支付金额，商品金额按订单明细分摊。",
      };
    }

    if (anomaly.type === "refund_ratio_increase") {
      const contributions = calculateContributions(dataset.data, dataset.query, "refund", "product").slice(0, 10);
      context.logger(`下钻退款异常: ${anomaly_id}`);
      return {
        dataset_id,
        anomaly_id,
        metric: "successful_refund_amount_cents",
        dimension: "product",
        period,
        contributions,
        note: "仅统计当前与上一等长周期内完成的成功退款，商品金额按订单明细分摊。",
      };
    }

    if (anomaly.type === "product_sales_change") {
      const product_id = anomaly.scope?.product_id;
      if (!product_id) return emptyResult(dataset_id, anomaly_id, "缺少商品异常范围", period);
      const contributions = calculateContributions(dataset.data, { ...dataset.query, product_id }, "payment", "product").slice(0, 10);
      context.logger(`下钻商品支付异常: ${anomaly_id}`);
      return {
        dataset_id,
        anomaly_id,
        metric: "successful_payment_amount_cents",
        dimension: "product",
        scope: { product_id },
        period,
        contributions,
        note: "商品异常按成功支付时间比较，金额仅归属到目标商品。",
      };
    }

    const customer_id = anomaly.scope?.customer_id;
    const date = anomaly.scope?.date;
    const orders = dataset.data.orders
      .filter((order) => order.customer_id === customer_id && (!date || order.created_at.slice(0, 10) === date))
      .sort((left, right) => left.created_at.localeCompare(right.created_at) || left.order_id.localeCompare(right.order_id))
      .slice(0, 10)
      .map((order) => ({ order_id: order.order_id, created_at: order.created_at, customer_id: order.customer_id }));
    context.logger(`下钻高频订单异常: ${anomaly_id}`);
    return {
      dataset_id,
      anomaly_id,
      metric: "created_order_count",
      dimension: "customer",
      scope: { customer_id, date },
      period,
      contributions: [{ dimension: "customer", dimension_value: customer_id || "未提供", current_order_count: orders.length }],
      records: orders,
      note: "高频下单仅返回目标客户在异常日期的实际订单记录。",
    };
  },
};

function emptyResult(dataset_id: string, anomaly_id: string, reason: string, period: unknown) {
  return { dataset_id, anomaly_id, contributions: [], reason, period };
}
