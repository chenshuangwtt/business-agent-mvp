import { readFileSync } from "fs";
import { join } from "path";
import { z } from "zod";
import {
  createChatCompletionWithFallback,
  getAvailableLLMConfigs,
  loadReportPrompt,
} from "../llm/llmClient.js";
import type { AgentTool, ToolContext } from "../agent/types.js";
import { cleanMarkdownOutput } from "../utils/markdown.js";

const LLM_TIMEOUT_MS = parseInt(process.env.LLM_TIMEOUT_MS || "30000");

const InputSchema = z.object({
  metrics: z.any().describe("经营指标数据"),
  anomalies: z.array(z.any()).describe("异常发现列表"),
  rules: z.array(z.any()).optional().describe("相关业务规则"),
  template: z.string().default("经营分析简报").describe("报告模板名称"),
  period: z
    .object({
      start_date: z.string().optional(),
      end_date: z.string().optional(),
      label: z.string().optional(),
    })
    .optional()
    .describe("报告周期，优先使用工具查询周期"),
});

export const generateReportTool: AgentTool = {
  name: "generate_report",
  description:
    "根据指标、异常、业务规则和模板生成 Markdown 经营分析报告。可使用 LLM 生成，无 LLM 时使用本地模板 fallback。",
  riskLevel: "low",
  requiresApproval: false,
  inputSchema: InputSchema,
  execute: async (args, context: ToolContext) => {
    const { metrics, anomalies, rules, template, period } = InputSchema.parse(args);

    context.logger(`生成报告: template=${template}`);

    if (getAvailableLLMConfigs().length > 0) {
      try {
        return await generateWithLLM(metrics, anomalies, rules || [], template, period, context);
      } catch (err: any) {
        context.logger(`LLM 报告生成失败，使用 fallback: ${err.message}`);
        return generateFallback(metrics, anomalies, rules || [], period, true, err.message);
      }
    }

    context.logger("无 LLM，使用本地模板 fallback 生成报告");
    return generateFallback(metrics, anomalies, rules || [], period, false);
  },
};

async function generateWithLLM(
  metrics: any,
  anomalies: any[],
  rules: any[],
  template: string,
  period: any,
  context: ToolContext
): Promise<any> {
  const reportPrompt = loadReportPrompt();
  const reportPeriod = resolvePeriod(metrics, period);
  const prompt = reportPrompt
    .replace("{{metrics}}", JSON.stringify(metrics, null, 2))
    .replace("{{anomalies}}", JSON.stringify(anomalies, null, 2))
    .replace("{{rules}}", JSON.stringify(rules, null, 2))
    .replace("{{template}}", template)
    .replace("{{period}}", reportPeriod.label);

  context.logger("LLM 生成报告");

  const result = await createChatCompletionWithFallback(
    {
      messages: [
        {
          role: "system",
          content: "你是一个专业的企业经营分析师，请根据数据生成经营分析报告。",
        },
        { role: "user", content: prompt },
      ],
      temperature: 0.3,
    },
    { timeoutMs: LLM_TIMEOUT_MS, label: "generate_report" }
  );

  const content = cleanMarkdownOutput(result.response.choices[0]?.message?.content || "");
  return {
    content,
    method: "llm",
    model: result.config.model,
    provider: result.config.provider,
    profile: result.config.profile,
    attempts: result.attempts,
    period: reportPeriod,
    fallback: false,
  };
}

function formatCurrency(value: unknown): string {
  const n = Number(value) || 0;
  return n.toLocaleString("zh-CN", { maximumFractionDigits: 2 });
}

function formatNumber(value: unknown): string {
  const n = Number(value) || 0;
  return n.toLocaleString("zh-CN", { maximumFractionDigits: 2 });
}

function replaceAll(content: string, token: string, value: string): string {
  return content.split(token).join(value);
}

