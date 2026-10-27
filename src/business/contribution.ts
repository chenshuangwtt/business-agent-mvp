import { calculateMetricSnapshot, previousPeriod } from "./metrics.js";
import { allocateCents } from "./allocation.js";
import type { AnalysisDimension, BusinessDataModel, BusinessQuery, DimensionContribution } from "./types.js";

export type ContributionMetric = "refund" | "payment";

export function calculateContributions(
  data: BusinessDataModel,
  query: BusinessQuery,
  metric: ContributionMetric,
  dimension: Exclude<AnalysisDimension, "overall" | "customer">
): DimensionContribution[] {
  const previous = { ...query, ...previousPeriod(query) };
  const current = aggregate(data, query, metric, dimension);
  const before = aggregate(data, previous, metric, dimension);
  const totalDelta = [...new Set([...current.keys(), ...before.keys()])].reduce((total, key) => total + (current.get(key)?.amount || 0) - (before.get(key)?.amount || 0), 0);
  return [...new Set([...current.keys(), ...before.keys()])]
    .map((value) => {
      const now = current.get(value) || { amount: 0, count: 0 };
      const old = before.get(value) || { amount: 0, count: 0 };
      const delta = now.amount - old.amount;
      return { dimension, value, current_amount_cents: now.amount, previous_amount_cents: old.amount, delta_amount_cents: delta, contribution_ratio: totalDelta === 0 ? null : delta / totalDelta, record_count: now.count };
    })
    .sort((a, b) => b.delta_amount_cents - a.delta_amount_cents);
}

function aggregate(data: BusinessDataModel, query: BusinessQuery, metric: ContributionMetric, dimension: Exclude<AnalysisDimension, "overall" | "customer">) {
  const orders = new Map(data.orders.map((order) => [order.order_id, order]));
  const items = new Map<string, typeof data.orderItems>();
  for (const item of data.orderItems) items.set(item.order_id, [...(items.get(item.order_id) || []), item]);
  const products = new Map(data.products.map((product) => [product.product_id, product]));
  const result = new Map<string, { amount: number; count: number }>();
  const events = metric === "payment" ? data.payments.filter((event) => event.payment_status === "success" && inRange(event.succeeded_at, query)).map((event) => ({ order_id: event.order_id, amount: event.amount_cents, reason: "" })) : data.refunds.filter((event) => event.refund_status === "success" && inRange(event.completed_at, query)).map((event) => ({ order_id: event.order_id, amount: event.refund_amount_cents, reason: event.refund_reason }));
  for (const event of events) {
    const order = orders.get(event.order_id);
    if (!order || !matches(order, items.get(event.order_id) || [], query)) continue;
    if (dimension === "refund_reason") add(result, event.reason || "未提供", event.amount);
    else if (dimension === "channel") add(result, order.channel, event.amount);
    else if (dimension === "region") add(result, order.region, event.amount);
    else {
      const orderItems = items.get(event.order_id) || [];
      const allocations = allocateCents(event.amount, orderItems.map((item) => ({
        key: products.get(item.product_id)?.product_name || item.product_id,
        weight: item.line_amount_cents,
      })));
      if (!allocations.size) add(result, "未关联商品", event.amount);
      for (const [key, amount] of allocations) add(result, key, amount);
    }
  }
  return result;
}

function matches(order: any, items: any[], query: BusinessQuery): boolean {
  if (query.channel && query.channel !== "all" && order.channel !== query.channel) return false;
  if (query.region && query.region !== "all" && order.region !== query.region) return false;
  return !query.product_id || items.some((item) => item.product_id === query.product_id);
}
function add(map: Map<string, { amount: number; count: number }>, key: string, amount: number) { const entry = map.get(key) || { amount: 0, count: 0 }; entry.amount += amount; entry.count += 1; map.set(key, entry); }
function inRange(value: string, query: BusinessQuery): boolean { const date = value.slice(0, 10); return date >= query.start_date && date <= query.end_date; }
