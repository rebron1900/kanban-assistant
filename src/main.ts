/// <reference types="obsidian" />

import { App, Notice, Plugin, PluginSettingTab, Setting, TFile } from 'obsidian';
import type { PluginSettings, ReminderLevel, KanbanCard } from './types';
import { DEFAULT_SETTINGS } from './types';
import { scanAllBoards, parseKanbanMd } from './parser';
import { runReminderCheck } from './reminder';
import { updateCache, getChangedFiles, getFileStats } from './cache';
import { addLog, formatLogs, logStats } from './logger';

export default class KanbanAssistantPlugin extends Plugin {
  settings: PluginSettings;
  private timer: number | null = null;
  /** 防抖定时器 */
  private watchDebounce: number | null = null;

  async onload() {
    await this.loadSettings();

    this.addSettingTab(new KanbanAssistantSettingTab(this.app, this));

    this.addCommand({
      id: 'check-reminders',
      name: '立即检查提醒',
      callback: () => this.checkReminders(),
    });

    // — 文件变更监听（增量更新） —
    this.registerEvent(
      this.app.vault.on('modify', (file: any) => {
        if (file instanceof TFile && file.extension === 'md') this.debouncedCheck();
      }),
    );
    this.registerEvent(
      this.app.vault.on('create', (file: any) => {
        if (file instanceof TFile && file.extension === 'md') this.debouncedCheck();
      }),
    );
    this.registerEvent(
      this.app.vault.on('delete', (file: any) => {
        if (file instanceof TFile && file.extension === 'md') this.debouncedCheck();
      }),
    );

    if (this.settings.autoCheckOnStart) {
      window.setTimeout(() => this.checkReminders(), 3000);
    }

    this.scheduleTimer();
  }

  onunload() {
    this.clearTimer();
    this.clearWatchDebounce();
  }

  async loadSettings() {
    const saved = (await this.loadData()) as Partial<PluginSettings> | null;
    this.settings = Object.assign({}, DEFAULT_SETTINGS, saved || {});
  }

  async saveSettings() {
    await this.saveData(this.settings);
    this.scheduleTimer();
  }

  // ————— 文件变更处理 —————

  private debouncedCheck() {
    this.clearWatchDebounce();
    this.watchDebounce = window.setTimeout(() => {
      this.checkReminders();
    }, 2000); // 2 秒防抖，避免批量操作频繁触发
  }

  private clearWatchDebounce() {
    if (this.watchDebounce !== null) {
      window.clearTimeout(this.watchDebounce);
      this.watchDebounce = null;
    }
  }

  // ————— 定时器管理 ——————

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

  // ————— 核心：扫描 + 分类 + 提醒 —————

  async checkReminders() {
    try {
      const t0 = performance.now();

      // 1. 增量扫描（只读变更过的文件）
      const cards = await this.scanWithCache();

      // 2. 分类 + 提醒
      await runReminderCheck(cards, this.settings);

      // 3. 更新缓存并保存
      this.settings.cache = updateCache(
        this.settings.cache,
        cards,
        getFileStats(this.app.vault.getMarkdownFiles()),
      ).cache;

      // 4. 记录日志
      const elapsed = Math.round(performance.now() - t0);
      this.settings.logs = addLog(
        this.settings.logs,
        'info',
        `扫描完成：${cards.length} 张卡片，耗时 ${elapsed}ms`,
      );

      await this.saveSettings();
    } catch (e) {
      console.error('看板助手检查失败:', e);
      this.settings.logs = addLog(
        this.settings.logs,
        'error',
        '检查失败',
        String(e),
      );
      await this.saveSettings();
      new Notice('⚠️ 看板助手检查失败，详见控制台');
    }
  }

  /**
   * 增量扫描：利用缓存避免全量重读。
   */
  private async scanWithCards(): Promise<KanbanCard[]> {
    const files = this.app.vault.getMarkdownFiles();
    const fileStats = getFileStats(files);
    const { changed, removed, fullRescan } = getChangedFiles(
      this.settings.cache,
      fileStats,
    );

    // 删除的看板：从缓存中移除
    for (const path of removed) {
      delete this.settings.cache.files[path];
    }

    let allCards: KanbanCard[] = [];

    if (fullRescan || changed.length > 10) {
      // 变更太多，全量扫
      this.settings.logs = addLog(
        this.settings.logs,
        'info',
        `全量扫描（${changed.length === 0 ? '首次' : changed.length + ' 个文件变更'}）`,
      );
      allCards = await scanAllBoards(this.app, this.settings.datePattern);
    } else {
      // 增量：只重读变更文件
      const dateRegex = new RegExp(this.settings.datePattern, 'g');
      const newCards: KanbanCard[] = [];

      for (const file of files) {
        if (changed.includes(file.path)) {
          const content = await this.app.vault.read(file);
          if (!content.includes('kanban-plugin')) {
            // 文件不再是看板了，跳过
            delete this.settings.cache.files[file.path];
            continue;
          }
          const parsed = parseKanbanMd(content, file.path, dateRegex);
          newCards.push(...parsed);
        }
      }

      // 从缓存取未变更文件的卡片
      for (const [filePath, entry] of Object.entries(this.settings.cache.files)) {
        if (!changed.includes(filePath)) {
          // 需要从缓存重建这些卡片——但我们只缓存了指纹，没缓存完整卡对象
          // 所以还是需要解析这些文件
          // 优化：如果 future 缓存了卡片数据，可以跳过
          const file = this.app.vault.getAbstractFileByPath(filePath);
          if (file instanceof TFile) {
            const content = await this.app.vault.read(file);
            const parsed = parseKanbanMd(content, filePath, dateRegex);
            newCards.push(...parsed);
          }
        }
      }

      allCards = newCards;
    }

    return allCards;
  }

