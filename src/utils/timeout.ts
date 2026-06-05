import { logger } from "./logger.js";

const TOOL_TIMEOUT_MS = parseInt(process.env.TOOL_TIMEOUT_MS || "10000");

/**
 * 为 Promise 添加超时控制
 */
export function withTimeout<T>(
  promise: Promise<T>,
  ms: number = TOOL_TIMEOUT_MS,
  label: string = "operation"
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new TimeoutError(`工具执行超时: ${label} (${ms}ms)`));
    }, ms);

    promise
      .then((result) => {
        clearTimeout(timer);
        resolve(result);
      })
      .catch((err) => {
        clearTimeout(timer);
        reject(err);
      });
  });
}

/**
 * 超时错误类
 */
export class TimeoutError extends Error {
  code = "TOOL_TIMEOUT" as const;
  constructor(message: string) {
    super(message);
    this.name = "TimeoutError";
  }
}

/**
 * 重试执行函数
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetry: number = parseInt(process.env.MAX_RETRY || "2"),
  label: string = "operation"
): Promise<T> {
  let lastError: Error | undefined;
  for (let attempt = 0; attempt <= maxRetry; attempt++) {
    try {
      return await fn();
    } catch (err: any) {
      lastError = err;
      // 不可重试的错误
      if (isNonRetryableError(err)) {
        logger.warn(`[${label}] 不可重试的错误: ${err.message}`);
        throw err;
      }
      if (attempt < maxRetry) {
        const delay = Math.min(1000 * Math.pow(2, attempt), 5000);
        logger.warn(
          `[${label}] 第 ${attempt + 1} 次重试，等待 ${delay}ms: ${err.message}`
        );
        await sleep(delay);
      }
    }
  }
  throw lastError;
}

/**
 * 判断是否为不可重试的错误
 */
function isNonRetryableError(err: any): boolean {
  if (err.code === "INVALID_ARGS" || err.code === "PERMISSION_DENIED") return true;
  if (err.code === "USER_REJECTED") return true;
  if (err.message?.includes("ZodError")) return true;
  if (err.message?.includes("审批")) return true;
  if (err.message?.includes("拒绝")) return true;
  return false;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
