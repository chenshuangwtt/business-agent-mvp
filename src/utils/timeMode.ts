export type TimeMode = "demo" | "production";

export interface ResolvedDateRange {
  timeMode: TimeMode;
  start_date: string;
  end_date: string;
  label: string;
  source: "explicit" | "relative" | "default";
  reason: string;
}

const DEMO_DATA_START = process.env.DEMO_DATA_START || "2026-05-25";
const DEMO_DATA_END = process.env.DEMO_DATA_END || "2026-06-03";

export function getTimeMode(): TimeMode {
  return process.env.TIME_MODE === "production" ? "production" : "demo";
}

export function resolveDateRangeFromMessage(
  message: string,
  now: Date = new Date()
): ResolvedDateRange {
  const timeMode = getTimeMode();
  const explicit = resolveExplicitRange(message, timeMode);
  if (explicit) return explicit;

  if (timeMode === "demo") {
    return {
      timeMode,
      start_date: DEMO_DATA_START,
      end_date: DEMO_DATA_END,
      label: `${DEMO_DATA_START} 至 ${DEMO_DATA_END}`,
      source: "default",
      reason: "demo 模式使用固定演示数据窗口",
    };
  }

  return resolveProductionRelativeRange(message, now);
}

function resolveExplicitRange(message: string, timeMode: TimeMode): ResolvedDateRange | null {
  const dates = message.match(/\d{4}-\d{2}-\d{2}/g) || [];
  if (dates.length === 0) return null;

  const start = dates[0]!;
  const end = dates[1] || start;

  return {
    timeMode,
    start_date: start,
    end_date: end,
    label: `${start} 至 ${end}`,
    source: "explicit",
    reason: "用户提供了明确日期",
  };
}

function resolveProductionRelativeRange(message: string, now: Date): ResolvedDateRange {
  if (/今天|本日|今日/.test(message)) {
    const today = formatDate(now);
    return productionRange(today, today, "relative", "production 模式按真实当前日期解析今天");
  }

  if (/最近\s*7\s*天|近\s*7\s*天/.test(message)) {
    const start = addDays(now, -6);
    return productionRange(
      formatDate(start),
      formatDate(now),
      "relative",
      "production 模式按真实当前日期解析最近 7 天"
    );
  }

  if (/本月|这个月|当月/.test(message)) {
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    return productionRange(
      formatDate(start),
      formatDate(end),
      "relative",
      "production 模式按真实当前日期解析自然月"
    );
  }

  const week = getNaturalWeek(now);
  return productionRange(
    formatDate(week.start),
    formatDate(week.end),
    /本周|这周|本星期|这个星期/.test(message) ? "relative" : "default",
    /本周|这周|本星期|这个星期/.test(message)
      ? "production 模式按真实当前日期解析自然周"
      : "production 模式默认使用当前自然周"
  );
}

function productionRange(
  start: string,
  end: string,
  source: ResolvedDateRange["source"],
  reason: string
): ResolvedDateRange {
  return {
    timeMode: "production",
    start_date: start,
    end_date: end,
    label: `${start} 至 ${end}`,
    source,
    reason,
  };
}

function getNaturalWeek(date: Date): { start: Date; end: Date } {
  const day = date.getDay() || 7;
  const start = addDays(date, 1 - day);
  const end = addDays(start, 6);
  return { start, end };
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

function formatDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
