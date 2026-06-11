/// <reference types="obsidian" />

import { App, Notice, Plugin, PluginSettingTab, Setting } from 'obsidian';
import type { PluginSettings, ReminderLevel } from './types';

// ————— 默认设置 —————

const DEFAULT_LEVELS: ReminderLevel[] = [
  { name: '逾期', condition: 'overdue', days: 0, prefix: '🔴', enabled: true },
  { name: '今日到期', condition: 'due_within', days: 0, prefix: '🟠', enabled: true },
  { name: '近3天', condition: 'due_within', days: 3, prefix: '🟡', enabled: true },
  { name: '未来一周', condition: 'due_within', days: 7, prefix: '🔵', enabled: true },
];

const DEFAULT_SETTINGS: PluginSettings = {
  checkInterval: 30,
  autoCheckOnStart: true,
  datePattern: '\\{(\\d{4}-\\d{2}-\\d{2})\\}',
  levels: DEFAULT_LEVELS,
};

// ————— 插件主类 —————

export default class KanbanAssistantPlugin extends Plugin {
  settings: PluginSettings;
  private timer: number | null = null;

  async onload() {
    await this.loadSettings();

    this.addSettingTab(new KanbanAssistantSettingTab(this.app, this));

    this.addCommand({
      id: 'check-reminders',
      name: '立即检查提醒',
      callback: () => this.checkReminders(),
    });

    if (this.settings.autoCheckOnStart) {
      // 延迟 3 秒确保 Obsidian 完全加载
      window.setTimeout(() => this.checkReminders(), 3000);
    }

    this.scheduleTimer();
  }

  onunload() {
    this.clearTimer();
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
    this.scheduleTimer(); // 设置变更后重新调度
  }

  // ————— 定时器管理 —————

  private scheduleTimer() {
    this.clearTimer();
    if (this.settings.checkInterval > 0) {
      this.timer = window.setInterval(
        () => this.checkReminders(),
        this.settings.checkInterval * 60 * 1000,
      );
    }
  }

  private clearTimer() {
    if (this.timer !== null) {
      window.clearInterval(this.timer);
      this.timer = null;
    }
  }

  // ————— 提醒检查（占位，后续实现） —————

  checkReminders() {
    // 后续实现：扫描 → 解析 → 分类 → 弹窗
    new Notice('🪧 看板助手检查完毕');
  }
}

// ————— 设置页面 —————

class KanbanAssistantSettingTab extends PluginSettingTab {
  plugin: KanbanAssistantPlugin;

  constructor(app: App, plugin: KanbanAssistantPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl('h2', { text: '看板助手 — 设置' });

    new Setting(containerEl)
      .setName('启动时自动检查')
      .setDesc('Obsidian 启动后自动扫描一次看板')
      .addToggle((t) =>
        t.setValue(this.plugin.settings.autoCheckOnStart).onChange(async (v) => {
          this.plugin.settings.autoCheckOnStart = v;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName('定时检查间隔（分钟）')
      .setDesc('设为 0 则仅手动检查或启动时检查')
      .addText((t) =>
        t
          .setValue(String(this.plugin.settings.checkInterval))
          .setPlaceholder('30')
          .onChange(async (v) => {
            const n = parseInt(v);
            if (!isNaN(n) && n >= 0) {
              this.plugin.settings.checkInterval = n;
              await this.plugin.saveSettings();
            }
          }),
      );

    new Setting(containerEl)
      .setName('日期匹配格式')
      .setDesc('正则表达式，用于从卡片标题提取日期。默认匹配 {YYYY-MM-DD}')
      .addText((t) =>
        t
          .setValue(this.plugin.settings.datePattern)
          .setPlaceholder(DEFAULT_SETTINGS.datePattern)
          .onChange(async (v) => {
            if (v.trim()) {
              this.plugin.settings.datePattern = v.trim();
              await this.plugin.saveSettings();
            }
          }),
      );

    containerEl.createEl('h3', { text: '提醒级别' });

    const levelContainer = containerEl.createDiv();

    const renderLevels = () => {
      levelContainer.empty();
      this.plugin.settings.levels.forEach((level, i) => {
        const item = levelContainer.createDiv({ cls: 'setting-item' });

        new Setting(item)
          .setName(`级别 ${i + 1}`)
          .addText((t) =>
            t.setValue(level.name).setPlaceholder('级别名').onChange(async (v) => {
              this.plugin.settings.levels[i].name = v;
              await this.plugin.saveSettings();
            }),
          )
          .addDropdown((d) =>
            d
              .addOption('overdue', '逾期')
              .addOption('due_within', '到期前N天')
              .addOption('created_since', '创建超N天')
              .setValue(level.condition)
              .onChange(async (v) => {
                this.plugin.settings.levels[i].condition = v as ReminderLevel['condition'];
                await this.plugin.saveSettings();
              }),
          )
          .addText((t) =>
            t
              .setValue(String(level.days))
              .setPlaceholder('天数')
              .onChange(async (v) => {
                const n = parseInt(v);
                if (!isNaN(n)) {
                  this.plugin.settings.levels[i].days = n;
                  await this.plugin.saveSettings();
                }
              }),
          )
          .addText((t) =>
            t.setValue(level.prefix).setPlaceholder('前缀').onChange(async (v) => {
              this.plugin.settings.levels[i].prefix = v;
              await this.plugin.saveSettings();
            }),
          )
          .addToggle((t) =>
            t.setValue(level.enabled).onChange(async (v) => {
              this.plugin.settings.levels[i].enabled = v;
              await this.plugin.saveSettings();
            }),
          );
      });

      // 添加级别按钮
      new Setting(levelContainer).addButton((b) =>
        b.setButtonText('+ 添加级别').onClick(async () => {
          this.plugin.settings.levels.push({
            name: '新级别',
            condition: 'due_within',
            days: 14,
            prefix: '🟣',
            enabled: true,
          });
          await this.plugin.saveSettings();
          renderLevels();
        }),
      );
    };

    renderLevels();
  }
}
