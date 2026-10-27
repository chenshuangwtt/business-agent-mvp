import { getTimeMode } from "../utils/timeMode.js";
import type {
  BusinessBreakdown,
  BusinessBreakdownRow,
  BusinessHighlight,
  BusinessMetric,
  BusinessMetricDirection,
  BusinessMetricStatus,
  BusinessPresentation,
} from "../agent/types.js";
import type { AnalysisDimension, DiagnosisState, DimensionContribution } from "./types.js";

const dimensionLabels: Record<AnalysisDimension, string> = {
  overall: "整体",
  product: "商品",
  channel: "销售渠道",
  region: "地区",
  refund_reason: "退款原因",
  customer: "客户",
};

export function buildBusinessPresentation(
  diagnosis: DiagnosisState,
  recordCount?: number
): BusinessPresentation {
  const { comparison, anomalies } = diagnosis;
  const current = comparison.current;
  const changes = comparison.changes;
  const refundQuestion = diagnosis.goal === "refund_increase" || diagnosis.goal === "refund_contribution";
  const channelQuestion = diagnosis.goal === "channel_decline";
  const salesQuestion = channelQuestion || diagnosis.goal === "product_change";
  normalizeDisplayContributions(diagnosis, refundQuestion ? "positive" : "negative");
  const primaryProduct = selectContribution(diagnosis, "product", refundQuestion ? "positive" : salesQuestion ? "negative" : "absolute");
  const primaryChannel = selectNamedContribution(diagnosis, "channel", channelQuestion ? "negative" : refundQuestion ? "positive" : "absolute");
  const primaryReason = selectContribution(diagnosis, "refund_reason", "positive");

  const metrics = refundQuestion
    ? refundMetrics(diagnosis, primaryProduct)
    : channelQuestion && primaryChannel
      ? channelMetrics(diagnosis, primaryChannel, primaryProduct)
      : salesQuestion
        ? salesMetrics(diagnosis, primaryProduct)
        : overviewMetrics(diagnosis);
  const breakdowns = buildBreakdowns(diagnosis, refundQuestion, salesQuestion);
  const conclusions = buildConclusions(diagnosis, primaryProduct, primaryChannel, primaryReason);
  const analysis = buildAnalysis(diagnosis, primaryProduct, primaryChannel, primaryReason);
  const recommendations = recommendationLines(diagnosis, primaryProduct, primaryChannel);
  const summary = conclusions[0] || "当前查询范围内没有足够数据生成经营结论。";
  const highlights = buildHighlights(diagnosis, primaryProduct, primaryChannel);

  return {
    summary,
    summaryStatus: summaryStatus(diagnosis, primaryProduct),
    conclusions,
    period: toPeriod(current.period),
    comparisonPeriod: toPeriod(comparison.previous.period),
    metrics: metrics.filter((metric): metric is BusinessMetric => metric !== null),
    highlights,
    breakdowns,
    analysis,
    recommendations,
    detailMarkdown: buildDetailMarkdown(diagnosis),
    dataContext: {
      label: `数据依据：${current.period.label} 的订单、支付和退款记录${recordCount === undefined ? "" : `，共 ${recordCount} 笔订单`}；对照周期为 ${comparison.previous.period.label}。`,
      dataNature: getTimeMode() === "demo" ? "sample" : "production",
    },
  };
}

function refundMetrics(diagnosis: DiagnosisState, product?: DimensionContribution): Array<BusinessMetric | null> {
  const { current, previous, changes } = diagnosis.comparison;
  return [
    observationMoneyMetric("current_refund_amount", "当前周期退款金额", current.successful_refund_amount_cents, "当前观察窗口"),
    observationMoneyMetric("previous_refund_amount", "上一周期退款金额", previous.successful_refund_amount_cents, "对照周期"),
    changeMoneyMetric("refund_amount_change", "退款金额变化", changes.successful_refund_amount_cents.absolute_change),
    diagnosis.goal === "refund_contribution"
      ? contributionMetric(product, "退款增量最大商品", "商品退款增长")
      : ratioMetric(current.refund_to_payment_ratio, changes.refund_to_payment_ratio.percentage_point_change),
  ];
}

