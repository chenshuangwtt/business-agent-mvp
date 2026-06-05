import assert from "node:assert/strict";
import test from "node:test";
import { resolveDateRangeFromMessage } from "../src/utils/timeMode.ts";
import { queryOrdersTool } from "../src/tools/queryOrders.ts";
import type { ToolContext } from "../src/agent/types.ts";

const context: ToolContext = {
  traceId: "trace-test",
  logger: () => {},
};

test("demo time mode maps relative dates to demo data window", () => {
  withEnv({ TIME_MODE: "demo" }, () => {
    const range = resolveDateRangeFromMessage("帮我分析本周订单情况", new Date(2026, 5, 5));

    assert.equal(range.timeMode, "demo");
    assert.equal(range.start_date, "2026-05-25");
    assert.equal(range.end_date, "2026-06-03");
    assert.equal(range.source, "default");
  });
});

test("production time mode resolves natural week from real current date", () => {
  withEnv({ TIME_MODE: "production" }, () => {
    const range = resolveDateRangeFromMessage("帮我分析本周订单情况", new Date(2026, 5, 5));

    assert.equal(range.timeMode, "production");
    assert.equal(range.start_date, "2026-06-01");
    assert.equal(range.end_date, "2026-06-07");
    assert.equal(range.source, "relative");
  });
});

test("production time mode resolves today month and recent ranges", () => {
  withEnv({ TIME_MODE: "production" }, () => {
    const now = new Date(2026, 5, 5);

    assert.deepEqual(
      pickRange(resolveDateRangeFromMessage("分析今天订单", now)),
      ["2026-06-05", "2026-06-05"]
    );
    assert.deepEqual(
      pickRange(resolveDateRangeFromMessage("分析本月订单", now)),
      ["2026-06-01", "2026-06-30"]
    );
    assert.deepEqual(
      pickRange(resolveDateRangeFromMessage("分析最近7天订单", now)),
      ["2026-05-30", "2026-06-05"]
    );
  });
});

test("production empty query does not suggest demo range", async () => {
  await withEnvAsync({ TIME_MODE: "production" }, async () => {
    const result = await queryOrdersTool.execute(
      {
        start_date: "2026-06-04",
        end_date: "2026-06-07",
        status: "all",
        channel: "all",
        region: "all",
      },
      context
    );

    assert.equal(result.count, 0);
    assert.equal(result.timeMode, "production");
    assert.equal(result.suggestedQuery, undefined);
    assert.match(result.emptyReason, /不会自动回退到 demo 数据窗口/);
  });
});

function pickRange(range: { start_date: string; end_date: string }): [string, string] {
  return [range.start_date, range.end_date];
}

function withEnv(env: Record<string, string | undefined>, fn: () => void) {
  const old = saveEnv(env);
  try {
    fn();
  } finally {
    restoreEnv(old);
  }
}

async function withEnvAsync(env: Record<string, string | undefined>, fn: () => Promise<void>) {
  const old = saveEnv(env);
  try {
    await fn();
  } finally {
    restoreEnv(old);
  }
}

function saveEnv(env: Record<string, string | undefined>): Record<string, string | undefined> {
  const old: Record<string, string | undefined> = {};
  for (const key of Object.keys(env)) {
    old[key] = process.env[key];
    const value = env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  return old;
}

function restoreEnv(old: Record<string, string | undefined>) {
  for (const [key, value] of Object.entries(old)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}
