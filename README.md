<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/rebron1900/kanban-assistant/main/docs/banner-dark.png">
  <img alt="Kanban Assistant Banner" src="https://raw.githubusercontent.com/rebron1900/kanban-assistant/main/docs/banner-light.png">
</picture>

# 看板助手 (Kanban Assistant)

> 让 Obsidian Kanban 看板不再只是一块板子——它会提醒你该做什么了。

**看板助手** 是一个 Obsidian 社区插件，扫描你的 Kanban 看板卡片，按到期时间智能分级提醒。不做复杂的 Gantt 图，不做花哨的统计——只是在你需要的时候告诉你：有任务快到期了。

## ✨ 功能

- **⏰ 智能分级提醒** — 逾期红色、今日到期橙色、近3天黄色、未来一周蓝色，每级一条 Notice，不刷屏
- **⚙️ 提醒级别可自定义** — 增删级别、改条件、改天数、改颜色前缀，自由搭配
- **🔄 启动 + 定时扫描** — 启动自动查一次，后续按设定间隔（默认 30 分钟）复查
- **🔍 全库自动发现** — 自动扫描 vault 中所有 `kanban-plugin: board` 的看板文件
- **🚫 智能忽略** — 自动跳过已完成（`**Complete**`）和归档（`***` 以下）的卡片
- **📅 日期格式可配** — 默认匹配 `{YYYY-MM-DD}`，也可自定义正则

## 🚀 安装

### 社区插件市场（即将上架）

等待上架审核中。

### 手动安装

1. 从 [Releases](https://github.com/rebron1900/kanban-assistant/releases) 下载 `main.js`、`manifest.json`、`styles.css`
2. 复制到你的 vault 的 `.obsidian/plugins/kanban-assistant/` 目录
3. 在 Obsidian 设置 > 社区插件中启用

### BRAT 安装

如果你使用 [BRAT](https://github.com/TfTHacker/obsidian42-brat) 插件：

```
obsidian://brat?plugin=rebron1900%2Fkanban-assistant
```

## ⚙️ 使用方法

1. 安装并启用插件
2. 打开设置 → 看板助手，配置提醒级别
3. 每次启动 Obsidian 自动提醒，或使用命令 `看板助手: 立即检查提醒`

### 提醒级别配置

```
🔴 逾期      ← 卡片日期已过今天
🟠 今日到期  ← 卡片日期就是今天
🟡 近3天     ← 未来3天内到期
🔵 未来一周  ← 未来7天内到期
```

每个级别可自定义：级别名、条件类型（逾期/到期前N天/创建超N天）、天数阈值、显示前缀、启用开关。

### 日期格式

在设置中修改日期正则，默认匹配 `{YYYY-MM-DD}`。如果你在 Kanban 插件中自定义了日期触发器，在这里同步修改即可。

## 🧩 兼容性

- **依赖插件：** [Obsidian Kanban](https://github.com/mgmeyers/obsidian-kanban)（只读文件，不依赖 API）
- **Obsidian 版本：** ≥ 1.0.0
- **平台：** 桌面端

## 🗺️ 开发路线

- [x] 项目 scaffold + 设置页面
- [ ] 看板文件解析器（扫描全库 + 提取卡片 + 解析日期）
- [ ] 分组提醒逻辑 + Notice 弹窗
- [ ] 已有提醒级别默认值优化
- [ ] 点击 Notice 跳转到对应看板（Modal 升级）
- [ ] 多语言支持

## 🛠️ 本地开发

```bash
git clone https://github.com/rebron1900/kanban-assistant.git
cd kanban-assistant
npm install
npm run dev    # 监听模式
npm run build  # 生产构建
```

## 📄 许可证

MIT

---

*Made with ❤️ by Z先生 & H小姐*
