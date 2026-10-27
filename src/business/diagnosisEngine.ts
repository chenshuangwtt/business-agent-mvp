import { v4 as uuid } from "uuid";
import { calculateContributions } from "./contribution.js";
import { compareMetricPeriods } from "./metrics.js";
import type { BusinessDataModel, BusinessQuery, DiagnosisAnomaly, DiagnosisGoal, DiagnosisState } from "./types.js";

const REFUND_PP_THRESHOLD = Number(process.env.DIAGNOSIS_REFUND_PP_THRESHOLD || "0.04");
const CHANNEL_DECLINE_THRESHOLD = Number(process.env.DIAGNOSIS_CHANNEL_DECLINE_THRESHOLD || "0.4");
const MIN_DELTA_CENTS = Number(process.env.DIAGNOSIS_MIN_DELTA_CENTS || "300000");
const MAX_DEPTH = Number(process.env.MAX_DIAGNOSIS_DEPTH || "3");

export function runDiagnosis(input: { datasetId: string; userQuestion: string; query: BusinessQuery; data: BusinessDataModel }): DiagnosisState {
  const goal = detectGoal(input.userQuestion);
  const comparison = compareMetricPeriods(input.data, input.datasetId, input.query);
  const state: DiagnosisState = {
    diagnosis_id: `diagnosis-${uuid().slice(0, 8)}`,
    user_question: input.userQuestion,
    goal,
    dataset_id: input.datasetId,
    query: input.query,
    comparison,
    confirmed_facts: [],
    anomalies: [],
    analyzed_dimensions: ["overall"],
    pending_questions: [],
    evidence: [{ source: "compare_period_metrics", summary: `${comparison.current.period.label} 对比 ${comparison.previous.period.label}` }],
    contributions: [],
    steps: [],
    depth: 0,
    continue_analysis: true,
    stop_reason: "",
    uncertainties: [],
  };
  step(state, "compare_period_metrics", "先确认当前周期是否相对等长对照周期存在异常。", "overall", summaryComparison(comparison));

  if (goal === "refund_contribution") investigateRefundContribution(state, input.data);
  if (goal === "refund_increase") investigateRefunds(state, input.data);
  if (state.continue_analysis && (goal === "channel_decline" || goal === "general_health")) investigateChannelDecline(state, input.data);
  if (state.continue_analysis && goal === "product_change") investigateProductChange(state, input.data);
  if (state.continue_analysis && (goal === "behavior_risk" || goal === "general_health")) investigateBehavior(state, input.data);
  if (!state.stop_reason) state.stop_reason = state.anomalies.length ? "达到诊断深度或证据充分" : "未达到可解释异常阈值";
  state.continue_analysis = false;
  return state;
}

function investigateRefunds(state: DiagnosisState, data: BusinessDataModel) {
  const change = state.comparison.changes.refund_to_payment_ratio.percentage_point_change;
  const amountDelta = state.comparison.changes.successful_refund_amount_cents.absolute_change;
  const exceedsThreshold = change !== null && change >= REFUND_PP_THRESHOLD && amountDelta >= MIN_DELTA_CENTS;
  if (exceedsThreshold) {
    const anomaly = makeAnomaly("refund_ratio_increase", "high", state, `退款率上升 ${(change * 100).toFixed(1)} 个百分点，成功退款金额增加 ${amountDelta} 分`);
    state.anomalies.push(anomaly);
    state.confirmed_facts.push(anomaly.trigger);
  } else {
    state.confirmed_facts.push("退款变化未同时达到当前预警阈值，仍按商品、渠道和退款原因完成归因比较。");
  }

  const products = calculateContributions(data, state.query, "refund", "product");
  state.contributions.push(...products);
  state.analyzed_dimensions.push("product"); state.depth++;
  const top = largestContribution(products, "positive");
  step(state, "analyze_contribution", "用户要求分析退款变化，按退款金额变化拆分商品贡献。", "product", top ? `${top.value} 退款变化 ${top.delta_amount_cents} 分，占总变化 ${percent(top.contribution_ratio)}` : "无商品贡献");
  if (!top || state.depth >= MAX_DEPTH) return;

  const channels = calculateContributions(data, state.query, "refund", "channel");
  state.contributions.push(...channels);
  state.analyzed_dimensions.push("channel"); state.depth++;
  const channel = largestContribution(channels, "positive");
  step(state, "drill_down_anomaly", "按订单所属渠道汇总退款变化，确认是否集中。", "channel", channel ? `${channel.value} 退款变化 ${channel.delta_amount_cents} 分，占总变化 ${percent(channel.contribution_ratio)}` : "无渠道贡献");
  if (!channel || state.depth >= MAX_DEPTH) return;

  const productId = productIdByName(data, top.value);
  if (!productId) return;
  const reasons = calculateContributions(data, { ...state.query, product_id: productId, channel: channel.value }, "refund", "refund_reason");
  state.contributions.push(...reasons);
  state.analyzed_dimensions.push("refund_reason"); state.depth++;
  const reason = largestContribution(reasons, "positive");
  step(state, "get_anomaly_evidence", "退款已按商品、渠道和退款原因完成聚合比较。", "refund_reason", reason ? `${reason.value} 退款变化 ${reason.delta_amount_cents} 分` : "无退款原因数据");
  state.evidence.push({ source: "refund_records", summary: `${top.value} / ${channel.value} 的退款原因已按成功退款完成时间聚合。` });
  state.uncertainties.push("退款原因来自结构化售后记录，不能单独证明课程质量、营销承诺或履约问题。");
}

