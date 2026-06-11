# Spec: Kanban Reminder Plugin

## Objective

一个 Obsidian 社区插件，扫描 kanban 看板中的卡片，根据配置的时间窗口和卡片日期（到期日/创建时间），按优先级分组后以 Notice 弹窗提醒用户。

**用户故事：**
- 启动 Obsidian 时，自动弹窗提示未来有截止日期的任务
- 按紧急程度分多个级别（如"逾期/今日到期/近3天/预览"），同级别合并为一条通知
- 在插件设置中可自定义每个级别的时间范围和通知样式

## Tech Stack

- **运行时：** Obsidian (plugin API v1.x+)
- **语言：** TypeScript
- **打包：** esbuild（Obsidian 社区插件标准）
- **依赖：** 无外部依赖（只依赖 Obsidian API + Kanban 插件文件格式）
- **协同：** 读取 `obsidian-kanban` 插件的 markdown 文件（不依赖其 API，只读文件格式）

## 已知数据格式（Kanban 插件）

```markdown
---
kanban-plugin: board
---

## 待办

- [ ] 任务标题 {2026-06-15}
- [ ] 带时间的任务 @{2026-06-15} @@{14:30}
- [ ] 带标签的任务 #urgent
- [ ] 带元数据的任务 due:: 2026-06-20

## 进行中

- [ ] 活跃任务 {2026-06-12}
- [ ] **Complete** 已完成任务 {2026-06-10}

## 归档

***  ← 三个星号以下是归档卡片

- [ ] 已归档旧任务 {2026-05-01}
```

核心规则：
- 日期在 `{YYYY-MM-DD}` 花括号内（默认触发器，可在 Kanban 设置中自定义）
- 完成项：标题中有 `**Complete**` 标记（不再提醒）
- 归档项：在 `***` 分隔线以下（不再提醒）
- 各看板文件：frontmatter 有 `kanban-plugin: board` 标识
- 文件创建时间（`stat.ctime`）可作为卡片"创建时间"的 fallback

## Commands

```bash
# 开发
npm install
npm run dev     # esbuild watch mode
npm run build   # 生产构建

# 产物输出到 main.js + manifest.json + styles.css
```

## Project Structure

```
kanban-reminder/
├── manifest.json          # Obsidian 插件清单
├── package.json           # 依赖和脚本
├── tsconfig.json          # TypeScript 配置
├── esbuild.config.mjs     # 构建配置
├── version.json           # 版本管理
├── src/
│   ├── main.ts            # 插件入口，生命周期，命令注册
│   ├── settings.ts        # 设置界面 + 设置类型定义
│   ├── reminder.ts        # 核心提醒逻辑：扫描 → 分类 → 弹窗
│   ├── parser.ts          # Kanban markdown 解析器（提取卡片 + 日期）
│   └── types.ts           # 类型定义
└── styles.css             # 弹窗样式（可选增强）
```

## Code Style

尊重 Obsidian 社区插件惯例：

```typescript
// 插件主类
export default class KanbanReminderPlugin extends Plugin {
  settings: PluginSettings;
  private timer: number | null = null;

  async onload() {
    await this.loadSettings();
    this.addSettingTab(new KanbanReminderSettingTab(this.app, this));

    // 启动时触发一次
    if (this.settings.autoCheckOnStart) {
      this.scheduleCheck(3000); // 延迟 3s 等 Obsidian 完全加载
    }
  }
}

// 设置接口
interface PluginSettings {
  checkInterval: number;           // 扫描间隔（分钟），0 = 仅启动
  autoCheckOnStart: boolean;
  levels: ReminderLevel[];         // 自定义提醒级别
}

// 提醒级别
interface ReminderLevel {
  name: string;                    // 级别名称，如"紧急"
  condition: 'overdue' | 'due_within' | 'created_since';
  days: number;                    // 时间阈值
  color: string;                   // Notice 背景色（CSS 类名或颜色值）
  enabled: boolean;
}
```

## Testing Strategy

- 通过 `obsidian-tasks` 或 `kanban-plugin` 的真实 markdown 文件做集成测试
- 手动验证：创建测试看板 → 启动 Obsidian → 看弹窗效果
- 核心解析逻辑可用 Node.js 独立测试（mock Obsidian API）

## Boundaries

- **Always:**
  - 启动延迟 3 秒再扫描（等 Obsidian 完全加载）
  - 每级别只弹一条 Notice（合并展示）
  - 忽略含有 `**Complete**` 的卡片
  - 忽略 `***` 分隔线以下的归档卡片
  - 扫描完成后清理已完成的旧通知

- **Ask first:**
  - 增加新的 api/命令暴露给用户
  - 依赖第三方库
  - 修改 kanban 插件本身的数据

- **Never:**
  - 修改用户的 kanban 数据文件
  - 写入非插件自己的数据目录
  - 在未确认前创建 Obsidian 命令或热键

## Success Criteria

1. 启动 Obsidian 后，有"今日到期"任务时自动弹出 Notice
2. 同一级别多个任务合并在一条通知中
3. 设置页面可以增删改提醒级别（时间窗口 + 颜色）
4. 点击 Notice 后可跳转到对应看板
5. 扫描 ~20 张活跃卡，性能无感（< 100ms）

## Open Questions

1. Notice 点击跳转：Obsidian 的 `Notice` 不支持点击事件。替代方案有：
   - 用 `Modal` 替代（像 Reminder 插件那种弹窗列表）
   - 用 `new Notice()` 只做提示 + 显示卡片数量，详细内容在侧栏面板
   - 用 `requestUrl` 或开个自定义视图
   → **建议**：先做 `Notice`（纯通知），后续增强为 `Modal` 交互

2. 时间触发器的自定义：Kanban 插件允许改 date-trigger（默认 `{`）
   → 扫描时直接通过正则 `/ \{[0-9]{4}-[0-9]{2}-[0-9]{2}\} /` 匹配日期即可，不依赖触发器配置

3. 多看板支持：扫描全库含 `kanban-plugin: board` 的所有文件
