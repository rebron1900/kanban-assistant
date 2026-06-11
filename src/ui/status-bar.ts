/// <reference types="obsidian" />

import type { ReminderGroup } from '../types';

export interface StatusBarPlugin {
  addStatusBarItem(): HTMLElement;
}

/**
 * 状态栏文字管理。
 * 在 Obsidian 底部状态栏显示看板概览。
 */
export class StatusBarManager {
  private plugin: StatusBarPlugin;
  private el: HTMLElement | null = null;

  constructor(plugin: StatusBarPlugin) {
    this.plugin = plugin;
  }

  init(): void {
    this.el = this.plugin.addStatusBarItem();
    this.el.style.cssText = `
      display: flex;
      align-items: center;
      gap: 4px;
      font-size: 12px;
    `;
    this.el.setText('📋 看板助手');
  }

  /**
   * 更新状态栏文字。
   */
  update(groups: ReminderGroup[], totalCards: number): void {
    if (!this.el) return;

    const overdue = groups
      .filter((g) => g.level.condition === 'overdue')
      .reduce((s, g) => s + g.cards.length, 0);
    const today = groups
      .filter((g) => g.level.condition === 'due_within' && g.level.days === 0)
      .reduce((s, g) => s + g.cards.length, 0);
    const upcoming = groups
      .filter((g) => g.level.condition === 'due_within' && g.level.days > 0)
      .reduce((s, g) => s + g.cards.length, 0);

    const parts: string[] = [];
    if (overdue > 0) parts.push(`🔴${overdue}`);
    if (today > 0) parts.push(`🟠${today}`);
    if (upcoming > 0) parts.push(`🟡${upcoming}`);

    if (parts.length > 0) {
      this.el.setText(`📋 看板 ${parts.join(' · ')}`);
    } else {
      this.el.setText(`📋 看板 ✅${totalCards ? ` (${totalCards}张卡)` : ''}`);
    }
  }

  destroy(): void {
    this.el?.remove();
    this.el = null;
  }
}
