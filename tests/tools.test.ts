import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import assert from "node:assert/strict";
import test from "node:test";
import { z } from "zod";
import { queryOrdersTool } from "../src/tools/queryOrders.ts";
import { calculateMetricsTool } from "../src/tools/calculateMetrics.ts";
import { comparePeriodMetricsTool } from "../src/tools/comparePeriodMetrics.ts";
import { detectAnomaliesTool } from "../src/tools/detectAnomalies.ts";
import { exportReportTool } from "../src/tools/exportReport.ts";
import { diagnoseBusinessTool } from "../src/tools/diagnoseBusiness.ts";
import { generateDiagnosisReportTool } from "../src/tools/generateDiagnosisReport.ts";
import { execToolWithTrace } from "../src/agent/agentLoop.ts";
import { getToolsForLLM, initToolRegistry } from "../src/agent/toolRegistry.ts";
import { createTrace } from "../src/trace/traceRecorder.ts";
import { getBusinessData } from "../src/business/businessRepository.ts";
import type { AgentTool, ToolContext } from "../src/agent/types.ts";

const context: ToolContext = { traceId: "trace-test", logger: () => {} };

test("demo data keeps order, payment and refund references valid", () => {
  const data = getBusinessData();
  const orderIds = new Set(data.orders.map((item) => item.order_id));
  const paymentIds = new Set(data.payments.map((item) => item.payment_id));
  assert.ok(data.orders.length > 800);
  assert.ok(data.orderItems.every((item) => orderIds.has(item.order_id) && item.line_amount_cents === item.quantity * item.unit_price_cents));
  assert.ok(data.payments.every((item) => orderIds.has(item.order_id) && Number.isInteger(item.amount_cents)));
  assert.ok(data.refunds.every((item) => orderIds.has(item.order_id) && paymentIds.has(item.payment_id) && Number.isInteger(item.refund_amount_cents)));
});

test("query_orders creates a bounded server-side dataset without raw orders", async () => {
  const result = await queryOrdersTool.execute({ start_date: "2026-09-24", end_date: "2026-09-30", channel: "all", region: "all" }, context);
  assert.match(result.dataset_id, /^dataset-/);
  assert.ok(result.record_count > 0);
  assert.equal((result as any).orders, undefined);
  await assert.rejects(() => queryOrdersTool.execute({ start_date: "2026-07-19", end_date: "2026-07-13" }, context), /开始日期/);
});

test("metrics use cents and compare equal-length prior period", async () => {
  const dataset = await queryOrdersTool.execute({ start_date: "2026-09-24", end_date: "2026-09-30", channel: "all", region: "all" }, context);
  const metrics = await calculateMetricsTool.execute({ dataset_id: dataset.dataset_id }, context);
  const comparison = await comparePeriodMetricsTool.execute({ dataset_id: dataset.dataset_id }, context);
  assert.equal(metrics.metrics.period.label, "2026-09-24 至 2026-09-30");
  assert.ok(Number.isInteger(metrics.metrics.successful_payment_amount_cents));
  assert.equal(comparison.previous.period.label, "2026-09-17 至 2026-09-23");
  assert.ok(["calculated", "not_calculable"].includes(comparison.changes.net_cash_inflow_cents.change_rate_status));
});

test("anomaly diagnosis identifies deterministic seeded signals", async () => {
  const dataset = await queryOrdersTool.execute({ start_date: "2026-09-24", end_date: "2026-09-30", channel: "all", region: "all" }, context);
  const result = await detectAnomaliesTool.execute({ dataset_id: dataset.dataset_id }, context);
  assert.ok(result.anomalies.some((item: any) => item.type === "refund_ratio_increase"));
  assert.ok(result.anomalies.some((item: any) => item.type === "high_frequency_ordering"));
});

