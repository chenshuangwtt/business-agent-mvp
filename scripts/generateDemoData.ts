import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";

const DATA_DIR = join(process.cwd(), "data");
const START = new Date(2026, 3, 1);
const DAYS = 183;

let state = 20260930;
function random(): number {
  state = (state * 1664525 + 1013904223) >>> 0;
  return state / 0x100000000;
}

function pick<T>(items: T[]): T {
  return items[Math.floor(random() * items.length)]!;
}

function dateAt(offset: number): string {
  const date = new Date(Date.UTC(START.getFullYear(), START.getMonth(), START.getDate() + offset));
  return date.toISOString().slice(0, 10);
}

function csv(value: string | number): string {
  const text = String(value);
  return /[,"]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function write(name: string, rows: Array<Record<string, string | number>>) {
  const headers = Object.keys(rows[0] || {});
  const content = [headers.join(","), ...rows.map((row) => headers.map((key) => csv(row[key] ?? "")).join(","))].join("\n") + "\n";
  writeFileSync(join(DATA_DIR, name), content, "utf-8");
}

const products = [
  { product_id: "P101", product_name: "增长策略课程", category: "线上课程", price_cents: 19900 },
  { product_id: "P102", product_name: "数据分析课程", category: "线上课程", price_cents: 29900 },
  { product_id: "P103", product_name: "职业进阶课程", category: "线上课程", price_cents: 39900 },
  { product_id: "P201", product_name: "月度会员", category: "会员订阅", price_cents: 9900 },
  { product_id: "P202", product_name: "年度会员", category: "会员订阅", price_cents: 69900 },
  { product_id: "P301", product_name: "一对一咨询", category: "咨询服务", price_cents: 159900 },
  { product_id: "P401", product_name: "资料包", category: "其他数字服务", price_cents: 4900 },
];

const channels = ["官网", "小程序", "抖音", "B站"];
const regions = ["华东", "华南", "华北", "西南"];
const refundReasons = ["课程内容与预期不符", "重复购买", "购买后改变计划", "支付后取消服务"];
const customers = Array.from({ length: 90 }, (_, index) => ({
  customer_id: `C${String(index + 1).padStart(3, "0")}`,
  customer_name: `客户${String(index + 1).padStart(3, "0")}`,
  customer_level: index % 11 === 0 ? "高价值" : index % 3 === 0 ? "活跃" : "普通",
  registered_at: dateAt(-90 + (index % 45)),
}));

const orders: Array<Record<string, string | number>> = [];
const items: Array<Record<string, string | number>> = [];
const payments: Array<Record<string, string | number>> = [];
const refunds: Array<Record<string, string | number>> = [];
let orderNo = 0;
let paymentNo = 0;
let refundNo = 0;

function addOrder(day: number, channel: string, product = pick(products), customer = pick(customers)) {
  orderNo++;
  const orderId = `O${String(orderNo).padStart(5, "0")}`;
  const orderDate = dateAt(day);
  const region = pick(regions);
  const quantity = random() < 0.13 ? 2 : 1;
  const amount = product.price_cents * quantity;
  const failed = random() < 0.035;
  const cancelled = !failed && random() < 0.025;
  const paid = !failed && !cancelled;
  const paymentId = paid ? `PAY${String(++paymentNo).padStart(6, "0")}` : "";
  let orderStatus = failed ? "payment_failed" : cancelled ? "cancelled" : "paid";

  orders.push({ order_id: orderId, customer_id: customer.customer_id, created_at: `${orderDate}T10:00:00Z`, channel, region, order_status: orderStatus });
  items.push({ order_item_id: `I${String(orderNo).padStart(5, "0")}-1`, order_id: orderId, product_id: product.product_id, quantity, unit_price_cents: product.price_cents, line_amount_cents: amount });
  // A small share of baskets contains two products, exercising allocation rules.
  if (paid && random() < 0.08) {
    const extra = pick(products.filter((candidate) => candidate.product_id !== product.product_id));
    const extraAmount = extra.price_cents;
    items.push({ order_item_id: `I${String(orderNo).padStart(5, "0")}-2`, order_id: orderId, product_id: extra.product_id, quantity: 1, unit_price_cents: extra.price_cents, line_amount_cents: extraAmount });
    payments[payments.length - 1]!.amount_cents = amount + extraAmount;
  }
  payments.push({ payment_id: paymentId || `PAYFAIL${String(orderNo).padStart(5, "0")}`, order_id: orderId, payment_status: paid ? "success" : "failed", amount_cents: amount, succeeded_at: paid ? `${orderDate}T10:05:00Z` : "" });

  if (!paid) return;

  // Scenario A: the final week has a concentrated P101/Douyin refund increase.
  const plantedRefund = day >= 176 && product.product_id === "P101" && channel === "抖音" && random() < 0.62;
  const normalRefund = !plantedRefund && random() < 0.045;
  if (!plantedRefund && !normalRefund) return;

  const partial = random() < 0.38 && amount >= 19900;
  const firstAmount = partial ? Math.floor(amount * 0.45) : amount;
  refunds.push({ refund_id: `REF${String(++refundNo).padStart(6, "0")}`, payment_id: paymentId, order_id: orderId, refund_status: "success", refund_amount_cents: firstAmount, completed_at: `${dateAt(Math.min(day + 1, DAYS - 1))}T12:00:00Z`, refund_reason: plantedRefund ? "课程内容与预期不符" : pick(refundReasons) });
  if (partial && random() < 0.32) {
    refunds.push({ refund_id: `REF${String(++refundNo).padStart(6, "0")}`, payment_id: paymentId, order_id: orderId, refund_status: "success", refund_amount_cents: amount - firstAmount, completed_at: `${dateAt(Math.min(day + 2, DAYS - 1))}T12:00:00Z`, refund_reason: plantedRefund ? "课程内容与预期不符" : pick(refundReasons) });
  }
  orderStatus = partial ? "partially_refunded" : "refunded";
  orders[orders.length - 1]!.order_status = orderStatus;
}

for (let day = 0; day < DAYS; day++) {
  for (const channel of channels) {
    // Scenario B: mini-program payment decline is concentrated in P102/P103 demand.
    const count = day >= 176 && channel === "小程序" ? 2 + Math.floor(random() * 2) : 6 + Math.floor(random() * 4);
    for (let i = 0; i < count; i++) addOrder(day, channel);
  }
  // Establish an observable P102 mini-program baseline before the final-week decline.
  if (day >= 169 && day < 176) {
    for (let i = 0; i < 7; i++) addOrder(day, "小程序", products[1]!);
  }
  if (day >= 176) {
    for (let i = 0; i < 7; i++) addOrder(day, "抖音", products[0]!);
    // Scenario C: a material product movement with an observable contribution.
    for (let i = 0; i < 4; i++) addOrder(day, "官网", products[2]!);
    if (day === 179) {
      const frequent = customers[0]!;
      for (let i = 0; i < 8; i++) addOrder(day, "官网", products[6]!, frequent);
    }
  }
}

mkdirSync(DATA_DIR, { recursive: true });
write("products.csv", products);
write("customers.csv", customers);
write("orders.csv", orders);
write("order_items.csv", items);
write("payments.csv", payments);
write("refunds.csv", refunds);

console.log(`Generated ${orders.length} orders, ${payments.length} payments and ${refunds.length} refunds.`);
