import assert from "node:assert/strict";
import test from "node:test";
import { clearBusinessDataCache, getBusinessData } from "../src/business/businessRepository.ts";
import { runDiagnosis } from "../src/business/diagnosisEngine.ts";
import { buildBusinessPresentation } from "../src/business/presentation.ts";

function diagnose(question: string, query: { start_date: string; end_date: string; channel?: string }) {
  clearBusinessDataCache();
  return runDiagnosis({ datasetId: "dataset-presentation", userQuestion: question, query, data: getBusinessData() });
}

test("refund diagnosis exposes deterministic KPI cards and contribution breakdowns", () => {
  const state = diagnose("最近一周退款为什么增加了？", { start_date: "2026-09-24", end_date: "2026-09-30" });
  const presentation = buildBusinessPresentation(state, 220);
  const refund = presentation.metrics.find((metric) => metric.id === "current_refund_amount");
  const refundChange = presentation.metrics.find((metric) => metric.id === "refund_amount_change");
  const ratio = presentation.metrics.find((metric) => metric.id === "refund_to_payment_ratio");

  assert.equal(presentation.period.label, "2026-09-24 至 2026-09-30");
  assert.equal(refund?.unit, "CNY");
  assert.equal(refund?.value, state.comparison.current.successful_refund_amount_cents / 100);
  assert.equal(refundChange?.direction, "up");
  assert.equal(ratio?.unit, "percent");
  assert.ok((ratio?.percentagePointChange || 0) > 0);
  assert.equal(ratio?.changeRate, undefined);
  assert.ok(presentation.conclusions.length >= 2);
  assert.deepEqual(presentation.breakdowns.map((item) => item.id), ["product-positive", "channel-positive", "refund_reason-positive"]);
  assert.ok(presentation.breakdowns[0]!.rows.every((row) => (row.contributionRatio || 0) > 0 && (row.contributionRatio || 0) <= 1));
  assert.equal(presentation.recommendations.length, 2);
});

test("sales decline prioritizes payment change and its primary contribution", () => {
  const state = diagnose("小程序最近一周销售额为什么下降？", {
    start_date: "2026-09-24",
    end_date: "2026-09-30",
    channel: "小程序",
  });
  const presentation = buildBusinessPresentation(state);
  const payment = presentation.metrics.find((metric) => metric.id === "focus_payment_change");
  const contribution = presentation.metrics.find((metric) => metric.id === "primary_contribution_ratio");

  assert.equal(payment?.direction, "down");
  assert.equal(contribution?.unit, "percent");
  assert.match(presentation.conclusions[0] || "", /小程序成功支付金额/);
  assert.ok(presentation.breakdowns.some((item) => item.id === "product-negative"));
});

test("positive payment growth is favorable and missing comparisons remain explicit", () => {
  const state = diagnose("本周是否真的存在明显经营异常？", { start_date: "2026-05-12", end_date: "2026-05-18" });
  state.comparison.changes.successful_payment_amount_cents.change_rate = 0.12;
  state.comparison.changes.successful_payment_amount_cents.absolute_change = 1200;
  state.comparison.changes.refund_to_payment_ratio.percentage_point_change = null;
  state.comparison.current.refund_to_payment_ratio = null;

  const presentation = buildBusinessPresentation(state);
  const payment = presentation.metrics.find((metric) => metric.id === "successful_payment_amount");
  const ratio = presentation.metrics.find((metric) => metric.id === "refund_to_payment_ratio");

  assert.equal(payment?.status, "favorable");
  assert.equal(payment?.direction, "up");
  assert.equal(ratio?.status, "unknown");
  assert.equal(ratio?.value, null);
  assert.equal(ratio?.percentagePointChange, null);
  assert.match(presentation.summary, /成功支付金额增加/);
});

test("refund contribution question selects refund ranking KPI cards instead of anomaly KPI cards", () => {
  const state = diagnose("哪个商品对退款增长影响最大？", { start_date: "2026-04-08", end_date: "2026-04-14" });
  const presentation = buildBusinessPresentation(state);

  assert.deepEqual(
    presentation.metrics.map((metric) => metric.id),
    ["current_refund_amount", "previous_refund_amount", "refund_amount_change", "primary_contribution_ratio"]
  );
  assert.equal(presentation.summaryStatus, "warning");
  assert.match(presentation.summary, /年度会员/);
  assert.match(presentation.summary, /占商品退款增长合计 70.0%/);
});

test("refund contribution without growth uses neutral summary status", () => {
  const state = diagnose("哪个商品对退款增长影响最大？", { start_date: "2026-08-06", end_date: "2026-08-12" });
  const presentation = buildBusinessPresentation(state);

  assert.equal(presentation.summaryStatus, "neutral");
  assert.match(presentation.summary, /当前没有商品退款金额增长/);
});

test("metric direction is numeric even when the business meaning differs", () => {
  const refundState = diagnose("最近一周退款为什么增加了？", { start_date: "2026-09-24", end_date: "2026-09-30" });
  const refundPresentation = buildBusinessPresentation(refundState);
  const refundChange = refundPresentation.metrics.find((metric) => metric.id === "refund_amount_change");
  assert.equal(refundChange?.direction, "up");

  const salesState = diagnose("小程序最近一周销售额为什么下降？", { start_date: "2026-09-24", end_date: "2026-09-30", channel: "小程序" });
  const salesPresentation = buildBusinessPresentation(salesState);
  const salesChange = salesPresentation.metrics.find((metric) => metric.id === "focus_payment_change");
  assert.equal(salesChange?.direction, "down");
});
