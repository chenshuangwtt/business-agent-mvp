import type {
  BusinessDataModel,
  BusinessQuery,
  DimensionMetric,
  MetricChange,
  MetricSnapshot,
  PeriodComparison,
} from "./types.js";
import { allocateCents } from "./allocation.js";

type Dimension = "channel" | "region" | "category";

export function calculateMetricSnapshot(data: BusinessDataModel, query: BusinessQuery): MetricSnapshot {
  const itemsByOrder = groupBy(data.orderItems, "order_id");
  const products = new Map(data.products.map((product) => [product.product_id, product]));
  const orders = data.orders.filter((order) => matchesOrder(order, query, itemsByOrder));
  const eligibleOrderIds = new Set(orders.map((order) => order.order_id));
  const orderById = new Map(data.orders.map((order) => [order.order_id, order]));

  const created = orders.filter((order) => inRange(order.created_at, query));
  const successfulPayments = data.payments.filter(
    (payment) => payment.payment_status === "success" && eligibleOrderIds.has(payment.order_id) && inRange(payment.succeeded_at, query)
  );
  const successfulPaymentById = new Map(
    data.payments
      .filter((payment) => payment.payment_status === "success" && eligibleOrderIds.has(payment.order_id))
      .map((payment) => [payment.payment_id, payment])
  );
  const successfulRefunds = data.refunds.filter(
    (refund) => refund.refund_status === "success"
      && eligibleOrderIds.has(refund.order_id)
      && successfulPaymentById.get(refund.payment_id)?.order_id === refund.order_id
      && inRange(refund.completed_at, query)
  );

  const successfulPaymentAmount = sum(successfulPayments.map((payment) => payment.amount_cents));
  const successfulRefundAmount = sum(successfulRefunds.map((refund) => refund.refund_amount_cents));
  const paymentOrderCount = new Set(successfulPayments.map((payment) => payment.order_id)).size;

  return {
    period: { start_date: query.start_date, end_date: query.end_date, label: `${query.start_date} 至 ${query.end_date}` },
    created_order_count: created.length,
    successful_payment_order_count: paymentOrderCount,
    successful_payment_amount_cents: successfulPaymentAmount,
    successful_refund_amount_cents: successfulRefundAmount,
    net_cash_inflow_cents: successfulPaymentAmount - successfulRefundAmount,
    average_paid_order_amount_cents: paymentOrderCount ? Math.round(successfulPaymentAmount / paymentOrderCount) : null,
    refund_to_payment_ratio: successfulPaymentAmount ? successfulRefundAmount / successfulPaymentAmount : null,
    by_channel: dimensionMetrics("channel", successfulPayments, successfulRefunds, orderById, itemsByOrder, products),
    by_region: dimensionMetrics("region", successfulPayments, successfulRefunds, orderById, itemsByOrder, products),
    by_category: dimensionMetrics("category", successfulPayments, successfulRefunds, orderById, itemsByOrder, products),
  };
}

export function compareMetricPeriods(data: BusinessDataModel, datasetId: string, currentQuery: BusinessQuery): PeriodComparison {
  const previousQuery = { ...currentQuery, ...previousPeriod(currentQuery) };
  const current = calculateMetricSnapshot(data, currentQuery);
  const previous = calculateMetricSnapshot(data, previousQuery);
  return {
    comparison_id: `comparison-${datasetId.replace("dataset-", "")}`,
    dataset_id: datasetId,
    current,
    previous,
    changes: {
      successful_payment_amount_cents: metricChange(current.successful_payment_amount_cents, previous.successful_payment_amount_cents),
      successful_refund_amount_cents: metricChange(current.successful_refund_amount_cents, previous.successful_refund_amount_cents),
      net_cash_inflow_cents: metricChange(current.net_cash_inflow_cents, previous.net_cash_inflow_cents),
      refund_to_payment_ratio: {
        current: current.refund_to_payment_ratio,
        previous: previous.refund_to_payment_ratio,
        percentage_point_change: current.refund_to_payment_ratio === null || previous.refund_to_payment_ratio === null
          ? null
          : current.refund_to_payment_ratio - previous.refund_to_payment_ratio,
      },
    },
    filters: pickFilters(currentQuery),
  };
}

