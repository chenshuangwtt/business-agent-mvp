import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import assert from "node:assert/strict";
import test from "node:test";
import { z } from "zod";
import { calculateMetricsTool } from "../src/tools/calculateMetrics.ts";
import { exportReportTool } from "../src/tools/exportReport.ts";
import { findAnomaliesTool } from "../src/tools/findAnomalies.ts";
import { queryOrdersTool } from "../src/tools/queryOrders.ts";
import { execToolWithTrace } from "../src/agent/agentLoop.ts";
import { getToolsForLLM, initToolRegistry } from "../src/agent/toolRegistry.ts";
import { createTrace } from "../src/trace/traceRecorder.ts";
import type { AgentTool, Order, ToolContext } from "../src/agent/types.ts";

const context: ToolContext = {
  traceId: "trace-test",
  logger: () => {},
};

function sampleOrders(): Order[] {
  return [
    {
      order_id: "ORD-A",
      order_date: "2026-06-01",
      customer_id: "C001",
      product_id: "P001",
      category: "course",
      quantity: 1,
      unit_price: 100,
      total_amount: 100,
      status: "paid",
      channel: "web",
      region: "east",
      refund_amount: 0,
    },
    {
      order_id: "ORD-B",
      order_date: "2026-06-01",
      customer_id: "C002",
      product_id: "P002",
      category: "consulting",
      quantity: 1,
      unit_price: 6000,
      total_amount: 6000,
      status: "paid",
      channel: "miniapp",
      region: "south",
      refund_amount: 0,
    },
    {
      order_id: "ORD-C",
      order_date: "2026-06-02",
      customer_id: "C003",
      product_id: "P003",
      category: "course",
      quantity: 1,
      unit_price: 300,
      total_amount: 300,
      status: "refunded",
      channel: "web",
      region: "east",
      refund_amount: 300,
    },
  ];
}

test("query_orders validates date range and reads demo data", async () => {
  const result = await queryOrdersTool.execute(
    {
      start_date: "2026-05-25",
      end_date: "2026-06-03",
      status: "all",
      channel: "all",
      region: "all",
    },
    context
  );

  assert.equal(result.count, 200);
  assert.equal(result.orders.length, 200);
  assert.deepEqual(result.availableRange, {
    start_date: "2026-05-25",
    end_date: "2026-06-03",
  });

  await assert.rejects(
    () =>
      queryOrdersTool.execute(
        {
          start_date: "2026-06-03",
          end_date: "2026-05-25",
          status: "all",
          channel: "all",
          region: "all",
        },
        context
      ),
    (error: any) =>
      error?.code === "INVALID_ARGS" && error?.message === "开始日期不能晚于结束日期"
  );
});

test("query_orders returns demo range hint when query is empty", async () => {
  const result = await queryOrdersTool.execute(
    {
      start_date: "2025-03-17",
      end_date: "2025-03-23",
      status: "all",
      channel: "all",
      region: "all",
    },
    context
  );

  assert.equal(result.count, 0);
  assert.match(result.emptyReason, /2026-05-25 到 2026-06-03/);
  assert.deepEqual(result.suggestedQuery, {
    start_date: "2026-05-25",
    end_date: "2026-06-03",
    status: "all",
    channel: "all",
    region: "all",
  });
});

test("calculate_metrics keeps financial numbers deterministic", async () => {
  const metrics = await calculateMetricsTool.execute({ orders: sampleOrders() }, context);

  assert.equal(metrics.gmv, 6400);
  assert.equal(metrics.net_sales, 6100);
  assert.equal(metrics.total_orders, 3);
  assert.equal(metrics.paid_orders, 2);
  assert.equal(metrics.refund_amount, 300);
  assert.equal(metrics.refund_rate, 4.69);
  assert.equal(metrics.avg_order_value, 3050);
  assert.equal(metrics.sales_by_channel.web, 100);
  assert.equal(metrics.sales_by_channel.miniapp, 6000);
});

test("find_anomalies flags large orders and high refund days", async () => {
  const metrics = await calculateMetricsTool.execute({ orders: sampleOrders() }, context);
  const result = await findAnomaliesTool.execute({ orders: sampleOrders(), metrics }, context);
  const types = result.anomalies.map((item: any) => item.type);

  assert.ok(types.includes("large_order"));
  assert.ok(types.includes("high_daily_refund"));
});

test("export_report only writes inside reports directory", async () => {
  const filename = "test-export-report.md";
  const filePath = join(process.cwd(), "reports", filename);

  try {
    const result = await exportReportTool.execute(
      {
        filename,
        content: "# Test Report",
      },
      context
    );

    assert.equal(result.success, true);
    assert.equal(result.path, `reports/${filename}`);
    assert.equal(existsSync(filePath), true);

    await assert.rejects(
      () =>
        exportReportTool.execute(
          {
            filename: "../escape.md",
            content: "# Bad",
          },
          context
        ),
      /文件名/
    );
  } finally {
    if (existsSync(filePath)) {
      rmSync(filePath);
    }
  }
});

test("tool JSON schema does not mark default fields as required", () => {
  initToolRegistry();
  const queryOrders = getToolsForLLM().find((tool) => tool.function.name === "query_orders");

  assert.ok(queryOrders);
  assert.deepEqual(queryOrders.function.parameters.required, ["start_date", "end_date"]);
});

test("fallback tool result records one fallback trace step", async () => {
  const trace = createTrace();
  const traceDir = join(process.cwd(), "logs", trace.traceId);
  const tool: AgentTool = {
    name: "search_business_rules",
    description: "test fallback result",
    riskLevel: "low",
    requiresApproval: false,
    inputSchema: z.any(),
    execute: async () => ({
      results: [],
      query: "指标口径",
      total: 0,
      fallback: true,
      error: "业务规则检索失败，将使用默认规则",
    }),
  };

  try {
    await execToolWithTrace("search_business_rules", tool, { query: "指标口径" }, trace, false);
    const fallbackSteps = trace.steps.filter((step) => step.type === "fallback");

    assert.equal(fallbackSteps.length, 1);
    assert.equal(fallbackSteps[0].data.toolName, "search_business_rules");
  } finally {
    if (existsSync(traceDir)) rmSync(traceDir, { recursive: true, force: true });
  }
});

test("search_business_rules thrown error fallback records one fallback trace step", async () => {
  const trace = createTrace();
  const traceDir = join(process.cwd(), "logs", trace.traceId);
  const oldMaxRetry = process.env.MAX_RETRY;
  const tool: AgentTool = {
    name: "search_business_rules",
    description: "test thrown fallback",
    riskLevel: "low",
    requiresApproval: false,
    inputSchema: z.any(),
    execute: async () => {
      throw new Error("forced retrieval failure");
    },
  };

  try {
    process.env.MAX_RETRY = "0";
    const resultJson = await execToolWithTrace(
      "search_business_rules",
      tool,
      { query: "指标口径" },
      trace,
      false
    );
    const result = JSON.parse(resultJson);
    const fallbackSteps = trace.steps.filter((step) => step.type === "fallback");

    assert.equal(result.fallback, true);
    assert.equal(fallbackSteps.length, 1);
    assert.equal(fallbackSteps[0].data.toolName, "search_business_rules");
  } finally {
    if (oldMaxRetry === undefined) delete process.env.MAX_RETRY;
    else process.env.MAX_RETRY = oldMaxRetry;
    if (existsSync(traceDir)) rmSync(traceDir, { recursive: true, force: true });
  }
});
