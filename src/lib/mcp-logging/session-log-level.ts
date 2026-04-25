import type { McpLogLevel } from '../mcp-notifications/events.js';

const DEFAULT_LOG_LEVEL: McpLogLevel = 'info';

const LOG_LEVEL_ORDER: Record<McpLogLevel, number> = {
  debug: 10,
  info: 20,
  notice: 30,
  warning: 40,
  error: 50,
  critical: 60,
  alert: 70,
  emergency: 80,
};

const sessionLogLevels = new Map<string, McpLogLevel>();

export function setSessionLogLevel(sessionId: string, level: McpLogLevel): void {
  sessionLogLevels.set(sessionId, level);
}

export function getSessionLogLevel(sessionId: string): McpLogLevel | undefined {
  return sessionLogLevels.get(sessionId);
}

export function clearSessionLogLevel(sessionId: string): void {
  sessionLogLevels.delete(sessionId);
}

export function shouldEmitToSession(sessionId: string, level: McpLogLevel): boolean {
  const currentLevel = sessionLogLevels.get(sessionId) ?? DEFAULT_LOG_LEVEL;
  return LOG_LEVEL_ORDER[level] >= LOG_LEVEL_ORDER[currentLevel];
}