export function previousPeriod(query: Pick<BusinessQuery, "start_date" | "end_date">): Pick<BusinessQuery, "start_date" | "end_date"> {
  const dayCount = Math.round((utc(query.end_date).getTime() - utc(query.start_date).getTime()) / 86_400_000) + 1;
  const end = addDays(query.start_date, -1);
  return { start_date: addDays(end, -(dayCount - 1)), end_date: end };
}

export function metricChange(current: number, previous: number): MetricChange {
  return {
    current,
    previous,
    absolute_change: current - previous,
    change_rate: previous === 0 ? null : (current - previous) / previous,
    change_rate_status: previous === 0 ? "not_calculable" : "calculated",
  };
}

function dimensionMetrics(
  dimension: Dimension,
  payments: BusinessDataModel["payments"],
  refunds: BusinessDataModel["refunds"],
  orders: Map<string, BusinessDataModel["orders"][number]>,
  itemsByOrder: Map<string, BusinessDataModel["orderItems"]>,
  products: Map<string, BusinessDataModel["products"][number]>
): Record<string, DimensionMetric> {
  const result: Record<string, DimensionMetric> = {};
  const add = (key: string, field: keyof DimensionMetric, cents: number) => {
    result[key] ||= { successful_payment_amount_cents: 0, successful_refund_amount_cents: 0, net_cash_inflow_cents: 0 };
    result[key][field] += cents;
    result[key].net_cash_inflow_cents = result[key].successful_payment_amount_cents - result[key].successful_refund_amount_cents;
  };
  for (const payment of payments) {
    for (const [key, cents] of allocationFor(dimension, payment.order_id, payment.amount_cents, orders, itemsByOrder, products)) {
      add(key, "successful_payment_amount_cents", cents);
    }
  }
  for (const refund of refunds) {
    for (const [key, cents] of allocationFor(dimension, refund.order_id, refund.refund_amount_cents, orders, itemsByOrder, products)) {
      add(key, "successful_refund_amount_cents", cents);
    }
  }
  return result;
}

function allocationFor(dimension: Dimension, orderId: string, amountCents: number, orders: Map<string, any>, itemsByOrder: Map<string, any[]>, products: Map<string, any>): Array<[string, number]> {
  const order = orders.get(orderId);
  if (!order) return [];
  if (dimension === "channel") return [[order.channel, amountCents]];
  if (dimension === "region") return [[order.region, amountCents]];
  const weights = (itemsByOrder.get(orderId) || []).map((item) => ({
    key: products.get(item.product_id)?.category || "未分类",
    weight: item.line_amount_cents,
  }));
  const allocations = allocateCents(amountCents, weights);
  return allocations.size ? [...allocations] : [["未分类", amountCents]];
}

function matchesOrder(order: any, query: BusinessQuery, itemsByOrder: Map<string, any[]>): boolean {
  if (query.channel && query.channel !== "all" && order.channel !== query.channel) return false;
  if (query.region && query.region !== "all" && order.region !== query.region) return false;
  return !query.product_id || (itemsByOrder.get(order.order_id) || []).some((item) => item.product_id === query.product_id);
}

function inRange(value: string, query: Pick<BusinessQuery, "start_date" | "end_date">): boolean {
  const date = value.slice(0, 10);
  return date >= query.start_date && date <= query.end_date;
}
function groupBy<T extends Record<string, any>>(items: T[], key: keyof T): Map<string, T[]> {
  const result = new Map<string, T[]>();
  for (const item of items) result.set(String(item[key]), [...(result.get(String(item[key])) || []), item]);
  return result;
}
function sum(values: number[]): number { return values.reduce((total, value) => total + value, 0); }
function utc(date: string): Date { return new Date(`${date}T00:00:00Z`); }
function addDays(date: string, days: number): string { const result = utc(date); result.setUTCDate(result.getUTCDate() + days); return result.toISOString().slice(0, 10); }
function pickFilters(query: BusinessQuery): Omit<BusinessQuery, "start_date" | "end_date"> { const { start_date, end_date, ...filters } = query; return filters; }