function channelMetrics(
  diagnosis: DiagnosisState,
  channel: DimensionContribution,
  product?: DimensionContribution
): Array<BusinessMetric | null> {
  return [
    observationMoneyMetric("focus_payment_current", `${channel.value}成功支付金额`, channel.current_amount_cents, "当前观察窗口"),
    observationMoneyMetric("focus_payment_previous", `${channel.value}上一周期支付金额`, channel.previous_amount_cents, "对照周期"),
    changeMoneyMetric("focus_payment_change", `${channel.value}支付金额变化`, channel.delta_amount_cents),
    contributionMetric(product, "主要下降商品", "该渠道支付金额变化"),
  ];
}

function salesMetrics(diagnosis: DiagnosisState, product?: DimensionContribution): Array<BusinessMetric | null> {
  const { current, changes } = diagnosis.comparison;
  return [
    moneyMetric("successful_payment_amount", "成功支付金额", current.successful_payment_amount_cents, changes.successful_payment_amount_cents),
    moneyMetric("net_cash_inflow", "净现金流入", current.net_cash_inflow_cents, changes.net_cash_inflow_cents),
    moneyMetric("successful_refund_amount", "成功退款金额", current.successful_refund_amount_cents, changes.successful_refund_amount_cents),
    contributionMetric(product, "主要变化商品", "成功支付金额变化"),
  ];
}

function overviewMetrics(diagnosis: DiagnosisState): Array<BusinessMetric | null> {
  const { current, changes } = diagnosis.comparison;
  return [
    moneyMetric("successful_payment_amount", "成功支付金额", current.successful_payment_amount_cents, changes.successful_payment_amount_cents),
    moneyMetric("successful_refund_amount", "成功退款金额", current.successful_refund_amount_cents, changes.successful_refund_amount_cents),
    ratioMetric(current.refund_to_payment_ratio, changes.refund_to_payment_ratio.percentage_point_change),
    moneyMetric("net_cash_inflow", "净现金流入", current.net_cash_inflow_cents, changes.net_cash_inflow_cents),
  ];
}

function moneyMetric(
  id: string,
  label: string,
  currentCents: number,
  change: { previous: number; absolute_change: number; change_rate: number | null }
): BusinessMetric {
  return {
    id,
    label,
    value: currentCents / 100,
    unit: "CNY",
    previousValue: change.previous / 100,
    changeValue: change.absolute_change / 100,
    changeRate: change.change_rate,
    direction: direction(change.absolute_change),
    status: semanticStatus(label, change.change_rate),
  };
}

function observationMoneyMetric(id: string, label: string, cents: number, description: string): BusinessMetric {
  return { id, label, value: cents / 100, unit: "CNY", direction: "stable", status: "neutral", description };
}

function changeMoneyMetric(id: string, label: string, cents: number): BusinessMetric {
  return {
    id,
    label,
    value: Math.abs(cents) / 100,
    unit: "CNY",
    changeValue: cents / 100,
    direction: direction(cents),
    status: changeStatus(cents === 0 ? 0 : 0.1),
    description: cents === 0 ? "与对照周期持平" : undefined,
  };
}

function ratioMetric(value: number | null, percentagePointChange: number | null): BusinessMetric {
  return {
    id: "refund_to_payment_ratio",
    label: "退款支付金额比",
    value,
    unit: "percent",
    percentagePointChange,
    direction: direction(percentagePointChange),
    status: percentagePointChange === null ? "unknown" : changeStatus(percentagePointChange),
  };
}

function contributionMetric(source: DimensionContribution | undefined, label: string, subject: string): BusinessMetric | null {
  if (!source || source.contribution_ratio === null) return null;
  return {
    id: "primary_contribution_ratio",
    label,
    value: Math.abs(source.contribution_ratio),
    unit: "percent",
    direction: "stable",
    status: "neutral",
    description: `${source.value} 占${subject}的 ${Math.abs(source.contribution_ratio * 100).toFixed(1)}%`,
  };
}

