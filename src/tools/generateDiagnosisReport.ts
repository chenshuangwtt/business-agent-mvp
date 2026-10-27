import { z } from "zod";
import { getDataset } from "../business/datasetStore.js";
import { compareMetricPeriods } from "../business/metrics.js";
import { buildBusinessPresentation } from "../business/presentation.js";
import { getDiagnosisState } from "./diagnoseBusiness.js";
import type { AgentTool, BusinessMetric, BusinessPresentation, ToolContext } from "../agent/types.js";

const InputSchema = z.object({ dataset_id: z.string(), diagnosis_id: z.string().optional(), anomaly_ids: z.array(z.string()).default([]) });
const dimensionLabels: Record<string, string> = {
  product: "商品",
  channel: "销售渠道",
  region: "地区",
  refund_reason: "退款原因",
  customer: "客户",
};

function formatCurrency(cents: number): string {
  return `¥${(cents / 100).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatFact(text: string): string {
  return text.replace(/(-?\d+)\s*分/g, (_match, cents) => formatCurrency(Number(cents)));
}

function formatChange(value: number | null): string {
  return value === null ? "与对照周期相比不可计算" : `${value >= 0 ? "增加" : "减少"} ${Math.abs(value * 100).toFixed(1)}%`;
}

function isMethodologyRequest(question: string | undefined): boolean {
  return /计算依据|统计口径|指标口径|公式|怎么算|如何计算/.test(question || "");
}
export const generateDiagnosisReportTool: AgentTool = {
  name: "generate_diagnosis_report",
  description: "基于数据集和同期指标生成可追溯的经营异常诊断报告，不使用无法验证的业务归因。",
  riskLevel: "low",
  requiresApproval: false,
  inputSchema: InputSchema,
  execute: async (args, context: ToolContext) => {
    const { dataset_id, diagnosis_id, anomaly_ids } = InputSchema.parse(args);
    const dataset = getDataset(dataset_id);
    const comparison = compareMetricPeriods(dataset.data, dataset_id, dataset.query);
    const current = comparison.current;
    const diagnosis = diagnosis_id ? getDiagnosisState(diagnosis_id) : undefined;
    const businessPresentation = diagnosis ? buildBusinessPresentation(diagnosis, dataset.recordCount) : undefined;
    if (businessPresentation) {
      const content = buildReportFromPresentation(businessPresentation, diagnosis?.user_question);
      context.logger(`生成诊断报告: ${dataset_id}`);
      return { dataset_id, diagnosis_id, content, comparison, businessPresentation, method: "deterministic_diagnosis_template" };
    }
    const facts = diagnosis?.confirmed_facts || [];
    const isRefundContribution = diagnosis?.goal === "refund_contribution";
    const contributionGroups = diagnosis ? [...new Set(diagnosis.contributions.map((item) => item.dimension))]
      .map((dimension) => ({
        dimension,
        items: diagnosis.contributions
          .filter((item) => item.dimension === dimension && item.delta_amount_cents !== 0)
          .sort((a, b) => Math.abs(b.delta_amount_cents) - Math.abs(a.delta_amount_cents))
          .slice(0, 3),
      }))
      .filter((group) => group.items.length > 0) : [];
    const anomalies = diagnosis?.anomalies || [];
    const recommendations = isRefundContribution
      ? ["优先核查退款增长最多的商品关联的退款原因、销售渠道和售后记录，确认增长是否集中于特定业务环节。"]
      : anomalies.length === 0
      ? ["维持当前监控频率，并在后续周期继续观察退款率、支付金额和渠道表现。"]
      : [
          ...(anomalies.some((item) => item.type === "refund_ratio_increase")
            ? ["优先核查退款增长集中的商品、渠道和退款原因，确认商品说明、履约和售后环节是否存在变化。"] : []),
          ...(anomalies.some((item) => item.type === "channel_sales_decline" || item.type === "product_sales_change")
            ? ["复核相关渠道或商品的投放、库存、价格和页面转化变化，并与下一周期结果交叉验证。"] : []),
          ...(anomalies.some((item) => item.type === "high_frequency_ordering")
            ? ["对高频下单行为进行人工复核，结合支付、售后和营销活动信息判断是否需要处置。"] : []),
        ];
    const report = [
      "# 经营诊断",
      "",
      "## 分析结论",
      ...(isRefundContribution
        ? ["- 当前查询范围内没有可用于商品退款比较的记录。"]
        : anomalies.length
        ? anomalies.map((item) => `- ${item.title}：${formatFact(item.trigger)}`)
        : ["- 当前未发现符合预警规则的明显异常。"]),
      "",
      "## 核心指标及变化",
      `- 分析周期：${current.period.label}`,
      `- 对照周期：${comparison.previous.period.label}`,
      ...(isRefundContribution ? [
        `- 当前周期退款金额：${formatCurrency(current.successful_refund_amount_cents)}`,
        `- 上一周期退款金额：${formatCurrency(comparison.previous.successful_refund_amount_cents)}`,
        `- 退款金额变化：${formatCurrency(Math.abs(comparison.changes.successful_refund_amount_cents.absolute_change))}（${formatChange(comparison.changes.successful_refund_amount_cents.change_rate)}）`,
      ] : [
        `- 成功支付金额：${formatCurrency(current.successful_payment_amount_cents)}（${formatChange(comparison.changes.successful_payment_amount_cents.change_rate)}）`,
        `- 成功退款金额：${formatCurrency(current.successful_refund_amount_cents)}（${formatChange(comparison.changes.successful_refund_amount_cents.change_rate)}）`,
        `- 净现金流入：${formatCurrency(current.net_cash_inflow_cents)}（${formatChange(comparison.changes.net_cash_inflow_cents.change_rate)}）`,
        `- 退款率：${current.refund_to_payment_ratio === null ? "无可计算基数" : `${(current.refund_to_payment_ratio * 100).toFixed(1)}%`}${comparison.changes.refund_to_payment_ratio.percentage_point_change === null ? "" : `，较对照周期${comparison.changes.refund_to_payment_ratio.percentage_point_change >= 0 ? "上升" : "下降"} ${Math.abs(comparison.changes.refund_to_payment_ratio.percentage_point_change * 100).toFixed(1)} 个百分点`}`,
      ]),
      "",
      isRefundContribution ? "## 商品退款变化证据" : "## 异常分析与证据",
      ...(anomalies.length || isRefundContribution ? [
        ...facts.map((item) => `- ${formatFact(item)}`),
        ...(contributionGroups.length ? contributionGroups.flatMap((group) => [
          `- ${dimensionLabels[group.dimension] || group.dimension}：${group.items.map((item) => {
            const contribution = item.contribution_ratio === null
              ? ""
              : `，占该项变化 ${Math.abs(item.contribution_ratio * 100).toFixed(1)}%`;
            return `${item.value}（变化 ${formatCurrency(item.delta_amount_cents)}${contribution}）`;
          }).join("；")}`,
        ]) : []),
      ] : ["- 关键指标与对照周期相比未触发当前预警规则。"]),
      "",
      "## 建议措施",
      ...recommendations.map((item) => `- ${item}`),
      "",
      `数据依据：${current.period.label} 的订单、支付和退款记录，共 ${dataset.recordCount} 笔订单；对照周期为 ${comparison.previous.period.label}。`,
      ...(diagnosis?.uncertainties.length ? ["", "## 分析限制", ...diagnosis.uncertainties.map((item) => `- ${item}`)] : []),
      ...(isMethodologyRequest(diagnosis?.user_question) ? [
        "",
        "## 计算依据",
        "- 支付金额按支付成功时间统计；退款金额按退款完成时间统计。",
        "- 退款率 = 成功退款金额 / 成功支付金额；多商品订单的退款按订单明细金额比例归属。",
      ] : []),
    ].join("\n");
    context.logger(`生成诊断报告: ${dataset_id}`);
    return { dataset_id, diagnosis_id, content: report, comparison, businessPresentation, method: "deterministic_diagnosis_template" };
  },
};

function buildReportFromPresentation(presentation: BusinessPresentation, question?: string): string {
  const breakdowns = presentation.breakdowns.flatMap((breakdown) => [
    `### ${breakdown.title}`,
    breakdown.description,
    "| 项目 | 当前周期 | 对照周期 | 变化 | 贡献 |",
    "| --- | ---: | ---: | ---: | ---: |",
    ...breakdown.rows.map((row) => `| ${row.label} | ${formatMoney(row.currentValue)} | ${formatMoney(row.previousValue)} | ${formatSignedMoney(row.changeValue)} | ${row.contributionRatio === null ? "暂无可比基数" : `${Math.abs(row.contributionRatio * 100).toFixed(1)}%`} |`),
    "",
  ]);
  return [
    "# 经营诊断",
    "",
    "## 核心结论",
    ...presentation.conclusions.map((line) => `- ${line}`),
    "",
    "## 核心指标及变化",
    `- 分析周期：${presentation.period.label}`,
    `- 对照周期：${presentation.comparisonPeriod.label}`,
    ...presentation.metrics.map((metric) => `- ${metric.label}：${formatMetric(metric)}`),
    ...(breakdowns.length ? ["", "## 变化来源分析", ...breakdowns] : []),
    "## 业务解释",
    ...presentation.analysis.map((line) => `- ${line}`),
    "",
    "## 建议措施",
    ...presentation.recommendations.map((line) => `- ${line}`),
    "",
    presentation.dataContext.label,
    ...(isMethodologyRequest(question) ? [
      "",
      "## 计算依据",
      "- 支付金额按支付成功时间统计；退款金额按退款完成时间统计。",
      "- 退款支付金额比 = 成功退款金额 / 成功支付金额；多商品订单的退款按订单明细金额比例归属。",
    ] : []),
  ].join("\n");
}

function formatMetric(metric: BusinessMetric): string {
  if (metric.value === null) return "暂无可比基数";
  const value = metric.unit === "CNY" ? formatMoney(metric.value) : metric.unit === "percent" ? `${(metric.value * 100).toFixed(1)}%` : String(metric.value);
  if (metric.percentagePointChange !== undefined && metric.percentagePointChange !== null) {
    return `${value}（较对照周期${metric.percentagePointChange >= 0 ? "上升" : "下降"} ${Math.abs(metric.percentagePointChange * 100).toFixed(1)} 个百分点）`;
  }
  if (metric.changeRate !== undefined && metric.changeRate !== null) {
    return `${value}（较对照周期${metric.changeRate >= 0 ? "上涨" : "下降"} ${Math.abs(metric.changeRate * 100).toFixed(1)}%）`;
  }
  if (metric.changeValue !== undefined && metric.changeValue !== null && metric.unit === "CNY") return `${value}（${formatSignedMoney(metric.changeValue)}）`;
  return metric.description ? `${value}（${metric.description}）` : value;
}

function formatMoney(value: number): string {
  return `¥${Math.abs(value).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatSignedMoney(value: number): string {
  return `${value >= 0 ? "增加" : "减少"} ${formatMoney(value)}`;
}
