/// <reference types="obsidian" />

import { Notice } from 'obsidian';
import type { KanbanCard, PluginSettings, ReminderGroup, ReminderLevel } from './types';

/**
 * 将卡片按配置的提醒级别分组。
 * 一张卡片只会进入第一个匹配的级别（自上而下优先）。
 */
export function classifyCards(
  cards: KanbanCard[],
  levels: ReminderLevel[],
  today: string,          // 'YYYY-MM-DD'
): ReminderGroup[] {
  const enabledLevels = levels.filter((l) => l.enabled);
  const used = new Set<number>(); // 已分配的卡片索引

  const todayDate = new Date(today);

  const groups: ReminderGroup[] = [];

  for (const level of enabledLevels) {
    const matched: KanbanCard[] = [];

    for (let i = 0; i < cards.length; i++) {
      if (used.has(i)) continue;
      const card = cards[i];
      if (card.isComplete) {
        used.add(i);
        continue;
      }
      if (card.isArchived) {
        used.add(i);
        continue;
      }

      if (matchCondition(card, level, todayDate)) {
        matched.push(card);
        used.add(i);
      }
    }

    if (matched.length > 0) {
      groups.push({ level, cards: matched });
    }
  }

  return groups;
}

function matchCondition(card: KanbanCard, level: ReminderLevel, today: Date): boolean {
  switch (level.condition) {
    case 'overdue':
      return isOverdue(card, today);
    case 'due_within':
      return isDueWithin(card, today, level.days);
    case 'created_since':
      return card.date === null; // 简化：没有日期的卡触发 created_since
    default:
      return false;
  }
}

function isOverdue(card: KanbanCard, today: Date): boolean {
  if (!card.date) return false;
  const cardDate = parseDate(card.date);
  if (!cardDate) return false;
  return cardDate < today; // 日期比今天早则逾期
}

function isDueWithin(card: KanbanCard, today: Date, days: number): boolean {
  if (!card.date) return false;
  const cardDate = parseDate(card.date);
  if (!cardDate) return false;

  if (cardDate < today) return false; // 逾期的归逾期级别处理

  const diffMs = cardDate.getTime() - today.getTime();
  const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
  return diffDays <= days;
}

function parseDate(dateStr: string): Date | null {
  const m = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  return new Date(parseInt(m[1]), parseInt(m[2]) - 1, parseInt(m[3]));
}

/**
 * 获取今天的日期字符串 YYYY-MM-DD。
 */
export function getTodayISO(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * 显示提醒通知。每个级别弹一条 Notice。
 */
export function showReminders(groups: ReminderGroup[]): void {
  if (groups.length === 0) {
    new Notice('✅ 看板检查完毕，无待提醒任务');
    return;
  }

  for (const group of groups) {
    const { level, cards } = group;
    const emoji = level.prefix || '📌';

    // 格式：一行标题 + 每张卡片一行
    const titleLine = `${emoji} ${level.name}（${cards.length}项）`;
    const cardLines = cards
      .slice(0, 10) // 最多显示 10 张，避免刷屏
      .map((c) => `  · ${c.title}${c.date ? ` (${c.date})` : ''}`)
      .join('\n');

    const more = cards.length > 10 ? `\n  ...及其他 ${cards.length - 10} 项` : '';

    new Notice(`${titleLine}\n${cardLines}${more}`, 6000);
  }
}

/**
 * 一键执行：扫描 → 分类 → 弹窗。
 */
export async function runReminderCheck(
  cards: KanbanCard[],
  settings: PluginSettings,
): Promise<void> {
  const today = getTodayISO();
  const groups = classifyCards(cards, settings.levels, today);
  showReminders(groups);
}