function buildBreakdowns(diagnosis: DiagnosisState, refundQuestion: boolean, salesQuestion: boolean): BusinessBreakdown[] {
  const items: BusinessBreakdown[] = [];
  if (refundQuestion) {
    pushBreakdown(items, diagnosis, "product", "商品退款变化", "按退款金额变化排序，展示最主要的商品贡献。", "positive");
    pushBreakdown(items, diagnosis, "channel", "渠道退款变化", "按退款所属订单的销售渠道汇总。", "positive");
    pushBreakdown(items, diagnosis, "refund_reason", "退款原因分布", "仅展示结构化退款记录中变化最明显的原因。", "positive", "table");
  } else if (salesQuestion || diagnosis.contributions.length) {
    const channel = selectContribution(diagnosis, "channel", "negative");
    const productTitle = diagnosis.goal === "general_health" && channel
      ? `${channel.value}渠道内商品支付金额变化`
      : "商品支付金额变化";
    const productDescription = diagnosis.goal === "general_health" && channel
      ? "在支付金额变化最明显的渠道内，按商品拆分主要构成。"
      : "按成功支付金额变化排序，展示主要构成。";
    pushBreakdown(items, diagnosis, "product", productTitle, productDescription, "negative");
    pushBreakdown(items, diagnosis, "channel", "渠道支付金额变化", "按销售渠道汇总，便于判断变化是否集中。", "negative");
  }
  return items.slice(0, 3);
}

function pushBreakdown(
  target: BusinessBreakdown[],
  diagnosis: DiagnosisState,
  dimension: AnalysisDimension,
  title: string,
  description: string,
  preference: "positive" | "negative" | "absolute",
  display?: "bar" | "table"
) {
  const rows = rowsFor(diagnosis, dimension, preference);
  if (!rows.length) return;
  target.push({
    id: `${dimension}-${preference}`,
    title,
    description,
    display: display || (rows.length > 1 ? "bar" : "table"),
    rows,
  });
}

function rowsFor(
  diagnosis: DiagnosisState,
  dimension: AnalysisDimension,
  preference: "positive" | "negative" | "absolute"
): BusinessBreakdownRow[] {
  const contributions = diagnosis.contributions.filter((item) => item.dimension === dimension && item.delta_amount_cents !== 0);
  const preferred = preference === "positive"
    ? contributions.filter((item) => item.delta_amount_cents > 0)
    : preference === "negative"
      ? contributions.filter((item) => item.delta_amount_cents < 0)
      : contributions;
  const candidates = preferred.length ? preferred : contributions;
  return [...candidates]
    .sort((a, b) => Math.abs(b.delta_amount_cents) - Math.abs(a.delta_amount_cents))
    .slice(0, 3)
    .map((item) => ({
      label: item.value,
      currentValue: item.current_amount_cents / 100,
      previousValue: item.previous_amount_cents / 100,
      changeValue: item.delta_amount_cents / 100,
      contributionRatio: item.contribution_ratio,
      direction: direction(item.delta_amount_cents),
    }));
}

