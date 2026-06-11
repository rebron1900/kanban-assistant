/// <reference types="obsidian" />

import { App, Notice, Plugin, PluginSettingTab, Setting, TFile } from 'obsidian';
import type { PluginSettings, ReminderLevel, KanbanCard } from './types';
import { DEFAULT_SETTINGS } from './types';
import { scanAllBoards, parseKanbanMd, scanFilteredBoards, getBoardLevels } from './parser';
import { classifyCards, classifyPerBoard, showReminders, getTodayISO } from './reminder';
import { updateCache, getChangedFiles, getFileStats } from './cache';
import { addLog, formatLogs, logStats } from './logger';
import { RibbonManager } from './ui/ribbon';
import { StatusBarManager } from './ui/status-bar';
import { DailyNoteInjector } from './injector';

export default class KanbanAssistantPlugin extends Plugin {
  settings: PluginSettings;
  private timer: number | null = null;
  private watchDebounce: number | null = null;
  private ribbon: RibbonManager;
  private statusBar: StatusBarManager;

  async onload() {
    await this.loadSettings();

    // — Ribbon 角标 + 状态栏 —
    this.ribbon = new RibbonManager(this);
    this.ribbon.init();
    this.statusBar = new StatusBarManager(this);
    this.statusBar.init();

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
    this.ribbon?.destroy();
    this.statusBar?.destroy();
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

      // 1. 带过滤的增量扫描（排除规则 + 看板配置）
      const cards = await this.scanWithCache();

      // 2. 按看板分类（每个看板可用自己的 levels）
      const today = getTodayISO();
      const groups = classifyPerBoard(cards, this.settings, today);

      // 3. 弹窗提醒
      showReminders(groups);

      // 4. 更新 Ribbon 角标 + 状态栏
      this.ribbon.update(groups);
      this.statusBar.update(groups, cards.length);

      // 5. 注入到 Daily Note
      const injector = new DailyNoteInjector(this.app);
      await injector.inject(groups, cards.length, this.settings);

      // 5. 更新缓存并保存
      this.settings.cache = updateCache(
        this.settings.cache,
        cards,
        getFileStats(this.app.vault.getMarkdownFiles()),
      ).cache;

      // 6. 记录日志
      const elapsed = Math.round(performance.now() - t0);
      this.settings.logs = addLog(
        this.settings.logs,
        'info',
        `扫描完成：${cards.length} 张卡片，${groups.length} 组提醒，耗时 ${elapsed}ms`,
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
      allCards = await scanFilteredBoards(this.app, this.settings);
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
  private async scanWithCache(): Promise<KanbanCard[]> {
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

    // — Daily Note —
    containerEl.createEl('h3', { text: 'Daily Note 注入' });
    const dnToggle = new Setting(containerEl)
      .setName('启用 Daily Note 注入')
      .setDesc('扫描结果自动写入今天的日记文件')
      .addToggle((t) =>
        t.setValue(this.plugin.settings.dailyNote.enabled).onChange(async (v) => {
          this.plugin.settings.dailyNote.enabled = v;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName('插入位置')
      .setDesc('提醒区块放在日记文件的顶部还是底部')
      .addDropdown((d) =>
        d
          .addOption('top', '顶部')
          .addOption('bottom', '底部')
          .setValue(this.plugin.settings.dailyNote.position)
          .onChange(async (v) => {
            this.plugin.settings.dailyNote.position = v as 'top' | 'bottom';
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName('日记文件名匹配')
      .setDesc('自定义正则。留空则自动匹配常见格式 (YYYY-MM-DD)')
      .addText((t) =>
        t
          .setValue(this.plugin.settings.dailyNote.filenamePattern)
          .setPlaceholder('留空自动')
          .onChange(async (v) => {
            this.plugin.settings.dailyNote.filenamePattern = v;
            await this.plugin.saveSettings();
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

    // — 排除规则 —
    containerEl.createEl('hr');
    containerEl.createEl('h3', { text: '排除规则' });
    containerEl.createEl('p', {
      text: '匹配任意规则的卡片将不会出现在提醒中。',
      cls: 'setting-item-description',
    });

    const exclusionContainer = containerEl.createDiv();
    const renderExclusions = () => {
      exclusionContainer.empty();
      this.plugin.settings.exclusions.forEach((rule, i) => {
        const s = new Setting(exclusionContainer)
          .setName(`规则 ${i + 1}`)
          .addDropdown((d) =>
            d
              .addOption('board', '看板名')
              .addOption('list', '列表名')
              .addOption('tag', '标签')
              .setValue(rule.type)
              .onChange(async (v) => {
                this.plugin.settings.exclusions[i].type = v as any;
                await this.plugin.saveSettings();
              }),
          )
          .addText((t) =>
            t.setValue(rule.value).setPlaceholder('匹配内容').onChange(async (v) => {
              this.plugin.settings.exclusions[i].value = v;
              await this.plugin.saveSettings();
            }),
          )
          .addToggle((t) =>
            t.setValue(rule.enabled).onChange(async (v) => {
              this.plugin.settings.exclusions[i].enabled = v;
              await this.plugin.saveSettings();
            }),
          )
          .addExtraButton((b) =>
            b.setIcon('trash').onClick(async () => {
              this.plugin.settings.exclusions.splice(i, 1);
              await this.plugin.saveSettings();
              renderExclusions();
            }),
          );
      });
      new Setting(exclusionContainer).addButton((b) =>
        b.setButtonText('+ 添加规则').onClick(async () => {
          this.plugin.settings.exclusions.push({ type: 'board', value: '', enabled: true });
          await this.plugin.saveSettings();
          renderExclusions();
        }),
      );
    };
    renderExclusions();

    // — 看板独立配置 —
    containerEl.createEl('hr');
    containerEl.createEl('h3', { text: '看板独立配置' });
    containerEl.createEl('p', {
      text: '为特定看板覆盖全局设置。设好后在右侧"提醒级别"调整该看板的专属级别。',
      cls: 'setting-item-description',
    });

    const boardContainer = containerEl.createDiv();
    const renderBoards = () => {
      boardContainer.empty();
      const boardEntries = Object.entries(this.plugin.settings.boards);
      if (boardEntries.length === 0) {
        boardContainer.createEl('p', {
          text: '暂无配置。使用下方按钮添加看板。',
          cls: 'setting-item-description',
        });
      }
      boardEntries.forEach(([path, config]) => {
        const s = new Setting(boardContainer)
          .setName(config.levels ? `✏️ ${path}` : path)
          .setDesc(`${config.excludedLists.length} 个排除列表`)
          .addToggle((t) =>
            t.setValue(config.enabled).onChange(async (v) => {
              this.plugin.settings.boards[path].enabled = v;
              await this.plugin.saveSettings();
            }),
          )
          .addExtraButton((b) =>
            b.setIcon('trash').onClick(async () => {
              delete this.plugin.settings.boards[path];
              await this.plugin.saveSettings();
              renderBoards();
            }),
          );

        // 展开：排除列表
        const detail = boardContainer.createDiv({ cls: 'setting-item' });
        detail.style.paddingLeft = '40px';
        new Setting(detail)
          .setName('排除列表（逗号分隔）')
          .addText((t) =>
            t
              .setValue(config.excludedLists.join(', '))
              .setPlaceholder('已归档, 将来再说')
              .onChange(async (v) => {
                this.plugin.settings.boards[path].excludedLists = v
                  .split(',')
                  .map((s) => s.trim())
                  .filter(Boolean);
                await this.plugin.saveSettings();
              }),
          );
      });

      new Setting(boardContainer).addButton((b) =>
        b.setButtonText('+ 添加看板').onClick(async () => {
          const path = await askForBoardPath(this.plugin);
          if (path && !this.plugin.settings.boards[path]) {
            this.plugin.settings.boards[path] = {
              enabled: true,
              levels: null,
              excludedLists: [],
              excludedTags: [],
            };
            await this.plugin.saveSettings();
            renderBoards();
          }
        }),
      );
    };
    renderBoards();
  }
}

/**
 * 弹窗让用户选择看板文件路径。
 * 如果 Obsidian 环境支持，用 SuggestModal；否则用 prompt。
 */
async function askForBoardPath(plugin: KanbanAssistantPlugin): Promise<string | null> {
  // 简单方案：用 prompt
  const path = prompt('输入看板文件路径（相对于 vault 根目录）:', '');
  return path?.trim() || null;
}