  /**
   * 带缓存的扫描：使用缓存数据填充 firstSeen。
   */
  private async scanWithCache(): Promise<import('./types').KanbanCard[]> {
    const cards = await this.scanWithCards();
    // 从缓存填充 firstSeen
    return cards.map((c) => {
      const fp = `${c.sourceFile}::${c.listName}::${c.title}`;
      return {
        ...c,
        firstSeen: this.settings.cache.firstSeen[fp] || Date.now(),
      };
    });
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

    // — 通用设置 —
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

    new Setting(containerEl)
      .setName('立即检查')
      .setDesc('手动触发一次扫描和提醒')
      .addButton((b) =>
        b.setButtonText('🔍 立即检查').onClick(() => {
          this.plugin.checkReminders();
        }),
      );

    containerEl.createEl('hr');

    // — 提醒级别管理 —
    containerEl.createEl('h3', { text: '提醒级别' });
    containerEl.createEl('p', {
      text: '级别按从上到下的顺序匹配，一张卡片只进入第一个符合条件的级别。',
      cls: 'setting-item-description',
    });

    const levelContainer = containerEl.createDiv();

    const renderLevels = () => {
      levelContainer.empty();
      const levels = this.plugin.settings.levels;

      levels.forEach((level, i) => {
        const item = levelContainer.createDiv({ cls: 'setting-item' });
        const setting = new Setting(item);
        setting.setName(`#${i + 1} ${level.name || '未命名'}`);

        setting.addText((t) =>
          t.setValue(level.name).setPlaceholder('级别名').onChange(async (v) => {
            this.plugin.settings.levels[i].name = v;
            await this.plugin.saveSettings();
          }),
        );
        setting.addDropdown((d) =>
          d
            .addOption('overdue', '逾期')
            .addOption('due_within', '到期前N天')
            .addOption('created_since', '创建超N天（无日期卡）')
            .setValue(level.condition)
            .onChange(async (v) => {
              this.plugin.settings.levels[i].condition = v as ReminderLevel['condition'];
              await this.plugin.saveSettings();
            }),
        );
        setting.addText((t) =>
          t.setValue(String(level.days)).setPlaceholder('天数').onChange(async (v) => {
            const n = parseInt(v);
            if (!isNaN(n)) {
              this.plugin.settings.levels[i].days = n;
              await this.plugin.saveSettings();
            }
          }),
        );

        new Setting(item)
          .addText((t) =>
            t.setValue(level.prefix).setPlaceholder('前缀').onChange(async (v) => {
              this.plugin.settings.levels[i].prefix = v;
              await this.plugin.saveSettings();
            }),
          )
          .addToggle((t) =>
            t.setValue(level.enabled).setTooltip('启用/禁用').onChange(async (v) => {
              this.plugin.settings.levels[i].enabled = v;
              await this.plugin.saveSettings();
            }),
          )
          .addExtraButton((b) =>
            b.setIcon('trash').setTooltip('删除此级别').onClick(async () => {
              this.plugin.settings.levels.splice(i, 1);
              await this.plugin.saveSettings();
              renderLevels();
            }),
          );
      });

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

    // — 诊断面板 —
    containerEl.createEl('hr');
    containerEl.createEl('h3', { text: '诊断日志' });

    const logContainer = containerEl.createDiv();

    const renderLogs = () => {
      logContainer.empty();
      const stats = logStats(this.plugin.settings.logs);
      new Setting(logContainer)
        .setName(`总计：ℹ️${stats.info}  ⚠️${stats.warn}  ❌${stats.error}`)
        .addButton((b) =>
          b.setButtonText('🔄 刷新').onClick(() => renderLogs()),
        )
        .addButton((b) =>
          b.setButtonText('🗑️ 清空').onClick(async () => {
            this.plugin.settings.logs = [];
            await this.plugin.saveSettings();
            renderLogs();
          }),
        );

      const logText = logContainer.createEl('pre', {
        text: formatLogs(this.plugin.settings.logs),
        cls: 'kanban-log-output',
      });
      logText.style.maxHeight = '400px';
      logText.style.overflow = 'auto';
      logText.style.background = 'var(--background-secondary)';
      logText.style.padding = '8px';
      logText.style.fontSize = '12px';
      logText.style.whiteSpace = 'pre-wrap';
    };

    renderLogs();
  }
}
