const PREFACE_RE =
  /^(好的|明白|收到|当然|遵照|根据您的|以下是|下面是|为您生成|我将|已为您)/;
const HR_RE = /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/;
const INTERNAL_TERMS_RE = /\b(?:query_orders|calculate_metrics|compare_period_metrics|detect_anomalies|diagnose_business|generate_report|generate_diagnosis_report|drill_down_anomaly|get_anomaly_evidence|search_business_rules|export_report|send_report_email|dataset_id|diagnosis_id|traceId|trace_id|dataset-[\w-]+|diagnosis-[\w-]+|trace-[\w-]+|Agent Loop|Skill)\b/i;
const INTERNAL_PATH_RE = /(?:\bdata[\\/]|\breports[\\/]|\b[\w-]+\.(?:csv|md)\b|business_rules|company_policy)/i;
const INTERNAL_MODE_RE = /(?:\bLLM\b|\bFallback\b|Demo\s*模式|本地演示|运行模式)/i;
const SELF_INSTRUCTION_RE = /(?:可以|可|下一步).*?(?:调用|使用).*?(?:工具|query_|calculate_|compare_|detect_|diagnose_|generate_|export_|send_)/i;

export function cleanMarkdownOutput(content: string): string {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const cleaned: string[] = [];
  let atStart = true;

  for (const line of lines) {
    const trimmed = line.trim();

    if (atStart) {
      if (!trimmed) continue;
      if (PREFACE_RE.test(trimmed)) continue;
    }

    atStart = false;
    if (HR_RE.test(trimmed)) continue;
    cleaned.push(line);
  }

  return cleaned.join("\n").trim();
}

/**
 * 保留经营事实与 Markdown 结构，并移除不应进入业务界面的运行细节。
 * Trace 与工具消息仍保存完整原始内容，用于调试和审计。
 */
export function formatBusinessAnswer(content: string): string {
  const lines = cleanMarkdownOutput(content).split("\n");
  const visible = lines.filter((line) => {
    const normalized = line.trim();
    if (!normalized) return true;
    return !INTERNAL_TERMS_RE.test(normalized)
      && !INTERNAL_PATH_RE.test(normalized)
      && !INTERNAL_MODE_RE.test(normalized)
      && !SELF_INSTRUCTION_RE.test(normalized);
  });

  const compact = visible
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/(?:^|\n)#{1,6}\s*\n(?=\n|$)/g, "\n")
    .trim();

  return compact || "当前未能生成可展示的经营结论。";
}