test("export_report only writes inside reports directory", async () => {
  const filename = "test-export-report.md";
  const filePath = join(process.cwd(), "reports", filename);
  try {
    const result = await exportReportTool.execute({
      filename,
      content: "# Test Report\n\nquery_orders 已完成\n\ndata/orders.csv",
    }, context);
    assert.equal(result.success, true);
    assert.equal(existsSync(filePath), true);
    const exported = readFileSync(filePath, "utf-8");
    assert.equal(exported.includes("query_orders"), false);
    assert.equal(exported.includes("orders.csv"), false);
    await assert.rejects(() => exportReportTool.execute({ filename: "../escape.md", content: "# Bad" }, context), /文件名/);
  } finally { if (existsSync(filePath)) rmSync(filePath); }
});

test("diagnosis report keeps business evidence without implementation details", async () => {
  const dataset = await queryOrdersTool.execute({ start_date: "2026-09-24", end_date: "2026-09-30", channel: "all", region: "all" }, context);
  const diagnosis = await diagnoseBusinessTool.execute({
    dataset_id: dataset.dataset_id,
    question: "最近一周退款为什么增加了？请说明计算依据。",
  }, context);
  const report = await generateDiagnosisReportTool.execute({
    dataset_id: dataset.dataset_id,
    diagnosis_id: diagnosis.diagnosis_id,
  }, context);

  assert.match(report.content, /2026-09-24 至 2026-09-30/);
  assert.match(report.content, /成功退款金额/);
  assert.match(report.content, /抖音|增长策略课程/);
  assert.match(report.content, /计算依据/);
  assert.doesNotMatch(report.content, /dataset_id|diagnosis_id|dataset-|diagnosis-|query_orders|\.csv|动态分析路径/);
  assert.doesNotMatch(report.content, /\d+\s*分/);
});

test("normal diagnosis report explains metric changes without fabricating an alert", async () => {
  const dataset = await queryOrdersTool.execute({ start_date: "2026-05-12", end_date: "2026-05-18", channel: "all", region: "all" }, context);
  const diagnosis = await diagnoseBusinessTool.execute({
    dataset_id: dataset.dataset_id,
    question: "本周是否真的存在明显经营异常？",
  }, context);
  const report = await generateDiagnosisReportTool.execute({
    dataset_id: dataset.dataset_id,
    diagnosis_id: diagnosis.diagnosis_id,
  }, context);

  assert.match(report.content, /当前未触发既定预警阈值/);
  assert.match(report.content, /成功支付金额减少/);
  assert.equal(report.content.includes("风险提示"), false);
});

test("refund contribution report answers the product ranking even without an anomaly alert", async () => {
  const dataset = await queryOrdersTool.execute({ start_date: "2026-04-08", end_date: "2026-04-14", channel: "all", region: "all" }, context);
  const diagnosis = await diagnoseBusinessTool.execute({
    dataset_id: dataset.dataset_id,
    question: "哪个商品对退款增长影响最大？",
  }, context);
  const report = await generateDiagnosisReportTool.execute({
    dataset_id: dataset.dataset_id,
    diagnosis_id: diagnosis.diagnosis_id,
  }, context);

  assert.match(report.content, /退款增长最多的商品是“年度会员”/);
  assert.match(report.content, /变化来源分析/);
  assert.doesNotMatch(report.content, /当前未发现符合预警规则的明显异常/);
});

test("tool JSON schema does not mark default fields as required", () => {
  initToolRegistry();
  const queryOrders = getToolsForLLM().find((tool) => tool.function.name === "query_orders");
  assert.deepEqual(queryOrders?.function.parameters.required, ["start_date", "end_date"]);
});

test("fallback results record one fallback trace step", async () => {
  const trace = createTrace();
  const traceDir = join(process.cwd(), "logs", trace.traceId);
  const tool: AgentTool = { name: "search_business_rules", description: "test", riskLevel: "low", requiresApproval: false, inputSchema: z.any(), execute: async () => ({ fallback: true, error: "fallback" }) };
  try {
    await execToolWithTrace(tool.name, tool, {}, trace, false);
    assert.equal(trace.steps.filter((step) => step.type === "fallback").length, 1);
  } finally { if (existsSync(traceDir)) rmSync(traceDir, { recursive: true, force: true }); }
});