function buildConclusions(
  diagnosis: DiagnosisState,
  product?: DimensionContribution,
  channel?: DimensionContribution,
  reason?: DimensionContribution
): string[] {
  const { current, changes } = diagnosis.comparison;
  const lines: string[] = [];
  if (diagnosis.goal === "refund_contribution") {
    if (product) lines.push(product.delta_amount_cents > 0
      ? `退款增长最多的商品是“${product.value}”，退款增加 ${currency(product.delta_amount_cents)}，占商品退款增长合计 ${share(product)}。`
      : `当前没有商品退款金额增长；退款变化最大的商品是“${product.value}”，变化 ${currency(product.delta_amount_cents)}。`);
  } else if (diagnosis.goal === "refund_increase") {
    lines.push(`成功退款金额${changeText(changes.successful_refund_amount_cents.absolute_change)} ${currency(changes.successful_refund_amount_cents.absolute_change)}${rateSuffix(changes.successful_refund_amount_cents.change_rate)}。`);
    if (changes.refund_to_payment_ratio.percentage_point_change !== null) {
      lines.push(`退款支付金额比为 ${percent(current.refund_to_payment_ratio)}，较对照周期${changes.refund_to_payment_ratio.percentage_point_change >= 0 ? "上升" : "下降"} ${Math.abs(changes.refund_to_payment_ratio.percentage_point_change * 100).toFixed(1)} 个百分点。`);
    }
  } else if (diagnosis.goal === "channel_decline" && channel) {
    lines.push(`${channel.value}成功支付金额${changeText(channel.delta_amount_cents)} ${currency(channel.delta_amount_cents)}，当前为 ${currency(channel.current_amount_cents)}、上一周期为 ${currency(channel.previous_amount_cents)}。`);
  } else {
    lines.push(`成功支付金额${changeText(changes.successful_payment_amount_cents.absolute_change)} ${currency(changes.successful_payment_amount_cents.absolute_change)}${rateSuffix(changes.successful_payment_amount_cents.change_rate)}；退款金额${changeText(changes.successful_refund_amount_cents.absolute_change)} ${currency(changes.successful_refund_amount_cents.absolute_change)}${rateSuffix(changes.successful_refund_amount_cents.change_rate)}。`);
  }

  if (product && diagnosis.goal !== "refund_contribution") {
    const scope = diagnosis.goal === "general_health" && channel ? `在“${channel.value}”渠道内，` : "";
    lines.push(`${scope}${dimensionLabels[product.dimension]}“${product.value}”是主要变化来源，变化 ${currency(product.delta_amount_cents)}${product.contribution_ratio === null ? "。" : `，${contributionContext(diagnosis, product.dimension)} ${share(product)}。`}`);
  }
  if (channel && diagnosis.goal !== "channel_decline") lines.push(`${dimensionLabels[channel.dimension]}“${channel.value}”变化 ${currency(channel.delta_amount_cents)}${channel.contribution_ratio === null ? "。" : `，${contributionContext(diagnosis, channel.dimension)} ${share(channel)}。`}`);
  if (reason && diagnosis.goal === "refund_increase") lines.push(`结构化退款记录中，“${reason.value}”的退款变化最明显；这只能说明退款记录的分布，不能单独确认具体业务原因。`);

  if (!diagnosis.anomalies.length) lines.push("当前未触发既定预警阈值，但上述周期变化和归因结果仍可用于后续复核。");
  return lines.slice(0, 4);
}

function buildAnalysis(
  diagnosis: DiagnosisState,
  product?: DimensionContribution,
  channel?: DimensionContribution,
  reason?: DimensionContribution
): string[] {
  if (diagnosis.goal === "refund_increase" || diagnosis.goal === "refund_contribution") {
    const sourceText = product
      ? `商品维度中，“${product.value}”${changeText(product.delta_amount_cents)} ${currency(product.delta_amount_cents)}。`
      : "当前没有足够的商品退款记录用于拆分变化来源。";
    const channelText = channel
      ? `渠道维度中，“${channel.value}”${changeText(channel.delta_amount_cents)} ${currency(channel.delta_amount_cents)}。`
      : "渠道维度暂未形成可比较的集中变化。";
    const reasonText = reason
      ? `退款原因记录显示“${reason.value}”变化最明显，但现有数据无法判断其是否由商品内容、销售宣传或售后流程导致。`
      : "现有记录不足以确认具体退款原因，需要结合售后或投诉信息进一步核实。";
    return [sourceText, `${channelText}${reasonText}`];
  }
  if (diagnosis.goal === "channel_decline") {
    const productText = product
      ? `渠道内的主要变化来自“${product.value}”，成功支付金额${changeText(product.delta_amount_cents)} ${currency(product.delta_amount_cents)}。`
      : "当前没有足够的商品明细用于继续拆分该渠道的变化。";
    return [productText, "现有数据可以确认支付金额的构成变化，但没有访问量、投放和转化数据，不能将下降直接归因为流量或转化问题。"];
  }
  if (diagnosis.goal === "product_change" && product) {
    return [`“${product.value}”是支付金额变化最大的商品，变化 ${currency(product.delta_amount_cents)}。`, "支付金额变化不等于销量、访问量或商品质量变化；还需要结合流量、活动和履约数据复核。"];
  }
  const sourceText = product && channel
    ? `支付金额变化主要集中在“${channel.value}”渠道；在该渠道内，“${product.value}”变化最明显。`
    : "当前未形成可比较的商品或渠道集中变化。";
  return [
    "本次结果以等长周期的支付和退款记录比较得出，未将缺失日期按零值处理。",
    `${sourceText}${diagnosis.anomalies.length ? " 已识别到需要复核的信号，具体归因以拆分结果为准。" : " 未触发当前预警规则，但重点指标仍应结合下一观察周期持续比较。"}`,
  ];
}

