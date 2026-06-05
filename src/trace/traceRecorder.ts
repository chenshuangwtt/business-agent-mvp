import { mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync } from "fs";
import { join } from "path";
import { v4 as uuid } from "uuid";
import type { Trace, TraceStep, TraceStepType } from "../agent/types.js";
import { logger } from "../utils/logger.js";

const LOGS_DIR = join(process.cwd(), "logs");

/**
 * 创建新的 Trace
 */
export function createTrace(): Trace {
  const traceId = `trace-${uuid().slice(0, 8)}`;
  const trace: Trace = {
    traceId,
    steps: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  saveTrace(trace);
  logger.info(`[Trace] 创建 Trace: ${traceId}`);
  return trace;
}

/**
 * 添加 Trace 步骤
 */
export function addTraceStep(
  trace: Trace,
  type: TraceStepType,
  data: any
): TraceStep {
  const step: TraceStep = {
    id: `step-${uuid().slice(0, 8)}`,
    type,
    timestamp: new Date().toISOString(),
    data,
  };
  trace.steps.push(step);
  trace.updatedAt = step.timestamp;
  saveTrace(trace);
  logger.debug(`[Trace] ${trace.traceId} - ${type}`);
  return step;
}

/**
 * 保存 Trace 到文件
 */
function saveTrace(trace: Trace): void {
  const traceDir = join(LOGS_DIR, trace.traceId);
  if (!existsSync(traceDir)) {
    mkdirSync(traceDir, { recursive: true });
  }
  const filePath = join(traceDir, "trace.json");
  writeFileSync(filePath, JSON.stringify(trace, null, 2), "utf-8");
}

/**
 * 读取所有 Trace 列表
 */
export function listTraces(): Array<{
  traceId: string;
  createdAt: string;
  updatedAt: string;
  stepCount: number;
}> {
  if (!existsSync(LOGS_DIR)) return [];
  const dirs = readdirSync(LOGS_DIR).filter((d) => d.startsWith("trace-"));
  return dirs
    .map((dir) => {
      try {
        const filePath = join(LOGS_DIR, dir, "trace.json");
        const trace: Trace = JSON.parse(readFileSync(filePath, "utf-8"));
        return {
          traceId: trace.traceId,
          createdAt: trace.createdAt,
          updatedAt: trace.updatedAt,
          stepCount: trace.steps.length,
        };
      } catch {
        return null;
      }
    })
    .filter(Boolean) as any[];
}

/**
 * 读取单个 Trace
 */
export function getTrace(traceId: string): Trace | null {
  const filePath = join(LOGS_DIR, traceId, "trace.json");
  if (!existsSync(filePath)) return null;
  try {
    return JSON.parse(readFileSync(filePath, "utf-8"));
  } catch {
    return null;
  }
}
