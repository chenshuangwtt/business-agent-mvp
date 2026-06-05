import { z } from "zod";
import { readCSV } from "../utils/csv.js";
import type { AgentTool, Order, ToolContext } from "../agent/types.js";

const DateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "日期格式必须为 YYYY-MM-DD");
const DEMO_DATA_START = process.env.DEMO_DATA_START || "2026-05-25";
const DEMO_DATA_END = process.env.DEMO_DATA_END || "2026-06-03";

const InputSchema = z.object({
  start_date: DateSchema.describe("开始日期，格式 YYYY-MM-DD"),
  end_date: DateSchema.describe("结束日期，格式 YYYY-MM-DD"),
  status: z
    .enum(["all", "paid", "refunded", "cancelled"])
    .default("all")
    .describe("订单状态过滤"),
  channel: z.string().default("all").describe("渠道过滤"),
  region: z.string().default("all").describe("地区过滤"),
});

export const queryOrdersTool: AgentTool = {
  name: "query_orders",
  description:
    "查询指定日期范围内的订单数据，支持按状态、渠道、地区过滤，返回订单列表和查询条件。",
  riskLevel: "low",
  requiresApproval: false,
  inputSchema: InputSchema,
  execute: async (args, context: ToolContext) => {
    const { start_date, end_date, status, channel, region } = InputSchema.parse(args);

    if (start_date > end_date) {
      throw {
        code: "INVALID_ARGS",
        message: "开始日期不能晚于结束日期",
      };
    }

    context.logger(
      `查询订单: ${start_date} ~ ${end_date}, status=${status}, channel=${channel}, region=${region}`
    );

    const allOrders = readCSV<Order>("orders.csv");
    const orders: Order[] = allOrders.map((o: any) => ({
      ...o,
      quantity: Number(o.quantity),
      unit_price: Number(o.unit_price),
      total_amount: Number(o.total_amount),
      refund_amount: Number(o.refund_amount),
    }));

    const filtered = orders.filter((o) => {
      if (o.order_date < start_date || o.order_date > end_date) return false;
      if (status !== "all" && o.status !== status) return false;
      if (channel !== "all" && o.channel !== channel) return false;
      if (region !== "all" && o.region !== region) return false;
      return true;
    });

    const emptyHint =
      filtered.length === 0
        ? {
            emptyReason: `当前 demo 订单数据只覆盖 ${DEMO_DATA_START} 到 ${DEMO_DATA_END}，本次查询没有匹配订单。`,
            suggestedQuery: {
              start_date: DEMO_DATA_START,
              end_date: DEMO_DATA_END,
              status,
              channel,
              region,
            },
          }
        : {};

    return {
      orders: filtered,
      count: filtered.length,
      source: "data/orders.csv",
      availableRange: { start_date: DEMO_DATA_START, end_date: DEMO_DATA_END },
      query: { start_date, end_date, status, channel, region },
      ...emptyHint,
    };
  },
};
