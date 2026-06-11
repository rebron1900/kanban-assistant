/// <reference types="obsidian" />

import type { ReminderGroup } from '../types';

/**
 * Ribbon 角标需要的插件接口（避免循环引用）。
 */
export interface RibbonPlugin {
  addRibbonIcon(icon: string, title: string, callback: () => void): HTMLElement;
  checkReminders(): void;
}

/**
 * Ribbon 角标管理。
 * 侧栏图标 + 数字角标（逾期数+今日到期数）。
 */
export class RibbonManager {
  private plugin: RibbonPlugin;
  private iconEl: HTMLElement | null = null;
  private badgeEl: HTMLElement | null = null;

  constructor(plugin: RibbonPlugin) {
    this.plugin = plugin;
  }

  /** 创建 ribbon 图标。在 plugin.onload 中调用。 */
  init(): void {
    this.iconEl = this.plugin.addRibbonIcon(
      'bell-ring',
      '看板助手 — 检查提醒',
      () => {
        this.plugin.checkReminders();
      },
    );

    // 创建角标元素
    this.badgeEl = this.iconEl.createEl('span', {
      cls: 'kanban-ribbon-badge',
    });
    this.badgeEl.style.cssText = `
      position: absolute;
      top: 2px;
      right: 2px;
      background: var(--color-red);
      color: white;
      font-size: 9px;
      font-weight: 700;
      min-width: 16px;
      height: 16px;
      line-height: 16px;
      text-align: center;
      border-radius: 8px;
      padding: 0 4px;
      pointer-events: none;
      display: none;
    `;
  }

  /**
   * 更新角标数字。
   * 无紧急卡片时不显示。
   */
  update(groups: ReminderGroup[]): void {
    if (!this.badgeEl) return;

    // 计算紧急总数：逾期 + 今日到期
    const urgentCount = groups
      .filter(
        (g) =>
          g.level.condition === 'overdue' ||
          (g.level.condition === 'due_within' && g.level.days === 0),
      )
      .reduce((sum, g) => sum + g.cards.length, 0);

    if (urgentCount > 0) {
      this.badgeEl.textContent = String(Math.min(urgentCount, 99));
      this.badgeEl.style.display = 'block';
    } else {
      this.badgeEl.style.display = 'none';
    }
  }

  /** 卸载时清理。 */
  destroy(): void {
    this.iconEl?.remove();
    this.iconEl = null;
    this.badgeEl = null;
  }
}
