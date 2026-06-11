/// <reference types="obsidian" />

import { Notice } from 'obsidian';
import type { KanbanCard, PluginSettings, ReminderGroup, ReminderLevel } from './types';
import { getBoardLevels } from './parser';

/**
 * 按看板的独立配置（如有）分类卡片。
 * 全局 levels 作为 fallback。
 */
export function classifyCards(
  cards: KanbanCard[],
  levels: ReminderLevel[],
  today: string,
): ReminderGroup[] {
  const todayDate = new Date(today);
  const enabledLevels = levels.filter((l) => l.enabled);
  const used = new Set<number>();
  const groups: ReminderGroup[] = [];

  for (const level of enabledLevels) {
    const matched: KanbanCard[] = [];
    for (let i = 0; i < cards.length; i++) {
      if (used.has(i)) continue;
      const card = cards[i];
      if (card.isComplete || card.isArchived) { used.add(i); continue; }
      if (matchCondition(card, level, todayDate)) {
        matched.push(card);
        used.add(i);
      }
    }
    if (matched.length > 0) groups.push({ level, cards: matched });
  }

  return groups;
}

/**
 * 按看板分组分类：每个看板可能使用自己的 levels。
 */
export function classifyPerBoard(
  cards: KanbanCard[],
  settings: PluginSettings,
  today: string,
): ReminderGroup[] {
  // 按看板文件分组
  const boardGroups = new Map<string, KanbanCard[]>();
  for (const card of cards) {
    const list = boardGroups.get(card.sourceFile) || [];
    list.push(card);
    boardGroups.set(card.sourceFile, list);
  }

  const allGroups: ReminderGroup[] = [];

  for (const [, boardCards] of boardGroups) {
    const boardLevels = boardCards.length > 0
      ? getBoardLevels(settings, boardCards[0].sourceFile)
      : null;
    const effectiveLevels = boardLevels || settings.levels;
    const groups = classifyCards(boardCards, effectiveLevels, today);
    allGroups.push(...groups);
  }

  // 按 level name 合并同类组（相同级别名的合并）
  return mergeGroups(allGroups);
}

function mergeGroups(groups: ReminderGroup[]): ReminderGroup[] {
  const merged = new Map<string, ReminderGroup>();
  for (const group of groups) {
    const key = group.level.name;
    const existing = merged.get(key);
    if (existing) {
      existing.cards.push(...group.cards);
    } else {
      merged.set(key, { level: group.level, cards: [...group.cards] });
    }
  }
  // 保持原始顺序
  const seen = new Set<string>();
  const result: ReminderGroup[] = [];
  for (const group of groups) {
    if (!seen.has(group.level.name)) {
      seen.add(group.level.name);
      const m = merged.get(group.level.name);
      if (m) result.push(m);
    }
  }
  return result;
}

function matchCondition(card: KanbanCard, level: ReminderLevel, today: Date): boolean {
  switch (level.condition) {
    case 'overdue': return isOverdue(card, today);
    case 'due_within': return isDueWithin(card, today, level.days);
    case 'created_since': return card.date === null;
    default: return false;
  }
}

function isOverdue(card: KanbanCard, today: Date): boolean {
  if (!card.date) return false;
  const d = parseDate(card.date);
  return d ? d < today : false;
}

function isDueWithin(card: KanbanCard, today: Date, days: number): boolean {
  if (!card.date) return false;
  const d = parseDate(card.date);
  if (!d || d < today) return false;
  const diff = Math.ceil((d.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  return diff <= days;
}

function parseDate(s: string): Date | null {
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? new Date(parseInt(m[1]), parseInt(m[2]) - 1, parseInt(m[3])) : null;
}

export function getTodayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function showReminders(groups: ReminderGroup[]): void {
  if (groups.length === 0) {
    new Notice('✅ 看板检查完毕，无待提醒任务');
    return;
  }
  for (const group of groups) {
    const emoji = group.level.prefix || '📌';
    const titleLine = `${emoji} ${group.level.name}（${group.cards.length}项）`;
    const lines = group.cards
      .slice(0, 10)
      .map((c) => `  · ${c.title}${c.date ? ` (${c.date})` : ''} [${c.sourceBoard}]`)
      .join('\n');
    const more = group.cards.length > 10 ? `\n  ...及其他 ${group.cards.length - 10} 项` : '';
    new Notice(`${titleLine}\n${lines}${more}`, 6000);
  }
}
