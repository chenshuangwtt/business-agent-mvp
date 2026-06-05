import { z } from "zod";
import type { AgentTool, Anomaly, ToolContext } from "../agent/types.js";

const InputSchema = z.object({
  orders: z.array(z.any()).describe("订单数据数组"),
  metrics: z.any().optional().describe("经营指标，可选"),
});

export const findAnomaliesTool: AgentTool = {
  name: "find_anomalies",
  description:
    "识别异常订单和异常指标，包括大额订单、高退款率、疑似刷单、渠道销售异常等。",
  riskLevel: "low",
  requiresApproval: false,
  inputSchema: InputSchema,
  execute: async (args, context: ToolContext) => {
    const { orders, metrics } = InputSchema.parse(args);

    context.logger(`识别异常: ${orders.length} 笔订单`);

    const anomalies: Anomaly[] = [];

    const largeOrders = orders.filter((o: any) => Number(o.total_amount) > 5000);
    for (const order of largeOrders) {
      anomalies.push({
        type: "large_order",
        severity: "medium",
        reason: `单笔订单金额超过 5000 元（¥${order.total_amount}）`,
        evidence: {
          order_id: order.order_id,
          total_amount: order.total_amount,
          customer_id: order.customer_id,
          product_id: order.product_id,
        },
      });
    }

    const dailyRefundMap: Record<string, { total: number; refund: number }> = {};
    for (const order of orders) {
      const date = String(order.order_date);
      if (!dailyRefundMap[date]) {
        dailyRefundMap[date] = { total: 0, refund: 0 };
      }
      dailyRefundMap[date].total += Number(order.total_amount) || 0;
      dailyRefundMap[date].refund += Number(order.refund_amount) || 0;
    }

    for (const [date, data] of Object.entries(dailyRefundMap)) {
      if (data.total <= 0) continue;
      const rate = (data.refund / data.total) * 100;
      if (rate > 20) {
        anomalies.push({
          type: "high_daily_refund",
          severity: "high",
          reason: `${date} 退款率异常偏高（${rate.toFixed(1)}%）`,
          evidence: {
            date,
            refund_amount: data.refund,
            total_amount: data.total,
            refund_rate: `${rate.toFixed(1)}%`,
          },
        });
      }
    }

    const customerDailyOrders: Record<string, Record<string, number>> = {};
    for (const order of orders) {
      const customerId = String(order.customer_id);
      const date = String(order.order_date);
      if (!customerDailyOrders[customerId]) {
        customerDailyOrders[customerId] = {};
      }
      customerDailyOrders[customerId][date] =
        (customerDailyOrders[customerId][date] || 0) + 1;
    }

    for (const [customerId, dates] of Object.entries(customerDailyOrders)) {
      for (const [date, count] of Object.entries(dates)) {
        if (count > 5) {
          anomalies.push({
            type: "suspected_bulk_order",
            severity: "high",
            reason: `同一客户 ${customerId} 在 ${date} 下单 ${count} 次，疑似刷单或异常采购`,
            evidence: { customer_id: customerId, date, order_count: count },
          });
        }
      }
    }

    if (metrics?.sales_by_channel) {
      const channels = metrics.sales_by_channel as Record<string, number>;
      const values = Object.values(channels).map(Number);
      if (values.length > 0) {
        const avgChannelSales = values.reduce((a, b) => a + b, 0) / values.length;
        for (const [channel, sales] of Object.entries(channels)) {
          if (avgChannelSales <= 0) continue;
          const drop = ((avgChannelSales - Number(sales)) / avgChannelSales) * 100;
          if (drop > 30) {
            anomalies.push({
              type: "channel_decline",
              severity: "medium",
              reason: `${channel} 渠道销售额较平均水平下降 ${drop.toFixed(1)}%`,
              evidence: {
                channel,
                sales,
                avg_sales: Math.round(avgChannelSales),
                decline: `${drop.toFixed(1)}%`,
              },
            });
          }
        }
      }
    }

    return { anomalies, total: anomalies.length };
  },
};
