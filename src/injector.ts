/// <reference types="obsidian" />

import { App, TFile } from 'obsidian';
import type { ReminderGroup, PluginSettings } from './types';

/**
 * Daily Note 注入引擎。
 * 将提醒结果写入当天的日记文件。
 */
export class DailyNoteInjector {
  private app: App;

  constructor(app: App) {
    this.app = app;
  }

  /**
   * 执行注入：找到今日日记 → 写入提醒区块。
   */
  async inject(
    groups: ReminderGroup[],
    totalCards: number,
    settings: PluginSettings,
  ): Promise<void> {
    if (!settings.dailyNote.enabled) return;

    const file = await this.findDailyNote(settings.dailyNote.filenamePattern);
    if (!file) return; // 今日日记不存在，静默跳过

    const content = await this.app.vault.read(file);
    const block = this.buildBlock(groups, totalCards, settings.dailyNote.template);

    // 检查是否已存在今日的看板区块（避免重复注入）
    if (content.includes('<!-- kanban-assistant-start -->')) {
      // 替换已有区块
      const updated = this.replaceExistingBlock(content, block);
      if (updated !== content) {
        await this.app.vault.modify(file, updated);
      }
      return;
    }

    // 首次注入
    const updated = this.insertBlock(content, block, settings.dailyNote.position);
    await this.app.vault.modify(file, updated);
  }

  /**
   * 根据日记文件名模式找今日的文件。
   */
  private async findDailyNote(pattern: string): Promise<TFile | null> {
    const today = new Date();
    const y = today.getFullYear();
    const m = String(today.getMonth() + 1).padStart(2, '0');
    const d = String(today.getDate()).padStart(2, '0');

    // 尝试多种常见格式
    const candidates = [
      `${y}-${m}-${d}`,           // 2026-06-11
      `${y}年${today.getMonth()+1}月${today.getDate()}日`, // 2026年6月11日
      `${y}${m}${d}`,             // 20260611
    ];

    for (const file of this.app.vault.getMarkdownFiles()) {
      const basename = file.basename;
      for (const cand of candidates) {
        if (basename === cand) return file;
      }
      // 如果用户提供了自定义模式
      if (pattern) {
        try {
          const re = new RegExp(pattern);
          if (re.test(basename)) return file;
        } catch {}
      }
    }

    return null;
  }

  /**
   * 构建提醒区块的文本内容。
   */
  private buildBlock(
    groups: ReminderGroup[],
    totalCards: number,
    template: string,
  ): string {
    const parts: string[] = [];

    const overdue = groups.filter((g) => g.level.condition === 'overdue');
    const today = groups.filter(
      (g) => g.level.condition === 'due_within' && g.level.days === 0,
    );
    const upcoming = groups.filter(
      (g) => g.level.condition === 'due_within' && g.level.days > 0,
    );

    const fmtCards = (title: string, group: ReminderGroup[]): string => {
      if (group.length === 0) return '';
      const lines = group.flatMap((g) =>
        g.cards.map((c) => `- [ ] ${c.title}${c.date ? ` (${c.date})` : ''} 📍${c.sourceBoard}`),
      );
      const count = group.reduce((s, g) => s + g.cards.length, 0);
      return `### ${title}（${count}项）\n${lines.join('\n')}`;
    };

    const overdueText = fmtCards('🔴 逾期', overdue);
    const todayText = fmtCards('🟠 今日到期', today);
    const upcomingText = fmtCards('🟡 近期待办', upcoming);

    if (overdueText) parts.push(overdueText);
    if (todayText) parts.push(todayText);
    if (upcomingText) parts.push(upcomingText);

    if (parts.length === 0) {
      parts.push(`✅ 看板检查完毕，无待提醒任务（共 ${totalCards} 张卡片）`);
    }

    const body = parts.join('\n\n');
    return [
      '',
      '<!-- kanban-assistant-start -->',
      body,
      '<!-- kanban-assistant-end -->',
      '',
    ].join('\n');
  }

  /**
   * 将区块插入文件的开头或结尾。
   */
  private insertBlock(
    content: string,
    block: string,
    position: 'top' | 'bottom',
  ): string {
    if (position === 'top') {
      // 插在 frontmatter 后面（如果有）
      const frontmatterEnd = this.findFrontmatterEnd(content);
      const insertAt = frontmatterEnd !== -1 ? frontmatterEnd : 0;
      return (
        content.slice(0, insertAt) +
        block +
        '\n' +
        content.slice(insertAt)
      );
    }
    // bottom
    return content + '\n' + block;
  }

  /**
   * 替换文件中已有的看板区块。
   */
  private replaceExistingBlock(content: string, newBlock: string): string {
    const startMarker = '<!-- kanban-assistant-start -->';
    const endMarker = '<!-- kanban-assistant-end -->';
    const startIdx = content.indexOf(startMarker);
    const endIdx = content.indexOf(endMarker);

    if (startIdx === -1 || endIdx === -1) return content;

    return (
      content.slice(0, startIdx) +
      newBlock.trim() +
      '\n' +
      content.slice(endIdx + endMarker.length)
    );
  }

  private findFrontmatterEnd(content: string): number {
    if (!content.startsWith('---')) return 0;
    const second = content.indexOf('---', 3);
    if (second === -1) return 0;
    // 跳过第二行 --- 以及后面的空行
    let pos = second + 3;
    while (pos < content.length && content[pos] === '\n') pos++;
    return pos;
  }
}
