/// <reference types="obsidian" />

// ============================================================
// 核心数据结构
// ============================================================

/**
 * 看板助手 — 提醒级别定义
 */
export interface ReminderLevel {
  name: string;
  condition: 'overdue' | 'due_within' | 'created_since';
  days: number;
  prefix: string;
  enabled: boolean;
}

/**
 * 解析出的看板卡片
 */
export interface KanbanCard {
  sourceFile: string;
  sourceBoard: string;
  listName: string;
  title: string;
  date: string | null;
  isComplete: boolean;
  isArchived: boolean;
  /** 首次被插件扫描到的时间戳（ms），来自缓存 */
  firstSeen?: number;
}

/**
 * 按级别分组的提醒结果
 */
export interface ReminderGroup {
  level: ReminderLevel;
  cards: KanbanCard[];
}

// ============================================================
// 缓存（增量扫描 + 老化追踪）
// ============================================================

/** 单文件的缓存状态 */
export interface FileCacheEntry {
  mtime: number;           // 文件修改时间戳
  fingerprints: string[];  // 该文件下所有卡片的指纹
}

/** 全量缓存 */
export interface ScanCache {
  version: number;
  lastScan: number;
  files: Record<string, FileCacheEntry>;
  /** 指纹 → 首次出现时间戳 */
  firstSeen: Record<string, number>;
}

// ============================================================
// 看板独立配置 & 排除规则
// ============================================================

/** 单看板的配置覆盖 */
export interface BoardConfig {
  enabled: boolean;
  /** 若设此值则覆盖全局 levels */
  levels: ReminderLevel[] | null;
  /** 忽略的列表名 */
  excludedLists: string[];
  /** 忽略的标签字符串 */
  excludedTags: string[];
}

/** 排除规则 */
export interface ExclusionRule {
  type: 'board' | 'list' | 'tag';
  value: string;
  enabled: boolean;
}

// ============================================================
// Daily Note 注入
// ============================================================

export interface DailyNoteConfig {
  enabled: boolean;
  /** 模板：可用 {{summary}} {{overdue}} {{today}} {{upcoming}} 占位 */
  template: string;
  /** 相对于文件的插入位置：顶部或底部 */
  position: 'top' | 'bottom';
  /** 匹配日记文件的正则（默认匹配 YYYY-MM-DD.md / YYYY年MM月DD日.md） */
  filenamePattern: string;
}

// ============================================================
// 老化追踪数据
// ============================================================

export interface TrackerSnapshot {
  date: string;          // YYYY-MM-DD
  totalCards: number;
  completedToday: number;
  overdueCount: number;
}

export interface TrackerData {
  enabled: boolean;
  /** 每日快照 */
  history: TrackerSnapshot[];
  /** 上周平均完成数（移动平均） */
  weeklyAvgCompletion: number;
}

// ============================================================
// 诊断日志
// ============================================================

export interface LogEntry {
  timestamp: number;
  level: 'info' | 'warn' | 'error';
  message: string;
  detail?: string;
}

// ============================================================
// 插件总设置（序列化到 plugin data）
// ============================================================

export interface PluginSettings {
  // — 通用 —
  /** 自动检查间隔（分钟），0 = 仅启动时 */
  checkInterval: number;
  /** 启动时自动检查 */
  autoCheckOnStart: boolean;
  /** 日期正则 */
  datePattern: string;
  /** 提醒级别 */
  levels: ReminderLevel[];

  // — 缓存（Phase 1） —
  /** 扫描缓存，用于增量更新和老化追踪 */
  cache: ScanCache;

  // — 看板独立配置（Phase 3） —
  /** 按文件路径 → 配置 */
  boards: Record<string, BoardConfig>;
  /** 全局排除规则 */
  exclusions: ExclusionRule[];

  // — Daily Note（Phase 4） —
  /** Daily Note 注入配置 */
  dailyNote: DailyNoteConfig;

  // — 老化追踪（Phase 5） —
  /** 老化追踪配置和数据 */
  tracker: TrackerData;

  // — 诊断日志 —
  /** 最近的日志条目环形缓冲 */
  logs: LogEntry[];
}

// ============================================================
// 默认值
// ============================================================

export const DEFAULT_LEVELS: ReminderLevel[] = [
  { name: '逾期', condition: 'overdue', days: 0, prefix: '🔴', enabled: true },
  { name: '今日到期', condition: 'due_within', days: 0, prefix: '🟠', enabled: true },
  { name: '近3天', condition: 'due_within', days: 3, prefix: '🟡', enabled: true },
  { name: '未来一周', condition: 'due_within', days: 7, prefix: '🔵', enabled: true },
];

export const DEFAULT_SETTINGS: PluginSettings = {
  checkInterval: 30,
  autoCheckOnStart: true,
  datePattern: '\\{(\\d{4}-\\d{2}-\\d{2})\\}',
  levels: DEFAULT_LEVELS,

  cache: {
    version: 1,
    lastScan: 0,
    files: {},
    firstSeen: {},
  },

  boards: {},
  exclusions: [],

  dailyNote: {
    enabled: false,
    template: `## ⏰ 看板提醒

{{overdue}}
{{today}}
{{upcoming}}
`,
    position: 'top',
    filenamePattern: '',
  },

  tracker: {
    enabled: false,
    history: [],
    weeklyAvgCompletion: 0,
  },

  logs: [],
};
