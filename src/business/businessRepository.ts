import { readCSV } from "../utils/csv.js";
import type {
  BusinessDataModel,
  CustomerRecord,
  OrderItemRecord,
  OrderRecord,
  PaymentRecord,
  ProductRecord,
  RefundRecord,
} from "./types.js";

let cached: BusinessDataModel | null = null;

export interface BusinessDataCoverage {
  startDate: string;
  endDate: string;
}

function numberFields<T>(rows: T[], fields: Array<keyof T>): T[] {
  return rows.map((row) => {
    const next = { ...row };
    for (const field of fields) (next as any)[field] = Number((next as any)[field]);
    return next;
  });
}

export function getBusinessData(): BusinessDataModel {
  if (cached) return cached;

  const data: BusinessDataModel = {
    orders: readCSV<OrderRecord>("orders.csv"),
    orderItems: numberFields(readCSV<OrderItemRecord>("order_items.csv"), ["quantity", "unit_price_cents", "line_amount_cents"]),
    payments: numberFields(readCSV<PaymentRecord>("payments.csv"), ["amount_cents"]),
    refunds: numberFields(readCSV<RefundRecord>("refunds.csv"), ["refund_amount_cents"]),
    products: numberFields(readCSV<ProductRecord>("products.csv"), ["price_cents"]),
    customers: readCSV<CustomerRecord>("customers.csv"),
  };
  cached = data;
  return data;
}

export function clearBusinessDataCache(): void {
  cached = null;
}

export function getBusinessDataCoverage(data: BusinessDataModel = getBusinessData()): BusinessDataCoverage {
  const dates = [
    ...data.orders.map((item) => item.created_at.slice(0, 10)),
    ...data.payments.map((item) => item.succeeded_at.slice(0, 10)),
    ...data.refunds.map((item) => item.completed_at.slice(0, 10)),
  ].filter(Boolean).sort();
  if (!dates.length) throw new Error("经营数据没有可用日期");
  return { startDate: dates[0]!, endDate: dates[dates.length - 1]! };
}
