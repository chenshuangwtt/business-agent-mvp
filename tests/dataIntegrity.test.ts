import assert from "node:assert/strict";
import test from "node:test";
import { calculateContributions } from "../src/business/contribution.ts";
import { clearBusinessDataCache, getBusinessData, getBusinessDataCoverage } from "../src/business/businessRepository.ts";
import { calculateMetricSnapshot } from "../src/business/metrics.ts";
import type { BusinessDataModel } from "../src/business/types.ts";

function sumDimension(snapshot: ReturnType<typeof calculateMetricSnapshot>, field: "successful_payment_amount_cents" | "successful_refund_amount_cents") {
  return Object.values(snapshot.by_category).reduce((sum, item) => sum + item[field], 0);
}

function crossPeriodData(): BusinessDataModel {
  return {
    orders: [
      { order_id: "O1", customer_id: "C1", created_at: "2026-09-20T10:00:00Z", channel: "官网", region: "华东", order_status: "partially_refunded" },
      { order_id: "O2", customer_id: "C2", created_at: "2026-09-25T10:00:00Z", channel: "官网", region: "华东", order_status: "paid" },
    ],
    orderItems: [
      { order_item_id: "I1", order_id: "O1", product_id: "P1", quantity: 1, unit_price_cents: 100, line_amount_cents: 100 },
      { order_item_id: "I2", order_id: "O1", product_id: "P2", quantity: 1, unit_price_cents: 200, line_amount_cents: 200 },
      { order_item_id: "I3", order_id: "O2", product_id: "P1", quantity: 1, unit_price_cents: 101, line_amount_cents: 101 },
      { order_item_id: "I4", order_id: "O2", product_id: "P2", quantity: 1, unit_price_cents: 200, line_amount_cents: 200 },
    ],
    payments: [
      { payment_id: "PAY1", order_id: "O1", payment_status: "success", amount_cents: 300, succeeded_at: "2026-09-20T10:05:00Z" },
      { payment_id: "PAY2", order_id: "O2", payment_status: "success", amount_cents: 301, succeeded_at: "2026-09-25T10:05:00Z" },
    ],
    refunds: [
      { refund_id: "REF1", payment_id: "PAY1", order_id: "O1", refund_status: "success", refund_amount_cents: 101, completed_at: "2026-09-25T12:00:00Z", refund_reason: "重复购买" },
    ],
    products: [
      { product_id: "P1", product_name: "商品A", category: "分类A", price_cents: 100 },
      { product_id: "P2", product_name: "商品B", category: "分类B", price_cents: 200 },
    ],
    customers: [
      { customer_id: "C1", customer_name: "客户1", customer_level: "普通", registered_at: "2026-01-01" },
      { customer_id: "C2", customer_name: "客户2", customer_level: "普通", registered_at: "2026-01-01" },
    ],
  };
}

test("generated demo data preserves payment, refund and date constraints", () => {
  clearBusinessDataCache();
  const data = getBusinessData();
  const itemsByOrder = new Map<string, number>();
  for (const item of data.orderItems) itemsByOrder.set(item.order_id, (itemsByOrder.get(item.order_id) || 0) + item.line_amount_cents);
  const ordersById = new Map(data.orders.map((order) => [order.order_id, order]));
  const paymentsById = new Map(data.payments.map((payment) => [payment.payment_id, payment]));
  const refundTotals = new Map<string, number>();
  for (const refund of data.refunds) refundTotals.set(refund.payment_id, (refundTotals.get(refund.payment_id) || 0) + refund.refund_amount_cents);

  const successfulPayments = data.payments.filter((payment) => payment.payment_status === "success");
  assert.ok(successfulPayments.length > 5_000);
  assert.ok(successfulPayments.every((payment) => payment.amount_cents === itemsByOrder.get(payment.order_id)));
  assert.ok(data.refunds.every((refund) => paymentsById.get(refund.payment_id)?.order_id === refund.order_id));
  assert.ok([...refundTotals.entries()].every(([paymentId, amount]) => amount <= paymentsById.get(paymentId)!.amount_cents));
  assert.ok([...refundTotals.entries()].some(([paymentId, amount]) => amount < paymentsById.get(paymentId)!.amount_cents));
  assert.ok([...refundTotals.entries()].every(([paymentId, amount]) => {
    const payment = paymentsById.get(paymentId)!;
    return ordersById.get(payment.order_id)?.order_status === (amount === payment.amount_cents ? "refunded" : "partially_refunded");
  }));
  assert.deepEqual(getBusinessDataCoverage(data), { startDate: "2026-04-01", endDate: "2026-09-30" });
});

test("refunds use completion date and allocations preserve category and product totals", () => {
  const data = crossPeriodData();
  const query = { start_date: "2026-09-24", end_date: "2026-09-30" };
  const snapshot = calculateMetricSnapshot(data, query);

  assert.equal(snapshot.successful_payment_amount_cents, 301);
  assert.equal(snapshot.successful_refund_amount_cents, 101);
  assert.equal(sumDimension(snapshot, "successful_payment_amount_cents"), 301);
  assert.equal(sumDimension(snapshot, "successful_refund_amount_cents"), 101);
  assert.deepEqual(Object.values(snapshot.by_category).map((item) => item.successful_refund_amount_cents).sort((a, b) => a - b), [34, 67]);

  const paymentContributions = calculateContributions(data, query, "payment", "product");
  const refundContributions = calculateContributions(data, query, "refund", "product");
  assert.equal(paymentContributions.reduce((sum, item) => sum + item.current_amount_cents, 0), 301);
  assert.equal(refundContributions.reduce((sum, item) => sum + item.current_amount_cents, 0), 101);
  assert.deepEqual(refundContributions.map((item) => item.current_amount_cents).sort((a, b) => a - b), [34, 67]);
});

test("generated category metrics and product contributions conserve all cents", () => {
  const data = getBusinessData();
  const query = { start_date: "2026-04-01", end_date: "2026-09-30" };
  const snapshot = calculateMetricSnapshot(data, query);
  const payments = calculateContributions(data, query, "payment", "product");
  const refunds = calculateContributions(data, query, "refund", "product");

  assert.equal(sumDimension(snapshot, "successful_payment_amount_cents"), snapshot.successful_payment_amount_cents);
  assert.equal(sumDimension(snapshot, "successful_refund_amount_cents"), snapshot.successful_refund_amount_cents);
  assert.equal(payments.reduce((sum, item) => sum + item.current_amount_cents, 0), snapshot.successful_payment_amount_cents);
  assert.equal(refunds.reduce((sum, item) => sum + item.current_amount_cents, 0), snapshot.successful_refund_amount_cents);
});
