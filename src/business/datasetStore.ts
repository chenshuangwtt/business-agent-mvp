import { v4 as uuid } from "uuid";
import { getBusinessData } from "./businessRepository.js";
import type { BusinessDataModel, BusinessQuery, DatasetSummary } from "./types.js";

const DATASET_TTL_MS = parseInt(process.env.DATASET_TTL_MS || "1800000");
const MAX_DATASETS = parseInt(process.env.MAX_DATASETS || "50");
const MAX_DATASET_RECORDS = parseInt(process.env.MAX_DATASET_RECORDS || "5000");

export interface DatasetEntry {
  id: string;
  query: BusinessQuery;
  data: BusinessDataModel;
  createdAt: number;
  expiresAt: number;
  recordCount: number;
}

const datasets = new Map<string, DatasetEntry>();

export function createDataset(query: BusinessQuery): DatasetSummary {
  cleanupDatasets();
  if (datasets.size >= MAX_DATASETS) {
    const oldest = datasets.keys().next().value;
    if (oldest) datasets.delete(oldest);
  }

  const all = getBusinessData();
  const orderItemsByOrder = indexBy(all.orderItems, "order_id");
  const matchingOrders = all.orders.filter((order) => {
    const createdDate = order.created_at.slice(0, 10);
    if (createdDate < query.start_date || createdDate > query.end_date) return false;
    if (query.channel && query.channel !== "all" && order.channel !== query.channel) return false;
    if (query.region && query.region !== "all" && order.region !== query.region) return false;
    if (query.product_id && !orderItemsByOrder.get(order.order_id)?.some((item) => item.product_id === query.product_id)) return false;
    return true;
  });

  if (matchingOrders.length > MAX_DATASET_RECORDS) {
    throw Object.assign(new Error(`查询结果超过数据集上限 (${MAX_DATASET_RECORDS})`), { code: "DATASET_LIMIT" });
  }

  const orderIds = new Set(matchingOrders.map((order) => order.order_id));
  const orderItems = all.orderItems.filter((item) => orderIds.has(item.order_id));
  const paymentIds = new Set(all.payments.filter((payment) => orderIds.has(payment.order_id)).map((payment) => payment.payment_id));
  const now = Date.now();
  const entry: DatasetEntry = {
    id: `dataset-${uuid().slice(0, 8)}`,
    query: { ...query },
    // Keep the source model server-side. `recordCount` still describes the user query,
    // while metric tools apply their own event-time filters for payments and refunds.
    data: all,
    createdAt: now,
    expiresAt: now + DATASET_TTL_MS,
    recordCount: matchingOrders.length,
  };
  datasets.set(entry.id, entry);
  return toSummary(entry);
}

export function getDataset(id: string): DatasetEntry {
  cleanupDatasets();
  const dataset = datasets.get(id);
  if (!dataset) throw Object.assign(new Error("dataset_id 无效或已过期"), { code: "INVALID_DATASET" });
  return dataset;
}

export function getDatasetSummary(id: string): DatasetSummary {
  return toSummary(getDataset(id));
}

export function cleanupDatasets(now = Date.now()): void {
  for (const [id, dataset] of datasets) if (dataset.expiresAt <= now) datasets.delete(id);
}

function toSummary(dataset: DatasetEntry): DatasetSummary {
  return {
    dataset_id: dataset.id,
    record_count: dataset.recordCount,
    query: dataset.query,
    source: "data/*.csv",
    expires_at: new Date(dataset.expiresAt).toISOString(),
  };
}

function indexBy<T extends Record<string, any>>(items: T[], key: keyof T): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const value = String(item[key]);
    map.set(value, [...(map.get(value) || []), item]);
  }
  return map;
}
