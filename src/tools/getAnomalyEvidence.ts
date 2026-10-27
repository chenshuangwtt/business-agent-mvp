import { z } from "zod";
import { allocateEventByProduct } from "../business/allocation.js";
import { getDataset } from "../business/datasetStore.js";
import { getBusinessDiagnosisAnomaly } from "./diagnoseBusiness.js";
import { getDiagnosisAnomaly } from "./detectAnomalies.js";
import type { BusinessQuery, OrderItemRecord, OrderRecord, ProductRecord } from "../business/types.js";
import type { AgentTool, ToolContext } from "../agent/types.js";

const InputSchema = z.object({ dataset_id: z.string(), anomaly_id: z.string(), limit: z.number().int().min(1).max(20).default(10) });

export const getAnomalyEvidenceTool: AgentTool = {
  name: "get_anomaly_evidence",
  description: "按异常范围返回少量可核对的支付、退款或订单证据，不返回无关订单。",
  riskLevel: "medium",
  requiresApproval: false,
  inputSchema: InputSchema,
  execute: async (args, context: ToolContext) => {
    const { dataset_id, anomaly_id, limit } = InputSchema.parse(args);
    const dataset = getDataset(dataset_id);
    const anomaly = getDiagnosisAnomaly(anomaly_id) || getBusinessDiagnosisAnomaly(anomaly_id);
    if (!anomaly || anomaly.dataset_id !== dataset_id) throw Object.assign(new Error("anomaly_id 与数据集不匹配或已过期"), { code: "INVALID_ARGS" });

    const orders = new Map(dataset.data.orders.map((order) => [order.order_id, order]));
    const products = new Map(dataset.data.products.map((product) => [product.product_id, product]));
    const itemsByOrder = groupItems(dataset.data.orderItems);
    const query = scopedQuery(dataset.query, anomaly.scope);
    const result = anomaly.type === "refund_ratio_increase"
      ? refundEvidence(dataset.data.refunds, orders, itemsByOrder, products, query, limit)
      : anomaly.type === "channel_sales_decline"
        ? paymentEvidence(dataset.data.payments, orders, itemsByOrder, products, query, limit)
        : anomaly.type === "product_sales_change"
          ? productEvidence(dataset.data.payments, dataset.data.refunds, orders, itemsByOrder, products, query, limit)
          : frequencyEvidence(orders, query, anomaly.scope?.customer_id, anomaly.scope?.date, limit);

    context.logger(`获取异常证据: ${anomaly_id}, ${result.evidence.length} 条`);
    return {
      dataset_id,
      anomaly_id,
      metric: result.metric,
      evidence: result.evidence,
      total: result.total,
      reason: result.evidence.length ? undefined : result.reason,
      notice: "证据仅用于核对数据事实，不足以单独证明主观原因或欺诈。",
    };
  },
};

function refundEvidence(refunds: Array<{ refund_id: string; payment_id: string; order_id: string; refund_status: string; refund_amount_cents: number; completed_at: string; refund_reason: string }>, orders: Map<string, OrderRecord>, items: Map<string, OrderItemRecord[]>, products: Map<string, ProductRecord>, query: BusinessQuery, limit: number) {
  const evidence = refunds
    .filter((refund) => refund.refund_status === "success" && inRange(refund.completed_at, query) && matchesOrder(orders.get(refund.order_id), items.get(refund.order_id) || [], query))
    .sort((left, right) => left.completed_at.localeCompare(right.completed_at) || left.refund_id.localeCompare(right.refund_id))
    .map((refund) => {
      const order = orders.get(refund.order_id)!;
      const allocations = productAllocations(refund.refund_amount_cents, items.get(refund.order_id) || [], products, query.product_id);
      return {
        record_type: "refund",
        refund_id: refund.refund_id,
        payment_id: refund.payment_id,
        order_id: refund.order_id,
        completed_at: refund.completed_at,
        channel: order.channel,
        region: order.region,
        refund_reason: refund.refund_reason,
        refund_amount_cents: sumAllocations(allocations),
        products: allocations,
      };
    });
  return { metric: "successful_refund_amount_cents", evidence: evidence.slice(0, limit), total: evidence.length, reason: "当前周期没有匹配的成功退款记录" };
}

