import assert from "node:assert/strict";
import test from "node:test";
import { calculateContributions } from "../src/business/contribution.ts";
import { getBusinessData } from "../src/business/businessRepository.ts";
import { getDataset } from "../src/business/datasetStore.ts";
import { detectAnomaliesTool } from "../src/tools/detectAnomalies.ts";
import { drillDownAnomalyTool } from "../src/tools/drillDownAnomaly.ts";
import { getAnomalyEvidenceTool } from "../src/tools/getAnomalyEvidence.ts";
import { diagnoseBusinessTool } from "../src/tools/diagnoseBusiness.ts";
import { queryOrdersTool } from "../src/tools/queryOrders.ts";
import type { ToolContext } from "../src/agent/types.ts";

const context: ToolContext = { traceId: "trace-anomaly-data-flow", logger: () => {} };
const query = { start_date: "2026-09-24", end_date: "2026-09-30", channel: "all", region: "all" };

async function detectedAnomalies() {
  const dataset = await queryOrdersTool.execute(query, context);
  const result = await detectAnomaliesTool.execute({ dataset_id: dataset.dataset_id, channel_decline_threshold: 0.4 }, context);
  return { dataset, anomalies: result.anomalies as Array<any> };
}

test("channel decline drill-down uses scoped successful payments rather than refunds", async () => {
  const { dataset, anomalies } = await detectedAnomalies();
  const anomaly = anomalies.find((item) => item.type === "channel_sales_decline");
  assert.equal(anomaly?.scope?.channel, "小程序");

  const result = await drillDownAnomalyTool.execute({ dataset_id: dataset.dataset_id, anomaly_id: anomaly.anomaly_id }, context) as any;
  const expected = calculateContributions(getBusinessData(), { ...query, channel: "小程序" }, "payment", "product").slice(0, 10);

  assert.equal(result.metric, "successful_payment_amount_cents");
  assert.equal(result.dimension, "product");
  assert.equal(result.scope.channel, "小程序");
  assert.deepEqual(result.contributions, expected);
  assert.deepEqual(result.period.current, query);
  assert.deepEqual(result.period.previous, { start_date: "2026-09-17", end_date: "2026-09-23" });
});

test("refund drill-down uses completed refund events and evidence includes cross-period refunds", async () => {
  const { dataset, anomalies } = await detectedAnomalies();
  const anomaly = anomalies.find((item) => item.type === "refund_ratio_increase");
  const drillDown = await drillDownAnomalyTool.execute({ dataset_id: dataset.dataset_id, anomaly_id: anomaly.anomaly_id }, context) as any;
  const evidence = await getAnomalyEvidenceTool.execute({ dataset_id: dataset.dataset_id, anomaly_id: anomaly.anomaly_id, limit: 20 }, context) as any;
  const data = getBusinessData();
  const refunds = new Map(data.refunds.map((refund) => [refund.refund_id, refund]));
  const payments = new Map(data.payments.map((payment) => [payment.payment_id, payment]));

  assert.equal(drillDown.metric, "successful_refund_amount_cents");
  assert.deepEqual(drillDown.contributions, calculateContributions(data, query, "refund", "product").slice(0, 10));
  assert.ok(evidence.evidence.length > 0 && evidence.evidence.length <= 20);
  assert.ok(evidence.evidence.every((item: any) => {
    const refund = refunds.get(item.refund_id);
    return item.record_type === "refund" && refund?.refund_status === "success" && refund.completed_at.slice(0, 10) >= query.start_date && refund.completed_at.slice(0, 10) <= query.end_date;
  }));
  assert.ok(evidence.evidence.some((item: any) => payments.get(item.payment_id)?.succeeded_at.slice(0, 10) < query.start_date));
});

test("channel and high-frequency evidence return only records in the anomaly scope and respect limits", async () => {
  const { dataset, anomalies } = await detectedAnomalies();
  const channelAnomaly = anomalies.find((item) => item.type === "channel_sales_decline");
  const frequencyAnomaly = anomalies.find((item) => item.type === "high_frequency_ordering");
  const channelEvidence = await getAnomalyEvidenceTool.execute({ dataset_id: dataset.dataset_id, anomaly_id: channelAnomaly.anomaly_id, limit: 3 }, context) as any;
  const frequencyEvidence = await getAnomalyEvidenceTool.execute({ dataset_id: dataset.dataset_id, anomaly_id: frequencyAnomaly.anomaly_id, limit: 5 }, context) as any;
  const data = getBusinessData();
  const payments = new Map(data.payments.map((payment) => [payment.payment_id, payment]));

  assert.equal(channelEvidence.metric, "successful_payment_amount_cents");
  assert.equal(channelEvidence.evidence.length, 3);
  assert.ok(channelEvidence.evidence.every((item: any) => item.record_type === "payment" && item.channel === "小程序" && payments.get(item.payment_id)?.payment_status === "success"));
  assert.ok(frequencyEvidence.evidence.length > 0 && frequencyEvidence.evidence.length <= 5);
  assert.ok(frequencyEvidence.evidence.every((item: any) => item.customer_id === frequencyAnomaly.scope.customer_id && item.created_at.slice(0, 10) === frequencyAnomaly.scope.date));
});

test("evidence returns an explicit empty result instead of unrelated orders when matching events are absent", async () => {
  const { dataset, anomalies } = await detectedAnomalies();
  const anomaly = anomalies.find((item) => item.type === "refund_ratio_increase");
  const entry = getDataset(dataset.dataset_id);
  const originalData = entry.data;
  entry.data = { ...originalData, refunds: [] };

  try {
    const result = await getAnomalyEvidenceTool.execute({ dataset_id: dataset.dataset_id, anomaly_id: anomaly.anomaly_id, limit: 5 }, context) as any;
    assert.equal(result.total, 0);
    assert.deepEqual(result.evidence, []);
    assert.match(result.reason, /没有匹配的成功退款记录/);
  } finally {
    entry.data = originalData;
  }
});

test("evidence lookup also accepts anomalies created by the diagnosis workflow", async () => {
  const dataset = await queryOrdersTool.execute(query, context);
  const diagnosis = await diagnoseBusinessTool.execute({ dataset_id: dataset.dataset_id, question: "小程序最近一周销售额为什么下降？" }, context) as any;
  const anomaly = diagnosis.anomalies.find((item: any) => item.type === "channel_sales_decline");
  const evidence = await getAnomalyEvidenceTool.execute({ dataset_id: dataset.dataset_id, anomaly_id: anomaly.anomaly_id, limit: 2 }, context) as any;

  assert.equal(evidence.metric, "successful_payment_amount_cents");
  assert.ok(evidence.evidence.every((item: any) => item.channel === "小程序"));
});