function investigateRefundContribution(state: DiagnosisState, data: BusinessDataModel) {
  const products = calculateContributions(data, state.query, "refund", "product");
  normalizeRefundRankingContribution(products);
  state.contributions.push(...products);
  state.analyzed_dimensions.push("product");
  const increased = products.filter((item) => item.delta_amount_cents > 0);
  const topIncrease = increased[0];

  if (topIncrease) {
    state.confirmed_facts.push(
      `退款增长最多的商品是 ${topIncrease.value}，退款金额增加 ${topIncrease.delta_amount_cents} 分，当前 ${topIncrease.current_amount_cents} 分、上一周期 ${topIncrease.previous_amount_cents} 分。`
    );
    step(state, "analyze_contribution", "用户要求比较商品对退款变化的贡献，直接按商品汇总等长周期退款金额。", "product", `${topIncrease.value} 退款增加 ${topIncrease.delta_amount_cents} 分，占整体退款变化 ${percent(topIncrease.contribution_ratio)}`);
  } else {
    const topChange = [...products].sort((a, b) => Math.abs(b.delta_amount_cents) - Math.abs(a.delta_amount_cents))[0];
    state.confirmed_facts.push(
      topChange
        ? `当前没有商品退款金额增长。退款变化最大的商品是 ${topChange.value}，变化 ${topChange.delta_amount_cents} 分。`
        : "当前查询范围内没有可用于商品退款比较的记录。"
    );
    step(state, "analyze_contribution", "用户要求商品退款变化排名，当前没有正向退款增量，返回退款变化排名。", "product", topChange ? `${topChange.value} 退款变化 ${topChange.delta_amount_cents} 分` : "无商品退款记录");
  }
  state.stop_reason = "已完成商品退款跨周期贡献比较";
}

function normalizeRefundRankingContribution(products: ReturnType<typeof calculateContributions>) {
  const increased = products.filter((item) => item.delta_amount_cents > 0);
  if (increased.length) {
    const totalIncrease = increased.reduce((sum, item) => sum + item.delta_amount_cents, 0);
    for (const item of products) item.contribution_ratio = item.delta_amount_cents > 0 ? item.delta_amount_cents / totalIncrease : null;
    return;
  }

  const totalChange = products.reduce((sum, item) => sum + Math.abs(item.delta_amount_cents), 0);
  for (const item of products) item.contribution_ratio = totalChange ? Math.abs(item.delta_amount_cents) / totalChange : null;
}

function investigateChannelDecline(state: DiagnosisState, data: BusinessDataModel) {
  const channels = calculateContributions(data, state.query, "payment", "channel");
  const named = channels.find((item) => state.user_question.includes(item.value));
  const declined = named || channels.find((item) => item.delta_amount_cents <= -MIN_DELTA_CENTS && item.previous_amount_cents > 0 && item.delta_amount_cents / item.previous_amount_cents <= -CHANNEL_DECLINE_THRESHOLD);
  if (!declined) return;
  const exceedsThreshold = declined.delta_amount_cents <= -MIN_DELTA_CENTS
    && declined.previous_amount_cents > 0
    && declined.delta_amount_cents / declined.previous_amount_cents <= -CHANNEL_DECLINE_THRESHOLD;
  if (exceedsThreshold) {
    const anomaly = makeAnomaly("channel_sales_decline", "medium", state, `${declined.value} 成功支付金额较上一周期下降 ${percent(Math.abs(declined.delta_amount_cents / declined.previous_amount_cents))}`, { channel: declined.value });
    state.anomalies.push(anomaly); state.confirmed_facts.push(anomaly.trigger);
  } else {
    state.confirmed_facts.push(`${declined.value} 的成功支付金额发生变化，但未达到当前渠道预警阈值。`);
  }
  state.contributions.push(...channels);
  if (!state.analyzed_dimensions.includes("channel")) { state.analyzed_dimensions.push("channel"); state.depth++; }
  step(state, "analyze_contribution", "用户关注渠道销售变化，按渠道和商品拆分支付金额变化。", "channel", `${declined.value} 变化 ${declined.delta_amount_cents} 分`);
  if (state.depth >= MAX_DEPTH) return;
  const products = calculateContributions(data, { ...state.query, channel: declined.value }, "payment", "product");
  state.contributions.push(...products); state.analyzed_dimensions.push("product"); state.depth++;
  const top = largestContribution(products, "negative");
  step(state, "drill_down_anomaly", `继续拆分${declined.value}内商品的支付金额变化。`, "product", top ? `${top.value} 支付金额变化 ${top.delta_amount_cents} 分` : "无商品贡献");
  state.uncertainties.push("当前数据没有访问量、投放或转化漏斗，不能把支付金额下降直接归因为流量或转化问题。");
}

