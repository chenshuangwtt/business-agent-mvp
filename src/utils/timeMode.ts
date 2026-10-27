export type TimeMode = "demo" | "production";

export interface ResolvedDateRange {
  timeMode: TimeMode;
  start_date: string;
  end_date: string;
  label: string;
  source: "explicit" | "relative" | "default";
  reason: string;
  dataAvailable?: boolean;
}

function getDemoReferenceDate(): string { return process.env.DEMO_REFERENCE_DATE || getBusinessDataCoverage().endDate; }

export function getTimeMode(): TimeMode {
  return process.env.TIME_MODE === "production" ? "production" : "demo";
}

export function resolveDateRangeFromMessage(
  message: string,
  now: Date = new Date()
): ResolvedDateRange {
  const timeMode = getTimeMode();
  const coverage = timeMode === "demo" ? getBusinessDataCoverage() : undefined;
  const explicit = resolveExplicitRange(message, timeMode, coverage);
  if (explicit) return explicit;

  const demoReferenceDate = getDemoReferenceDate();
  const effectiveReference = coverage && demoReferenceDate > coverage.endDate ? coverage.endDate : demoReferenceDate;
  const reference = timeMode === "demo" ? new Date(`${effectiveReference}T00:00:00`) : now;
  const range = resolveRelativeRange(message, reference, timeMode);
  const alignedRange = coverage ? clampToCoverage(range, coverage) : range;
  const referenceNote = coverage && effectiveReference !== demoReferenceDate
    ? `；数据截至 ${coverage.endDate}，参考日期已对齐`
    : "";
  return {
    ...alignedRange,
    timeMode,
    reason: timeMode === "demo"
      ? `${alignedRange.reason}；demo 参考日期为 ${effectiveReference}${referenceNote}`
      : alignedRange.reason,
  };
}

function resolveExplicitRange(message: string, timeMode: TimeMode, coverage?: { startDate: string; endDate: string }): ResolvedDateRange | null {
  const dates = message.match(/\d{4}-\d{2}-\d{2}/g) || [];
  if (dates.length === 0) return null;

  const start = dates[0]!;
  const end = dates[1] || start;

  if (coverage && (end < coverage.startDate || start > coverage.endDate)) {
    return {
      timeMode,
      start_date: start,
      end_date: end,
      label: `${start} 至 ${end}`,
      source: "explicit",
      reason: `用户提供的日期不在示例数据覆盖范围 ${coverage.startDate} 至 ${coverage.endDate} 内`,
      dataAvailable: false,
    };
  }

  const actualStart = coverage ? (start < coverage.startDate ? coverage.startDate : start) : start;
  const actualEnd = coverage ? (end > coverage.endDate ? coverage.endDate : end) : end;
  const adjusted = actualStart !== start || actualEnd !== end;
  return {
    timeMode,
    start_date: actualStart,
    end_date: actualEnd,
    label: `${actualStart} 至 ${actualEnd}`,
    source: "explicit",
    reason: adjusted
      ? `用户提供的日期超出示例数据覆盖范围，已按 ${actualStart} 至 ${actualEnd} 对齐可用观察窗口`
      : "用户提供了明确日期",
  };
}

function clampToCoverage(
  range: ResolvedDateRange,
  coverage: { startDate: string; endDate: string }
): ResolvedDateRange {
  const start = range.start_date < coverage.startDate ? coverage.startDate : range.start_date;
  const end = range.end_date > coverage.endDate ? coverage.endDate : range.end_date;
  if (start === range.start_date && end === range.end_date) return range;
  return {
    ...range,
    start_date: start,
    end_date: end,
    label: `${start} 至 ${end}`,
    reason: `${range.reason}；已按示例数据覆盖范围 ${coverage.startDate} 至 ${coverage.endDate} 对齐观察窗口`,
  };
}

function resolveRelativeRange(message: string, now: Date, timeMode: TimeMode): ResolvedDateRange {
  if (/今天|本日|今日/.test(message)) {
    const today = formatDate(now);
    return productionRange(today, today, "relative", "按当前参考日期解析今天", timeMode);
  }

  if (/最近\s*(?:7\s*天|一周)|近\s*(?:7\s*天|一周)/.test(message)) {
    const start = addDays(now, -6);
    return productionRange(
      formatDate(start),
      formatDate(now),
      "relative",
      "按当前参考日期解析最近 7 天", timeMode
    );
  }

  if (/最近\s*30\s*天|近\s*30\s*天/.test(message)) {
    const start = addDays(now, -29);
    return productionRange(formatDate(start), formatDate(now), "relative", "按当前参考日期解析最近 30 天", timeMode);
  }

  if (/上月|上个月/.test(message)) {
    const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const end = new Date(now.getFullYear(), now.getMonth(), 0);
    return productionRange(formatDate(start), formatDate(end), "relative", "按当前参考日期解析上月", timeMode);
  }

  if (/本月|这个月|当月|月环比/.test(message)) {
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    return productionRange(
      formatDate(start),
      formatDate(end),
      "relative",
      "按当前参考日期解析自然月", timeMode
    );
  }

  // Demo data may end mid-natural-week. Always use the latest complete
  // seven-day observation window so unavailable future dates are never zero-filled.
  if (timeMode === "demo") {
    const refersToCurrentWeek = /本周|这周|本星期|这个星期/.test(message);
    const end = /上周/.test(message) && !refersToCurrentWeek ? addDays(now, -7) : now;
    const start = addDays(end, -6);
    return productionRange(
      formatDate(start),
      formatDate(end),
      /本周|这周|本星期|这个星期|上周|周环比|最近|近/.test(message) ? "relative" : "default",
      "demo 模式按数据截止日期使用等长七天观察窗口",
      timeMode
    );
  }

  const week = getNaturalWeek(now);
  return productionRange(
    formatDate(week.start),
    formatDate(week.end),
    /本周|这周|本星期|这个星期|上周/.test(message) ? "relative" : "default",
    "按当前参考日期解析自然周", timeMode,
    /上周/.test(message) && !/本周|这周|本星期|这个星期/.test(message) ? -7 : 0
  );
}

function productionRange(
  start: string,
  end: string,
  source: ResolvedDateRange["source"],
  reason: string,
  timeMode: TimeMode,
  offsetDays = 0
): ResolvedDateRange {
  const actualStart = offsetDays ? formatDate(addDays(utcDate(start), offsetDays)) : start;
  const actualEnd = offsetDays ? formatDate(addDays(utcDate(end), offsetDays)) : end;
  return {
    timeMode,
    start_date: actualStart,
    end_date: actualEnd,
    label: `${actualStart} 至 ${actualEnd}`,
    source,
    reason,
  };
}

function utcDate(value: string): Date { return new Date(`${value}T00:00:00`); }

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
import { getBusinessDataCoverage } from "../business/businessRepository.js";
