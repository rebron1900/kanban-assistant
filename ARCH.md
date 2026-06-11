# 看板助手 — 迭代架构 V2

## 当前问题

- `main.ts` 又当生命周期又当设置面板，已 ~270 行
- `reminder.ts` 只有分类+Notice，未来逻辑会膨胀
- 数据模型（`types.ts`）太浅，不够支撑新功能
- 每次全量扫描所有文件，无缓存
- 无诊断/日志能力

## 目标架构

```
src/
├── main.ts           # 插件生命周期 + 核心编排（轻量）
├── types.ts          # 全量类型定义（所有功能的数据结构）
├── parser.ts         # 看板文件解析器
├── reminder.ts       # 卡片分类 + Notice/Modal 弹窗
├── cache.ts          # 增量扫描缓存 + 文件变更监听 [NEW]
├── tracker.ts        # 卡片状态追踪 + 老化分析 [NEW]
├── injector.ts       # Daily Note 注入引擎 [NEW]
├── ui/
│   ├── settings.ts   # 设置页面 [从 main.ts 拆分]
│   ├── ribbon.ts     # Ribbon 角标 + 未读计数 [NEW]
│   └── status-bar.ts # 状态栏文字 [NEW]
└── logger.ts         # 诊断日志面板 [NEW]
```

**数据流（新架构）：**

```
vault files
    │
    ▼
parser.ts  ←── cache.ts（增量/全量）
    │                    │
    ▼                    ▼
reminder.ts → Notice / Modal / Ribbon badge
    │
    ├──→ injector.ts（Daily Note 写入）
    └──→ tracker.ts（老化数据存储）
              │
              ▼
          logger.ts（诊断面板）
```

## 实施阶段

### Phase 0：数据模型重构
更新 `types.ts`，新增所有功能所需的数据结构，不改逻辑。
- 新的设置字段（daily note 开关、排除规则、看板独立配置等）
- KanbanCard 扩展（addedAt、boardConfig 引用）
- 缓存类型定义
- 追踪/老化数据类型

### Phase 1：基础能力（#5 技术底子）
- `cache.ts`：扫描结果缓存，首次全量后增量
- `logger.ts`：诊断日志，记录每次扫描耗时、卡片数、错误
- `main.ts`：注册 vault.on('modify') 文件变更监听
- 设置页新增「诊断」子面板

### Phase 2：UI 升级（#1 交互升级）
- `ui/ribbon.ts`：侧栏图标 + 数字角标（今日到期数 / 逾期数）
- `ui/status-bar.ts`：底部状态栏文字
- `ui/settings.ts`：设置页拆分到独立文件

### Phase 3：配置升级（#4 配置升级）
- 看板独立配置（每个看板文件可设置不同的提醒级别）
- 排除规则（忽略列表/标签）
- 黑白名单（只看某些看板文件）

### Phase 4：Daily Note 注入（#3）
- `injector.ts`：扫描后自动写入每日笔记
- 设置页控制开关 + 格式模板

### Phase 5：老化分析（#2 卡片老化分析）
- `tracker.ts`：首次出现时间 → 泳道停留时长
- 每周简报：本周完成率、逾期趋势、最长滞留卡

## 关键设计决策

1. **缓存格式**：JSON 序列化到 plugin data，key 用文件 path+修改时间戳做差分
2. **文件变更**：`vault.on('modify', file)` 只重新解析变更的看板文件，不触发全量
3. **老化时间**：卡片首次出现的日期来自缓存记录，不是文件系统时间
4. **看板独立配置**：以文件 path 为 key 存储在 settings.boards 对象中
5. **Daily Note 格式**：通过正则匹配当前日期文件，支持 `YYYY-MM-DD` 和 `YYYY年MM月DD日` 等常见格式