function investigateProductChange(state: DiagnosisState, data: BusinessDataModel) {
  const products = calculateContributions(data, state.query, "payment", "product");
  const largest = [...products].sort((a, b) => Math.abs(b.delta_amount_cents) - Math.abs(a.delta_amount_cents))[0];
  if (!largest || Math.abs(largest.delta_amount_cents) < MIN_DELTA_CENTS) {
    state.confirmed_facts.push("商品支付金额变化未达到继续调查阈值。");
    return;
  }
  const direction = largest.delta_amount_cents >= 0 ? "增加" : "减少";
  const item = makeAnomaly("product_sales_change", "medium", state, `${largest.value} 成功支付金额较上一周期${direction} ${Math.abs(largest.delta_amount_cents)} 分`, { product_id: productIdByName(data, largest.value) });
  state.anomalies.push(item); state.confirmed_facts.push(item.trigger); state.contributions.push(...products);
  state.analyzed_dimensions.push("product"); state.depth++;
  step(state, "analyze_contribution", "用户关注商品表现，按支付金额绝对变化选出最大商品。", "product", `${largest.value} ${direction} ${Math.abs(largest.delta_amount_cents)} 分`);
  state.uncertainties.push("商品支付金额变化不等于销量、访问量或课程质量变化；需要结合流量、活动和履约数据复核。");
}

function investigateBehavior(state: DiagnosisState, data: BusinessDataModel) {
  const counts = new Map<string, number>();
  for (const order of data.orders) {
    const date = order.created_at.slice(0, 10);
    if (date >= state.query.start_date && date <= state.query.end_date) counts.set(`${order.customer_id}|${date}`, (counts.get(`${order.customer_id}|${date}`) || 0) + 1);
  }
  const signal = [...counts.entries()].find(([, count]) => count >= 7);
  if (!signal) return;
  const [key, count] = signal; const [customer, date] = key.split("|");
  const item = makeAnomaly("high_frequency_ordering", "medium", state, `${customer} 在 ${date} 创建 ${count} 笔订单`, { customer_id: customer, date });
  state.anomalies.push(item); state.confirmed_facts.push(`${item.trigger}，属于待复核行为信号。`);
  step(state, "get_anomaly_evidence", "检测到高频行为，仅记录可复核事实，不继续推断主观意图。", "customer", item.trigger);
}

function detectGoal(question: string): DiagnosisGoal {
  if (/(哪个|哪些).*(商品|产品).*(退款|退费).*(增长|增加|影响|贡献|排名)|(退款|退费).*(增长|增加).*(哪个|哪些).*(商品|产品)|商品.*退款.*(增长|增加|贡献|排名)/.test(question)) return "refund_contribution";
  if (/退款|退费/.test(question)) return "refund_increase";
  if (/小程序|渠道.*下降|销售额.*下降/.test(question)) return "channel_decline";
  if (/商品.*变化|销量/.test(question)) return "product_change";
  if (/高频|异常购买|刷单/.test(question)) return "behavior_risk";
  return "general_health";
}
function step(state: DiagnosisState, action: string, reason: string, dimension: any, result: string) { state.steps.push({ step: state.steps.length + 1, action, reason, dimension, result_summary: result }); }
function makeAnomaly(type: DiagnosisAnomaly["type"], severity: DiagnosisAnomaly["severity"], state: DiagnosisState, trigger: string, scope?: DiagnosisAnomaly["scope"]): DiagnosisAnomaly { return { anomaly_id: `${state.diagnosis_id}-${type}`, dataset_id: state.dataset_id, type, severity, title: type === "refund_ratio_increase" ? "退款异常上升" : type === "channel_sales_decline" ? "渠道支付金额下降" : type === "product_sales_change" ? "商品支付金额变化" : "高频购买信号", trigger, facts: [trigger], comparison_id: state.comparison.comparison_id, dimensions: type === "refund_ratio_increase" ? ["product", "channel", "refund_reason"] : type === "channel_sales_decline" ? ["channel", "product"] : type === "product_sales_change" ? ["product"] : ["customer"], scope }; }
function productIdByName(data: BusinessDataModel, name: string) { return data.products.find((product) => product.product_name === name)?.product_id; }
function largestContribution(items: ReturnType<typeof calculateContributions>, preference: "positive" | "negative") {
  const preferred = items.filter((item) => preference === "positive" ? item.delta_amount_cents > 0 : item.delta_amount_cents < 0);
  return [...(preferred.length ? preferred : items)].sort((a, b) => Math.abs(b.delta_amount_cents) - Math.abs(a.delta_amount_cents))[0];
}
function percent(value: number | null) { return value === null ? "不可计算" : `${(value * 100).toFixed(1)}%`; }
function summaryComparison(comparison: any) { return `支付 ${comparison.current.successful_payment_amount_cents} 分，退款 ${comparison.current.successful_refund_amount_cents} 分，退款率变化 ${comparison.changes.refund_to_payment_ratio.percentage_point_change === null ? "不可计算" : `${(comparison.changes.refund_to_payment_ratio.percentage_point_change * 100).toFixed(1)} 个百分点`}`; }
