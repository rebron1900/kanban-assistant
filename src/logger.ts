/// <reference types="obsidian" />

import type { LogEntry } from './types';

const MAX_LOGS = 100;

/**
 * 添加一条日志。
 * 保持纯函数，不维护状态——日志存在 settings 里。
 */
export function addLog(
  logs: LogEntry[],
  level: LogEntry['level'],
  message: string,
  detail?: string,
): LogEntry[] {
  const entry: LogEntry = {
    timestamp: Date.now(),
    level,
    message,
    detail,
  };

  const updated = [...logs, entry];
  // 环形缓冲：最多保留 MAX_LOGS 条
  if (updated.length > MAX_LOGS) {
    return updated.slice(updated.length - MAX_LOGS);
  }
  return updated;
}

/**
 * 格式化日志为可读文本（用于诊断面板）。
 */
export function formatLogs(logs: LogEntry[]): string {
  if (logs.length === 0) return '暂无日志';

  return logs
    .slice(-50) // 只显示最近 50 条
    .map((l) => {
      const time = new Date(l.timestamp).toLocaleString('zh-CN', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      });
      const icon = l.level === 'error' ? '❌' : l.level === 'warn' ? '⚠️' : 'ℹ️';
      const detail = l.detail ? `\n    ${l.detail}` : '';
      return `${icon} [${time}] ${l.message}${detail}`;
    })
    .join('\n');
}

/**
 * 统计各级别日志数量。
 */
export function logStats(logs: LogEntry[]): { info: number; warn: number; error: number } {
  const stats = { info: 0, warn: 0, error: 0 };
  for (const l of logs) {
    stats[l.level]++;
  }
  return stats;
}