function generateFallback(
  metrics: any,
  anomalies: any[],
  rules: any[],
  period: any,
  llmFailed: boolean,
  errorMessage?: string
): any {
  const templatePath = join(process.cwd(), "data", "report_template.md");
  let content: string;

  try {
    content = readFileSync(templatePath, "utf-8");
  } catch {
    content = [
      "# 经营分析简报",
      "",
      "## 1. 核心结论",
      "",
      "## 2. 核心指标",
      "",
      "## 3. 异常发现",
      "",
      "## 4. 原因分析",
      "",
      "## 5. 建议动作",
      "",
      "## 6. 数据来源",
      "",
      "## 7. 风险提示",
      "",
    ].join("\n");
  }

  const now = new Date().toISOString();
  const reportPeriod = resolvePeriod(metrics, period);
  const netSales = Number(metrics?.net_sales) || 0;

  const channelRows = metrics?.sales_by_channel
    ? Object.entries(metrics.sales_by_channel)
        .map(([channel, value]) => {
          const pct = netSales > 0 ? ((Number(value) / netSales) * 100).toFixed(1) : "0.0";
          return `| ${channel} | ¥${formatCurrency(value)} | ${pct}% |`;
        })
        .join("\n")
    : "| - | - | - |";

  const regionRows = metrics?.sales_by_region
    ? Object.entries(metrics.sales_by_region)
        .map(([region, value]) => {
          const pct = netSales > 0 ? ((Number(value) / netSales) * 100).toFixed(1) : "0.0";
          return `| ${region} | ¥${formatCurrency(value)} | ${pct}% |`;
        })
        .join("\n")
    : "| - | - | - |";

  const categoryRows =
    metrics?.top_categories
      ?.map((c: any) => `| ${c.category} | ¥${formatCurrency(c.sales)} | ${formatNumber(c.count)} 笔 |`)
      .join("\n") || "| - | - | - |";

  const anomalyText =
    anomalies.length > 0
      ? anomalies
          .map((a, i) => `${i + 1}. **${a.type}**（${a.severity}）：${a.reason}`)
          .join("\n")
      : "未发现明显异常。";

  const rulesNote =
    rules.length > 0
      ? `已参考 ${rules.length} 条业务规则片段。`
      : "未检索到业务规则片段，建议人工复核关键口径。";

  const replacements: Record<string, string> = {
    "{{period}}": reportPeriod.label,
    "{{generated_at}}": now,
    "{{data_source}}": "data/orders.csv",
    "{{conclusion}}": llmFailed
      ? "LLM 服务不可用或调用失败，本报告使用本地模板生成。指标来自工具计算，原因分析和建议需要人工进一步复核。"
      : "本报告基于订单数据自动生成，包含核心指标、异常发现和行动建议。",
    "{{gmv}}": formatCurrency(metrics?.gmv),
    "{{net_sales}}": formatCurrency(metrics?.net_sales),
    "{{order_count}}": formatNumber(metrics?.total_orders),
    "{{paid_orders}}": formatNumber(metrics?.paid_orders),
    "{{refund_amount}}": formatCurrency(metrics?.refund_amount),
    "{{refund_rate}}": formatNumber(metrics?.refund_rate),
    "{{avg_order_value}}": formatCurrency(metrics?.avg_order_value),
    "{{channel_rows}}": channelRows,
    "{{region_rows}}": regionRows,
    "{{category_rows}}": categoryRows,
    "{{anomalies}}": anomalyText,
    "{{analysis}}": `${rulesNote} 建议结合近期活动、渠道投放、商品履约和售后策略进一步定位异常原因。`,
    "{{recommendations}}": [
      "1. 优先复核大额订单的履约状态和客户历史行为。",
      "2. 对退款率偏高的日期、商品和渠道做原因拆解。",
      "3. 检查低于平均水平的渠道是否存在投放、库存或页面转化问题。",
      "4. 对疑似重复下单客户建立观察名单，并同步客服或风控复核。",
    ].join("\n"),
    "{{report_method}}": llmFailed
      ? "LLM 调用失败，使用本地模板 fallback 生成"
      : "无 LLM，使用本地模板 fallback 生成",
    "{{risk_notes}}":
      "本报告基于当前可用订单数据和规则自动生成，适合作为经营排查入口；涉及处罚、财务调整或外部发送前应由负责人复核。",
  };

  for (const [token, value] of Object.entries(replacements)) {
    content = replaceAll(content, token, value);
  }

  return {
    content,
    method: "fallback",
    fallback: true,
    llmFailed,
    period: reportPeriod,
    fallbackReason: llmFailed ? "LLM_REPORT_GENERATION_FAILED" : "LLM_UNAVAILABLE",
    errorMessage,
  };
}

function resolvePeriod(metrics: any, period?: any): { start_date: string; end_date: string; label: string } {
  const source = period || metrics?.period || {};
  const start = source.start_date || "";
  const end = source.end_date || "";
  const label = source.label || (start && end ? `${start} 至 ${end}` : "当前查询周期");

  return { start_date: start, end_date: end, label };
}
