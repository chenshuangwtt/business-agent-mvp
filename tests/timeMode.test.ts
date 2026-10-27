import assert from "node:assert/strict";
import test from "node:test";
import { resolveDateRangeFromMessage } from "../src/utils/timeMode.ts";
import { getBusinessDataCoverage } from "../src/business/businessRepository.ts";
import { compareMetricPeriods } from "../src/business/metrics.ts";
import { getBusinessData } from "../src/business/businessRepository.ts";

test("demo mode retains relative week boundaries using the reference date", () => {
  withEnv({ TIME_MODE: "demo", DEMO_REFERENCE_DATE: "2026-07-19" }, () => {
    const current = resolveDateRangeFromMessage("帮我分析本周订单情况");
    const previous = resolveDateRangeFromMessage("帮我分析上周订单情况");
    const recent = resolveDateRangeFromMessage("帮我分析最近7天订单");
    const recentWeek = resolveDateRangeFromMessage("帮我分析最近一周退款");
    assert.deepEqual([current.start_date, current.end_date], ["2026-07-13", "2026-07-19"]);
    assert.deepEqual([previous.start_date, previous.end_date], ["2026-07-06", "2026-07-12"]);
    assert.deepEqual([recent.start_date, recent.end_date], ["2026-07-13", "2026-07-19"]);
    assert.deepEqual([recentWeek.start_date, recentWeek.end_date], ["2026-07-13", "2026-07-19"]);
  });
});

test("production mode resolves natural week from real current date", () => {
  withEnv({ TIME_MODE: "production" }, () => {
    const range = resolveDateRangeFromMessage("帮我分析本周订单情况", new Date(2026, 5, 5));
    assert.deepEqual([range.start_date, range.end_date], ["2026-06-01", "2026-06-07"]);
  });
});

test("a current-week question that compares with last week keeps the current-week window", () => {
  withEnv({ TIME_MODE: "demo", DEMO_REFERENCE_DATE: "2026-07-19" }, () => {
    const range = resolveDateRangeFromMessage("本周退款为什么比上周增加？");
    assert.deepEqual([range.start_date, range.end_date], ["2026-07-13", "2026-07-19"]);
  });
});

test("demo date resolution clamps incomplete windows to the actual data coverage", () => {
  const coverage = getBusinessDataCoverage();
  assert.deepEqual(coverage, { startDate: "2026-03-31", endDate: "2026-09-29" });

  withEnv({ TIME_MODE: "demo", DEMO_REFERENCE_DATE: "2026-10-04" }, () => {
    const defaultRange = resolveDateRangeFromMessage("哪个商品对退款增长影响最大？");
    const explicitRange = resolveDateRangeFromMessage("分析 2026-09-28 到 2026-10-04 的订单");

    assert.deepEqual([defaultRange.start_date, defaultRange.end_date], ["2026-09-23", "2026-09-29"]);
    assert.deepEqual([explicitRange.start_date, explicitRange.end_date], ["2026-09-28", "2026-09-29"]);
    assert.match(explicitRange.reason, /可用观察窗口/);

    const comparison = compareMetricPeriods(getBusinessData(), "dataset-time-window", explicitRange);
    assert.equal(comparison.current.period.label, "2026-09-28 至 2026-09-29");
    assert.equal(comparison.previous.period.label, "2026-09-26 至 2026-09-27");
  });
});

test("demo mode reports no data instead of remapping a fully out-of-range explicit period", () => {
  withEnv({ TIME_MODE: "demo" }, () => {
    const range = resolveDateRangeFromMessage("分析 2026-10-01 到 2026-10-07 的订单");
    assert.equal(range.dataAvailable, false);
  });
});

function withEnv(env: Record<string, string>, fn: () => void) {
  const previous = Object.fromEntries(Object.keys(env).map((key) => [key, process.env[key]]));
  try { Object.assign(process.env, env); fn(); }
  finally { for (const [key, value] of Object.entries(previous)) value === undefined ? delete process.env[key] : process.env[key] = value; }
}
