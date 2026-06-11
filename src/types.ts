/// <reference types="obsidian" />

/**
 * 看板助手 — 提醒级别定义
 * 用户可自定义多个级别，每个级别决定哪类卡片被提醒
 */
export interface ReminderLevel {
  /** 级别名称，如"逾期"、"今日到期" */
  name: string;
  /**
   * 条件类型：
   * - overdue: 卡片日期已过今天
   * - due_within: 卡片日期在 N 天内到期
   * - created_since: 卡片创建时间距今超过 N 天（用于无日期的卡）
   */
  condition: 'overdue' | 'due_within' | 'created_since';
  /** 时间阈值（天） */
  days: number;
  /** Notice 文字前缀，如 "🔴" */
  prefix: string;
  /** 是否启用 */
  enabled: boolean;
}

export interface PluginSettings {
  /** 自动检查间隔（分钟），0 = 仅启动时检查 */
  checkInterval: number;
  /** 启动时是否自动检查 */
  autoCheckOnStart: boolean;
  /** 日期正则匹配模式（默认匹配 {YYYY-MM-DD}） */
  datePattern: string;
  /** 提醒级别列表 */
  levels: ReminderLevel[];
}

/** 解析出的看板卡片 */
export interface KanbanCard {
  /** 所属文件名 */
  sourceFile: string;
  /** 所属列表/泳道名 */
  listName: string;
  /** 卡片标题 */
  title: string;
  /** 解析出的日期（ISO 格式 YYYY-MM-DD） */
  date: string | null;
  /** 卡片是否已完成 */
  isComplete: boolean;
  /** 是否是归档卡片 */
  isArchived: boolean;
}

/** 按级别分组的提醒结果 */
export interface ReminderGroup {
  level: ReminderLevel;
  cards: KanbanCard[];
}