function recommendationLines(
  diagnosis: DiagnosisState,
  product?: DimensionContribution,
  channel?: DimensionContribution
): string[] {
  if (diagnosis.goal === "refund_increase" || diagnosis.goal === "refund_contribution") {
    const target = product ? `优先抽查“${product.value}”` : "优先抽查退款变化较大的商品";
    return [
      `${target}的退款订单，核对退款原因、购买渠道和售后记录是否集中。`,
      channel ? `结合“${channel.value}”渠道的活动、商品说明和售后记录复核退款变化。` : "补充售后或投诉记录后，再判断退款增长是否集中于特定业务环节。",
    ];
  }
  if (diagnosis.goal === "channel_decline") {
    return [
      "核对该渠道当前周期与对照周期的投放、价格、库存和页面状态。",
      product ? `优先复核“${product.value}”在该渠道的商品供给、活动和转化记录。` : "补充商品维度的渠道数据后，再定位主要下降来源。",
    ];
  }
  if (diagnosis.goal === "product_change" && product) return [`复核“${product.value}”的价格、库存、活动和渠道分布，再与下一周期的支付结果交叉验证。`];
  return ["维持当前周期口径，下一观察窗口继续对比支付金额、退款金额和退款支付金额比。"];
}

function buildHighlights(
  diagnosis: DiagnosisState,
  product?: DimensionContribution,
  channel?: DimensionContribution
): BusinessHighlight[] {
  const highlights: BusinessHighlight[] = [];
  if (product) highlights.push({
    title: diagnosis.goal === "refund_contribution" ? "退款增长最多的商品" : "主要商品贡献",
    content: `“${product.value}”变化 ${currency(product.delta_amount_cents)}${product.contribution_ratio === null ? "。" : `，${contributionContext(diagnosis, product.dimension)} ${share(product)}。`}`,
    severity: "medium",
    status: "neutral",
  });
  if (channel) highlights.push({
    title: "主要渠道贡献",
    content: `“${channel.value}”变化 ${currency(channel.delta_amount_cents)}${channel.contribution_ratio === null ? "。" : `，${contributionContext(diagnosis, channel.dimension)} ${share(channel)}。`}`,
    severity: "medium",
    status: "neutral",
  });
  return highlights.slice(0, 2);
}

function buildDetailMarkdown(diagnosis: DiagnosisState): string {
  const groups = [...new Set(diagnosis.contributions.map((item) => item.dimension))]
    .map((dimension) => ({
      dimension,
      items: diagnosis.contributions
        .filter((item) => item.dimension === dimension && item.delta_amount_cents !== 0)
        .sort((a, b) => Math.abs(b.delta_amount_cents) - Math.abs(a.delta_amount_cents))
        .slice(0, 5),
    }))
    .filter((group) => group.items.length > 0);
  return [
    "## 完整分析依据",
    ...(diagnosis.confirmed_facts.length ? diagnosis.confirmed_facts.map((fact) => `- ${formatFact(fact)}`) : ["- 当前未发现满足预警规则的明显异常。"]),
    ...(groups.length ? ["", "## 更多维度明细", ...groups.map((group) => `- ${dimensionLabels[group.dimension]}：${group.items.map((item) => `${item.value}（变化 ${currency(item.delta_amount_cents)}）`).join("；")}`)] : []),
    ...(diagnosis.uncertainties.length ? ["", "## 分析限制", ...diagnosis.uncertainties.map((item) => `- ${item}`)] : []),
  ].join("\n");
}

function selectNamedContribution(
  diagnosis: DiagnosisState,
  dimension: AnalysisDimension,
  preference: "positive" | "negative" | "absolute"
): DimensionContribution | undefined {
  const named = diagnosis.contributions.find((item) => item.dimension === dimension && diagnosis.user_question.includes(item.value));
  return named || selectContribution(diagnosis, dimension, preference);
}

