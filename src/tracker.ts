/// <reference types="obsidian" />

import type { KanbanCard, ReminderGroup, PluginSettings, TrackerSnapshot } from './types';
import { getTodayISO } from './reminder';

/**
 * 老化分析引擎。
 * 追踪卡片停留时间、计算完成率、生成趋势报告。
 */
export class Tracker {
  private settings: PluginSettings;

  constructor(settings: PluginSettings) {
    this.settings = settings;
  }

  /**
   * 检查并记录每日快照。
   * 每次扫描完成后调用。
   */
  snapshot(cards: KanbanCard[], groups: ReminderGroup[]): void {
    if (!this.settings.tracker.enabled) return;

    const today = getTodayISO();

    // 避免同一天重复记录
    const last = this.settings.tracker.history[this.settings.tracker.history.length - 1];
    if (last?.date === today) return;

    const completedToday = cards.filter((c) => c.isComplete).length;
    // 计算今日完成的卡片（从历史推断：这些卡片之前存在，现在 completed）
    // 简化：统计扫描到的已完成卡片中 today 完成的数量
    // 更准确的方式需要对比前一天快照，先简化

    const snapshot: TrackerSnapshot = {
      date: today,
      totalCards: cards.filter((c) => !c.isComplete && !c.isArchived).length,
      completedToday,
      overdueCount: groups
        .filter((g) => g.level.condition === 'overdue')
        .reduce((s, g) => s + g.cards.length, 0),
    };

    this.settings.tracker.history.push(snapshot);

    // 保留最近 90 天的历史
    if (this.settings.tracker.history.length > 90) {
      this.settings.tracker.history = this.settings.tracker.history.slice(-90);
    }
  }

  /**
   * 识别滞留最久的卡片（列表没变且无日期）。
   */
  findStagnantCards(cards: KanbanCard[]): KanbanCard[] {
    if (!this.settings.tracker.enabled) return [];

    const now = Date.now();
    const threshold = 7 * 24 * 60 * 60 * 1000; // 7 天

    return cards
      .filter((c) => {
        if (c.isComplete || c.isArchived) return false;
        // 有日期且不逾期的不算滞留
        if (c.date && new Date(c.date).getTime() >= Date.now()) return false;
        // 首次发现时间超过阈值
        return c.firstSeen && (now - c.firstSeen) > threshold;
      })
      .sort((a, b) => (b.firstSeen || 0) - (a.firstSeen || 0))
      .slice(0, 5); // 最多返回 5 张
  }

  /**
   * 生成本周的完成趋势总结。
   */
  weeklySummary(): string {
    const history = this.settings.tracker.history;
    if (history.length < 2) return '数据不足（需至少 2 天记录）';

    const thisWeek = history.slice(-7);
    const lastWeek = history.slice(-14, -7);

    const thisTotal = thisWeek.reduce((s, d) => s + d.completedToday, 0);
    const lastTotal = lastWeek.reduce((s, d) => s + d.completedToday, 0);

    const thisOverdueAvg = thisWeek.length
      ? Math.round(thisWeek.reduce((s, d) => s + d.overdueCount, 0) / thisWeek.length)
      : 0;
    const lastOverdueAvg = lastWeek.length
      ? Math.round(lastWeek.reduce((s, d) => s + d.overdueCount, 0) / lastWeek.length)
      : 0;

    const lines: string[] = ['📊 **看板周报**'];
    lines.push(`本周完成：${thisTotal} 项`);

    if (lastTotal > 0) {
      const trend = thisTotal > lastTotal ? '📈' : '📉';
      lines.push(`${trend} 较上周：${thisTotal - lastTotal > 0 ? '+' : ''}${thisTotal - lastTotal}`);
    }

    lines.push(`日均逾期：${thisOverdueAvg} 项`);
    if (lastWeek.length > 0) {
      const diff = thisOverdueAvg - lastOverdueAvg;
      lines.push(`逾期趋势：${diff > 0 ? '⚠️ 上升' : diff < 0 ? '✅ 下降' : '→ 持平'}${diff !== 0 ? ` (${diff > 0 ? '+' : ''}${diff})` : ''}`);
    }

    return lines.join('\n');
  }
}
