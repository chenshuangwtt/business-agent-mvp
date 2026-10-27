import { z } from "zod";
import { getDataset } from "../business/datasetStore.js";
import { compareMetricPeriods } from "../business/metrics.js";
import type { DiagnosisAnomaly } from "../business/types.js";
import type { AgentTool, ToolContext } from "../agent/types.js";

const InputSchema = z.object({ dataset_id: z.string().min(1), refund_ratio_pp_threshold: z.number().min(0).default(0.04), channel_decline_threshold: z.number().min(0).max(1).default(0.4), high_frequency_order_threshold: z.number().int().min(2).default(7) });
const anomalies = new Map<string, DiagnosisAnomaly>();

export const detectAnomaliesTool: AgentTool = {
  name: "detect_anomalies",
  description: "基于同期对比检测退款率上升、同渠道销售下降和高频下单；结论仅包含可复核的数据事实。",
  riskLevel: "low",
  requiresApproval: false,
  inputSchema: InputSchema,
  execute: async (args, context: ToolContext) => {
    const input = InputSchema.parse(args);
    const dataset = getDataset(input.dataset_id);
    const comparison = compareMetricPeriods(dataset.data, input.dataset_id, dataset.query);
    const result: DiagnosisAnomaly[] = [];
    const pp = comparison.changes.refund_to_payment_ratio.percentage_point_change;
    if (pp !== null && pp >= input.refund_ratio_pp_threshold) result.push(make(input.dataset_id, "refund_ratio_increase", "high", comparison.comparison_id, `退款率较上一周期上升 ${(pp * 100).toFixed(1)} 个百分点`, ["退款金额和成功支付金额均按完成/成功时间统计", `当前退款率 ${(comparison.current.refund_to_payment_ratio! * 100).toFixed(1)}%，上一周期 ${(comparison.previous.refund_to_payment_ratio! * 100).toFixed(1)}%`]));
    for (const [channel, current] of Object.entries(comparison.current.by_channel)) {
      const previous = comparison.previous.by_channel[channel];
      if (!previous || previous.successful_payment_amount_cents === 0) continue;
      const rate = (current.successful_payment_amount_cents - previous.successful_payment_amount_cents) / previous.successful_payment_amount_cents;
      if (rate <= -input.channel_decline_threshold) result.push(make(input.dataset_id, "channel_sales_decline", "medium", comparison.comparison_id, `${channel} 成功支付金额较上一周期下降 ${Math.abs(rate * 100).toFixed(1)}%`, [`当前 ${current.successful_payment_amount_cents} 分`, `上一周期 ${previous.successful_payment_amount_cents} 分`], { channel }));
    }
    const counts = new Map<string, number>();
    for (const order of dataset.data.orders) if (order.created_at.slice(0, 10) >= dataset.query.start_date && order.created_at.slice(0, 10) <= dataset.query.end_date) counts.set(`${order.customer_id}|${order.created_at.slice(0, 10)}`, (counts.get(`${order.customer_id}|${order.created_at.slice(0, 10)}`) || 0) + 1);
    for (const [key, count] of counts) if (count >= input.high_frequency_order_threshold) {
      const [customer_id, date] = key.split("|");
      result.push(make(input.dataset_id, "high_frequency_ordering", "medium", comparison.comparison_id, `${customer_id} 在 ${date} 创建 ${count} 笔订单`, ["仅标记高频下单，不将其认定为欺诈"], { customer_id, date }));
    }
    result.forEach((anomaly) => anomalies.set(anomaly.anomaly_id, anomaly));
    context.logger(`识别异常: ${result.length} 个`);
    return { dataset_id: input.dataset_id, comparison, anomalies: result, total: result.length };
  },
};

export function getDiagnosisAnomaly(anomalyId: string): DiagnosisAnomaly | undefined { return anomalies.get(anomalyId); }
function make(datasetId: string, type: DiagnosisAnomaly["type"], severity: DiagnosisAnomaly["severity"], comparisonId: string, trigger: string, facts: string[], scope?: DiagnosisAnomaly["scope"]): DiagnosisAnomaly {
  const suffix = type === "high_frequency_ordering" ? trigger.replace(/[^A-Z0-9]/gi, "").slice(-12) : "summary";
  return { anomaly_id: `anomaly-${datasetId.replace("dataset-", "")}-${type}-${suffix}`, dataset_id: datasetId, type, severity, title: type === "refund_ratio_increase" ? "退款率上升" : type === "channel_sales_decline" ? "渠道支付金额下降" : "高频下单", trigger, facts, comparison_id: comparisonId, dimensions: type === "high_frequency_ordering" ? ["customer"] : type === "channel_sales_decline" ? ["channel"] : ["product", "channel", "region", "refund_reason"], scope };
}