function paymentEvidence(payments: Array<{ payment_id: string; order_id: string; payment_status: string; amount_cents: number; succeeded_at: string }>, orders: Map<string, OrderRecord>, items: Map<string, OrderItemRecord[]>, products: Map<string, ProductRecord>, query: BusinessQuery, limit: number) {
  const evidence = payments
    .filter((payment) => payment.payment_status === "success" && inRange(payment.succeeded_at, query) && matchesOrder(orders.get(payment.order_id), items.get(payment.order_id) || [], query))
    .sort((left, right) => right.succeeded_at.localeCompare(left.succeeded_at) || left.payment_id.localeCompare(right.payment_id))
    .map((payment) => {
      const order = orders.get(payment.order_id)!;
      const allocations = productAllocations(payment.amount_cents, items.get(payment.order_id) || [], products, query.product_id);
      return {
        record_type: "payment",
        payment_id: payment.payment_id,
        order_id: payment.order_id,
        succeeded_at: payment.succeeded_at,
        channel: order.channel,
        region: order.region,
        payment_amount_cents: sumAllocations(allocations),
        products: allocations,
      };
    });
  return { metric: "successful_payment_amount_cents", evidence: evidence.slice(0, limit), total: evidence.length, reason: "当前周期没有匹配的成功支付记录" };
}

function productEvidence(payments: Array<{ payment_id: string; order_id: string; payment_status: string; amount_cents: number; succeeded_at: string }>, refunds: Array<{ refund_id: string; payment_id: string; order_id: string; refund_status: string; refund_amount_cents: number; completed_at: string }>, orders: Map<string, OrderRecord>, items: Map<string, OrderItemRecord[]>, products: Map<string, ProductRecord>, query: BusinessQuery, limit: number) {
  if (!query.product_id) return { metric: "product_records", evidence: [], total: 0, reason: "缺少目标商品范围" };
  const evidence = [...orders.values()]
    .filter((order) => matchesOrder(order, items.get(order.order_id) || [], query))
    .sort((left, right) => left.order_id.localeCompare(right.order_id))
    .map((order) => {
      const orderItems = items.get(order.order_id) || [];
      const paymentsForOrder = payments.filter((payment) => payment.order_id === order.order_id && payment.payment_status === "success" && inRange(payment.succeeded_at, query));
      const refundsForOrder = refunds.filter((refund) => refund.order_id === order.order_id && refund.refund_status === "success" && inRange(refund.completed_at, query));
      return {
        record_type: "product_order",
        order_id: order.order_id,
        channel: order.channel,
        region: order.region,
        product_id: query.product_id,
        payment_amount_cents: paymentsForOrder.reduce((sum, payment) => sum + sumAllocations(productAllocations(payment.amount_cents, orderItems, products, query.product_id)), 0),
        refund_amount_cents: refundsForOrder.reduce((sum, refund) => sum + sumAllocations(productAllocations(refund.refund_amount_cents, orderItems, products, query.product_id)), 0),
      };
    });
  return { metric: "product_records", evidence: evidence.slice(0, limit), total: evidence.length, reason: "当前周期没有匹配的商品订单记录" };
}

function frequencyEvidence(orders: Map<string, OrderRecord>, query: BusinessQuery, customerId: string | undefined, date: string | undefined, limit: number) {
  const evidence = [...orders.values()]
    .filter((order) => order.customer_id === customerId && (!date || order.created_at.slice(0, 10) === date) && inRange(order.created_at, query))
    .sort((left, right) => left.created_at.localeCompare(right.created_at) || left.order_id.localeCompare(right.order_id))
    .map((order) => ({ record_type: "order", order_id: order.order_id, customer_id: order.customer_id, created_at: order.created_at, channel: order.channel, region: order.region }));
  return { metric: "created_order_count", evidence: evidence.slice(0, limit), total: evidence.length, reason: "当前周期没有匹配的高频下单记录" };
}

function scopedQuery(query: BusinessQuery, scope: { channel?: string; product_id?: string } | undefined): BusinessQuery {
  return { ...query, channel: scope?.channel || query.channel, product_id: scope?.product_id || query.product_id };
}

function productAllocations(amountCents: number, items: OrderItemRecord[], products: Map<string, ProductRecord>, productId?: string) {
  return [...allocateEventByProduct(amountCents, items)]
    .filter(([id]) => !productId || id === productId)
    .map(([product_id, amount_cents]) => ({ product_id, product_name: products.get(product_id)?.product_name || product_id, amount_cents }));
}

function matchesOrder(order: OrderRecord | undefined, items: OrderItemRecord[], query: BusinessQuery): boolean {
  if (!order) return false;
  if (query.channel && query.channel !== "all" && order.channel !== query.channel) return false;
  if (query.region && query.region !== "all" && order.region !== query.region) return false;
  return !query.product_id || items.some((item) => item.product_id === query.product_id);
}

function inRange(value: string, query: Pick<BusinessQuery, "start_date" | "end_date">): boolean {
  const date = value.slice(0, 10);
  return date >= query.start_date && date <= query.end_date;
}

function groupItems(items: OrderItemRecord[]): Map<string, OrderItemRecord[]> {
  const result = new Map<string, OrderItemRecord[]>();
  for (const item of items) result.set(item.order_id, [...(result.get(item.order_id) || []), item]);
  return result;
}

function sumAllocations(allocations: Array<{ amount_cents: number }>): number {
  return allocations.reduce((sum, item) => sum + item.amount_cents, 0);
}
