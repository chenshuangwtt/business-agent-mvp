import { z } from "zod";
import type { AgentTool, Metrics, Order, ToolContext } from "../agent/types.js";

const OrderSchema = z.object({
  order_id: z.string(),
  order_date: z.string(),
  customer_id: z.string(),
  product_id: z.string(),
  category: z.string(),
  quantity: z.number(),
  unit_price: z.number(),
  total_amount: z.number(),
  status: z.enum(["paid", "refunded", "cancelled"]),
  channel: z.string(),
  region: z.string(),
  refund_amount: z.number(),
});

const InputSchema = z.object({
  orders: z.array(OrderSchema).describe("订单数据数组"),
  query: z
    .object({
      start_date: z.string().optional(),
      end_date: z.string().optional(),
    })
    .optional()
    .describe("订单查询条件，可用于报告周期"),
});

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

export const calculateMetricsTool: AgentTool = {
  name: "calculate_metrics",
  description:
    "根据订单数据计算经营指标，包括 GMV、净销售额、退款率、客单价、渠道分布、地区分布和热门品类。",
  riskLevel: "low",
  requiresApproval: false,
  inputSchema: InputSchema,
  execute: async (args, context: ToolContext) => {
    const { orders, query } = InputSchema.parse(args) as {
      orders: Order[];
      query?: { start_date?: string; end_date?: string };
    };

    context.logger(`计算指标: ${orders.length} 笔订单`);

    const gmv = orders.reduce((sum, o) => sum + o.total_amount, 0);
    const paidOrders = orders.filter((o) => o.status === "paid");
    const netSales = paidOrders.reduce((sum, o) => sum + o.total_amount, 0);
    const refundAmount = orders.reduce((sum, o) => sum + o.refund_amount, 0);
    const refundRate = gmv > 0 ? (refundAmount / gmv) * 100 : 0;
    const avgOrderValue = paidOrders.length > 0 ? netSales / paidOrders.length : 0;

    const salesByChannel: Record<string, number> = {};
    const salesByRegion: Record<string, number> = {};
    const categoryMap: Record<string, { sales: number; count: number }> = {};

    for (const order of paidOrders) {
      salesByChannel[order.channel] = roundMoney(
        (salesByChannel[order.channel] || 0) + order.total_amount
      );
      salesByRegion[order.region] = roundMoney(
        (salesByRegion[order.region] || 0) + order.total_amount
      );

      if (!categoryMap[order.category]) {
        categoryMap[order.category] = { sales: 0, count: 0 };
      }
      categoryMap[order.category].sales = roundMoney(
        categoryMap[order.category].sales + order.total_amount
      );
      categoryMap[order.category].count += 1;
    }

    const topCategories = Object.entries(categoryMap)
      .map(([category, data]) => ({ category, ...data }))
      .sort((a, b) => b.sales - a.sales);

    const metrics: Metrics = {
      period: inferPeriod(orders, query),
      gmv: roundMoney(gmv),
      net_sales: roundMoney(netSales),
      paid_orders: paidOrders.length,
      total_orders: orders.length,
      refund_amount: roundMoney(refundAmount),
      refund_rate: roundMoney(refundRate),
      avg_order_value: roundMoney(avgOrderValue),
      sales_by_channel: salesByChannel,
      sales_by_region: salesByRegion,
      top_categories: topCategories,
    };

    return metrics;
  },
};

function inferPeriod(
  orders: Order[],
  query?: { start_date?: string; end_date?: string }
): Metrics["period"] {
  const dates = orders.map((order) => order.order_date).filter(Boolean).sort();
  const start = query?.start_date || dates[0] || "";
  const end = query?.end_date || dates[dates.length - 1] || start;

  if (!start || !end) return undefined;

  return {
    start_date: start,
    end_date: end,
    label: `${start} 至 ${end}`,
  };
}
