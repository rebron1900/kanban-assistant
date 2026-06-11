/**
 * 单元测试：parser 核心逻辑
 * 不依赖 Obsidian API，只测 parseKanbanMd
 */

// 模拟 parseKanbanMd 所需的类型
interface KanbanCard {
  sourceFile: string;
  sourceBoard: string;
  listName: string;
  title: string;
  date: string | null;
  isComplete: boolean;
  isArchived: boolean;
}

// 直接从 parser.ts 复制 parseKanbanMd 的核心逻辑（不依赖 Obsidian 导入）
function parseKanbanMd(
  content: string,
  sourcePath: string,
  dateRegex: RegExp,
): KanbanCard[] {
  const cards: KanbanCard[] = [];
  const lines = content.split('\n');

  let currentList = '未分类';
  let isArchived = false;
  let inFrontmatter = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (i === 0 && line.trim() === '---') { inFrontmatter = true; continue; }
    if (inFrontmatter) {
      if (line.trim() === '---') { inFrontmatter = false; }
      continue;
    }

    if (line.trim().startsWith('%% kanban:settings')) {
      while (i < lines.length && !lines[i].trim().endsWith('%%')) i++;
      continue;
    }

    if (line.trim() === '***') { isArchived = true; continue; }

    const listMatch = line.match(/^##\s+(.+)/);
    if (listMatch) { currentList = listMatch[1].trim(); continue; }

    const cardMatch = line.match(/^\s*[-*]\s+\[([ x])\]\s+(.+)/);
    if (!cardMatch) continue;

    const isChecked = cardMatch[1] === 'x';
    const rawTitle = cardMatch[2].trim();

    const dateMatch = rawTitle.match(dateRegex);
    const date = dateMatch ? (dateMatch[1] || dateMatch[0].replace(/[{}@]/g, '')) : null;
    const isComplete = isChecked || rawTitle.includes('**Complete**');

    // 清理标题：移除日期标记、**Complete**、#hashtag，保留可读文本
    let title = rawTitle
      .replace(/\*\*Complete\*\*\s*/g, '')
      .replace(dateRegex, '')
      .replace(/#\S+/g, '')
      .replace(/@@\{[^}]+\}/g, '')  // 时间标记
      .replace(/\s+/g, ' ')
      .trim();

    if (!title) continue;

    cards.push({
      sourceFile: sourcePath,
      sourceBoard: sourcePath.replace(/^.*[/\\]/, '').replace(/\.md$/i, ''),
      listName: currentList,
      title,
      date,
      isComplete,
      isArchived,
    });
  }

  return cards;
}

// ————— 测试用例 —————

const datePattern = '\\{(\\d{4}-\\d{2}-\\d{2})\\}';
const dateRegex = new RegExp(datePattern, 'g');

function test(name: string, content: string, expected: Partial<KanbanCard>[]) {
  const cards = parseKanbanMd(content, 'test.md', dateRegex);
  let passed = true;

  if (cards.length !== expected.length) {
    console.log(`❌ ${name}: 卡片数量不匹配，期望 ${expected.length}，实际 ${cards.length}`);
    console.log('  实际结果:', JSON.stringify(cards, null, 2));
    return;
  }

  for (let i = 0; i < expected.length; i++) {
    const e = expected[i];
    const c = cards[i];
    const checks: string[] = [];
    for (const [key, val] of Object.entries(e)) {
      if ((c as any)[key] !== val) {
        checks.push(`${key}: 期望 "${val}"，实际 "${(c as any)[key]}"`);
      }
    }
    if (checks.length > 0) {
      console.log(`❌ ${name}[${i}]: ${checks.join(', ')}`);
      passed = false;
    }
  }

  if (passed) {
    console.log(`✅ ${name}`);
  }
}

// Test 1: 基本看板
test('基本看板', `---
kanban-plugin: board
---

## 待办

- [ ] 买牛奶 {2026-06-15}
- [ ] 交房租 {2026-06-20}

## 进行中

- [ ] 写报告 {2026-06-12}
`, [
  { title: '买牛奶', date: '2026-06-15', listName: '待办', isComplete: false, isArchived: false },
  { title: '交房租', date: '2026-06-20', listName: '待办', isComplete: false, isArchived: false },
  { title: '写报告', date: '2026-06-12', listName: '进行中', isComplete: false, isArchived: false },
]);

// Test 2: 已完成 + 归档
test('完成+归档', `---
kanban-plugin: board
---

## 待办

- [ ] 普通任务 {2026-06-15}
- [x] 已完成任务 {2026-06-10}
- [ ] **Complete** 标记完成 {2026-06-05}

***

- [ ] 归档卡片 {2026-05-01}
`, [
  { title: '普通任务', date: '2026-06-15', isComplete: false, isArchived: false },
  { title: '已完成任务', date: '2026-06-10', isComplete: true, isArchived: false },
  { title: '标记完成', date: '2026-06-05', isComplete: true, isArchived: false },
  // 归档卡片应该被忽略 — 但 isArchived=true
  { title: '归档卡片', date: '2026-05-01', isComplete: false, isArchived: true },
]);

// Test 3: 无日期卡片
test('无日期', `---
kanban-plugin: board
---

## 待办

- [ ] 无日期的任务
- [ ] 另一个任务
`, [
  { title: '无日期的任务', date: null, isComplete: false },
  { title: '另一个任务', date: null, isComplete: false },
]);

// Test 4: 带标签和额外格式
test('带标签和格式', `---
kanban-plugin: board
---

## 待办

- [ ] 重要任务 {2026-07-01} #urgent #work
- [ ] 带时间 @@{14:30} 的任务 {2026-06-18}
`, [
  { title: '重要任务', date: '2026-07-01', listName: '待办' },
  { title: '带时间 的任务', date: '2026-06-18', listName: '待办' },
]);

// Test 5: parseKanbanMd 不负责 frontmatter 过滤（由 isKanbanBoard 处理），
// 但这确保它不会把非卡片行（如普通 ## 标题）当作卡片
test('空卡片列表', `# 普通笔记

只是普通文本
- 列表项（不是卡片）
`, []);

console.log('\n--- 所有测试完成 ---');