function normalizeDisplayContributions(diagnosis: DiagnosisState, preference: "positive" | "negative") {
  const dimensions = [...new Set(diagnosis.contributions.map((item) => item.dimension))];
  for (const dimension of dimensions) {
    const items = diagnosis.contributions.filter((item) => item.dimension === dimension);
    const preferred = items.filter((item) => preference === "positive" ? item.delta_amount_cents > 0 : item.delta_amount_cents < 0);
    const basis = preferred.length ? preferred : items.filter((item) => item.delta_amount_cents !== 0);
    const total = basis.reduce((sum, item) => sum + Math.abs(item.delta_amount_cents), 0);
    for (const item of items) item.contribution_ratio = basis.includes(item) && total ? Math.abs(item.delta_amount_cents) / total : null;
  }
}

function selectContribution(
  diagnosis: DiagnosisState,
  dimension: AnalysisDimension,
  preference: "positive" | "negative" | "absolute"
): DimensionContribution | undefined {
  const candidates = diagnosis.contributions.filter((item) => item.dimension === dimension);
  const preferred = preference === "positive"
    ? candidates.filter((item) => item.delta_amount_cents > 0)
    : preference === "negative"
      ? candidates.filter((item) => item.delta_amount_cents < 0)
      : candidates;
  return [...(preferred.length ? preferred : candidates)].sort((a, b) => Math.abs(b.delta_amount_cents) - Math.abs(a.delta_amount_cents))[0];
}

function summaryStatus(diagnosis: DiagnosisState, product?: DimensionContribution): BusinessMetricStatus {
  if (diagnosis.goal === "refund_contribution") return product?.delta_amount_cents && product.delta_amount_cents > 0 ? "warning" : "neutral";
  if (!diagnosis.anomalies.length) return "neutral";
  return diagnosis.anomalies.some((item) => item.type === "high_frequency_ordering") ? "warning" : "unfavorable";
}

function changeStatus(value: number | null): BusinessMetricStatus {
  if (value === null) return "unknown";
  if (Math.abs(value) < 0.00001) return "neutral";
  return "warning";
}

function semanticStatus(label: string, value: number | null): BusinessMetricStatus {
  if (value === null) return "unknown";
  if (Math.abs(value) < 0.00001) return "neutral";
  const refundMetric = label.includes("退款");
  const favorable = refundMetric ? value < 0 : value > 0;
  return favorable ? "favorable" : "unfavorable";
}

function direction(value: number | null): BusinessMetricDirection {
  if (value === null || !Number.isFinite(value)) return "unknown";
  if (Math.abs(value) < 0.00001) return "stable";
  return value > 0 ? "up" : "down";
}

function changeText(cents: number): string { return cents >= 0 ? "增加" : "减少"; }
function rateSuffix(value: number | null): string { return value === null ? "" : `，较对照周期${value >= 0 ? "上升" : "下降"} ${Math.abs(value * 100).toFixed(1)}%`; }
function currency(cents: number): string { return `¥${Math.abs(cents / 100).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; }
function percent(value: number | null): string { return value === null ? "暂无可比基数" : `${(value * 100).toFixed(1)}%`; }
function share(source: DimensionContribution): string { return source.contribution_ratio === null ? "暂无可比基数" : `${Math.abs(source.contribution_ratio * 100).toFixed(1)}%`; }
function contributionContext(diagnosis: DiagnosisState, dimension: AnalysisDimension): string {
  if (diagnosis.goal === "refund_increase" || diagnosis.goal === "refund_contribution") return `占${dimensionLabels[dimension]}退款增长合计`;
  if (diagnosis.goal === "channel_decline") return `占${dimensionLabels[dimension]}支付金额下降合计`;
  return `占${dimensionLabels[dimension]}支付金额下降合计`;
}
function formatFact(text: string): string { return text.replace(/(-?\d+)\s*分/g, (_match, cents) => `${Number(cents) < 0 ? "减少 " : "增加 "}${currency(Number(cents))}`); }
function toPeriod(period: { start_date: string; end_date: string; label: string }) { return { startDate: period.start_date, endDate: period.end_date, label: period.label }; }
