import assert from "node:assert/strict";
import test from "node:test";
import { clearBusinessDataCache, getBusinessData } from "../src/business/businessRepository.ts";
import { runDiagnosis } from "../src/business/diagnosisEngine.ts";

function diagnose(question: string, query: { start_date: string; end_date: string; channel?: string }) {
  clearBusinessDataCache();
  return runDiagnosis({ datasetId: "dataset-test", userQuestion: question, query, data: getBusinessData() });
}

test("refund diagnosis dynamically drills product, channel and refund reason", () => {
  const state = diagnose("最近一周退款为什么增加了？帮我找出主要原因。", { start_date: "2026-09-24", end_date: "2026-09-30" });
  assert.ok(state.anomalies.some((item) => item.type === "refund_ratio_increase"));
  assert.deepEqual(state.steps.map((item) => item.dimension), ["overall", "product", "channel", "refund_reason"]);
  assert.equal(state.contributions.find((item) => item.dimension === "product")?.value, "增长策略课程");
  assert.equal(state.contributions.find((item) => item.dimension === "channel")?.value, "抖音");
  assert.ok(state.uncertainties.some((item) => item.includes("不能单独证明")));
});

test("mini-program decline compares the same channel and attributes product contribution", () => {
  const state = diagnose("小程序最近一周销售额为什么下降？", { start_date: "2026-09-24", end_date: "2026-09-30", channel: "小程序" });
  assert.ok(state.anomalies.some((item) => item.type === "channel_sales_decline"));
  assert.equal(state.steps[1]?.dimension, "channel");
  assert.equal(state.steps[2]?.dimension, "product");
  assert.match(state.steps[2]?.result_summary || "", /数据分析课程/);
});

test("normal window stops after comparison instead of inventing anomalies", () => {
  const state = diagnose("本周是否真的存在明显经营异常？", { start_date: "2026-05-12", end_date: "2026-05-18" });
  assert.equal(state.anomalies.length, 0);
  assert.equal(state.steps.length, 1);
  assert.equal(state.stop_reason, "未达到可解释异常阈值");
});

test("product-change question uses payment contribution instead of guessing a cause", () => {
  const state = diagnose("最近一个月哪个商品表现变化最大？", { start_date: "2026-09-01", end_date: "2026-09-30" });
  assert.ok(state.anomalies.some((item) => item.type === "product_sales_change"));
  assert.equal(state.analyzed_dimensions.includes("product"), true);
  assert.ok(state.uncertainties.some((item) => item.includes("不等于销量")));
});

test("diagnosis depth is bounded and high-frequency behavior stays a risk signal", () => {
  const state = diagnose("最近一周是否存在异常购买行为？", { start_date: "2026-09-24", end_date: "2026-09-30" });
  assert.ok(state.depth <= 3);
  assert.ok(state.anomalies.some((item) => item.type === "high_frequency_ordering"));
  assert.ok(state.confirmed_facts.some((item) => item.includes("待复核行为信号")));
});

test("refund product contribution is ranked even when overall refund amount declines", () => {
  const state = diagnose("哪个商品对退款增长影响最大？", { start_date: "2026-04-08", end_date: "2026-04-14" });
  const products = state.contributions.filter((item) => item.dimension === "product");
  const top = products.find((item) => item.delta_amount_cents > 0);

  assert.equal(state.goal, "refund_contribution");
  assert.ok(state.comparison.changes.successful_refund_amount_cents.absolute_change < 0);
  assert.equal(top?.value, "年度会员");
  assert.equal(top?.delta_amount_cents, 69900);
  assert.ok(Math.abs((top?.contribution_ratio || 0) - 69900 / 99800) < 1e-12);
  assert.ok(state.confirmed_facts.some((item) => item.includes("退款增长最多的商品是 年度会员")));
  assert.equal(state.anomalies.length, 0);
});

test("refund product ranking explains when no product refund amount increased", () => {
  const state = diagnose("哪个商品对退款增长影响最大？", { start_date: "2026-08-06", end_date: "2026-08-12" });
  const products = state.contributions.filter((item) => item.dimension === "product");

  assert.ok(products.length > 0);
  assert.ok(products.every((item) => item.delta_amount_cents <= 0));
  assert.ok(state.confirmed_facts.some((item) => item.includes("当前没有商品退款金额增长")));
  assert.equal(state.stop_reason, "已完成商品退款跨周期贡献比较");
});
