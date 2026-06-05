const LOG_LEVELS = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
} as const;

type LogLevel = keyof typeof LOG_LEVELS;

const currentLevel: LogLevel =
  (process.env.LOG_LEVEL as LogLevel) || "info";

function shouldLog(level: LogLevel): boolean {
  return LOG_LEVELS[level] >= LOG_LEVELS[currentLevel];
}

function formatMsg(level: string, msg: string, meta?: any): string {
  const time = new Date().toISOString();
  const base = `[${time}] [${level.toUpperCase()}] ${msg}`;
  if (meta !== undefined) {
    return `${base} ${JSON.stringify(meta)}`;
  }
  return base;
}

export const logger = {
  debug(msg: string, meta?: any) {
    if (shouldLog("debug")) console.debug(formatMsg("debug", msg, meta));
  },
  info(msg: string, meta?: any) {
    if (shouldLog("info")) console.log(formatMsg("info", msg, meta));
  },
  warn(msg: string, meta?: any) {
    if (shouldLog("warn")) console.warn(formatMsg("warn", msg, meta));
  },
  error(msg: string, meta?: any) {
    if (shouldLog("error")) console.error(formatMsg("error", msg, meta));
  },
};
