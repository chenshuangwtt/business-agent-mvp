import { v4 as uuid } from "uuid";
import { logger } from "../utils/logger.js";
import type { Session } from "./types.js";
import type OpenAI from "openai";

const SESSION_TTL_MS = parseInt(process.env.SESSION_TTL_MS || "1800000"); // 30 min
const MAX_MESSAGES = 50;
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // 5 min

const sessions = new Map<string, Session>();

// 定期清理过期会话
let cleanupTimer: ReturnType<typeof setInterval> | null = null;

export function startSessionCleanup(): void {
  if (cleanupTimer) return;
  cleanupTimer = setInterval(() => {
    cleanupSessions();
  }, CLEANUP_INTERVAL_MS);
  // 允许 Node.js 优雅退出
  if (cleanupTimer.unref) cleanupTimer.unref();
  logger.info("[Session] 清理定时器已启动");
}

/**
 * 获取或创建会话
 */
export function getOrCreateSession(sessionId?: string): Session {
  if (sessionId && sessions.has(sessionId)) {
    const session = sessions.get(sessionId)!;
    session.lastActivity = new Date().toISOString();
    logger.debug(`[Session] 复用会话: ${sessionId}`);
    return session;
  }

  const id = sessionId || `session-${uuid().slice(0, 8)}`;
  const now = new Date().toISOString();
  const session: Session = {
    sessionId: id,
    messages: [],
    createdAt: now,
    lastActivity: now,
    traceIds: [],
  };
  sessions.set(id, session);
  logger.info(`[Session] 创建会话: ${id}`);
  return session;
}

/**
 * 获取会话
 */
export function getSession(sessionId: string): Session | null {
  const session = sessions.get(sessionId) || null;
  if (session) {
    session.lastActivity = new Date().toISOString();
  }
  return session;
}

/**
 * 列出所有会话摘要
 */
export function listSessions(): Array<{
  sessionId: string;
  createdAt: string;
  lastActivity: string;
  messageCount: number;
  traceCount: number;
}> {
  return Array.from(sessions.values()).map((s) => ({
    sessionId: s.sessionId,
    createdAt: s.createdAt,
    lastActivity: s.lastActivity,
    messageCount: s.messages.length,
    traceCount: s.traceIds.length,
  }));
}

/**
 * 清理过期会话
 */
function cleanupSessions(): void {
  const now = Date.now();
  let cleaned = 0;
  for (const [id, session] of sessions) {
    if (now - new Date(session.lastActivity).getTime() > SESSION_TTL_MS) {
      sessions.delete(id);
      cleaned++;
    }
  }
  if (cleaned > 0) {
    logger.info(`[Session] 清理 ${cleaned} 个过期会话，剩余 ${sessions.size} 个`);
  }
}

/**
 * 修剪会话消息，防止超过上下文窗口
 * 保留 system prompt + 最近的消息
 */
export function trimMessagesIfNeeded(session: Session): void {
  if (session.messages.length <= MAX_MESSAGES) return;

  // 找到 system prompt（第一条）
  const systemMsg = session.messages[0];
  const rest = session.messages.slice(1);

  // 保留最近的 MAX_MESSAGES - 1 条
  const keep = rest.slice(-(MAX_MESSAGES - 1));
  session.messages = [systemMsg, ...keep];

  logger.info(
    `[Session] 修剪会话 ${session.sessionId}: 保留 ${session.messages.length} 条消息`
  );
}
