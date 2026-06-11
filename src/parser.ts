/// <reference types="obsidian" />

import { App, TFile, parseYaml } from 'obsidian';
import type { KanbanCard } from './types';

/**
 * 解析单个看板文件的 Markdown 内容，提取所有卡片。
 */
export function parseKanbanMd(
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

    // — 跳过 frontmatter —
    if (i === 0 && line.trim() === '---') {
      inFrontmatter = true;
      continue;
    }
    if (inFrontmatter) {
      if (line.trim() === '---') {
        inFrontmatter = false;
      }
      continue;
    }

    // — 跳过 settings codeblock —
    if (line.trim().startsWith('%% kanban:settings')) {
      // Skip until closing %%
      while (i < lines.length && !lines[i].trim().endsWith('%%')) i++;
      continue;
    }
    if (line.trim() === '```' && i > 0 && lines[i - 1].trim().startsWith('%% kanban:settings')) {
      continue;
    }

    // — 归档分隔线 —
    if (line.trim() === '***') {
      isArchived = true;
      continue;
    }

    // — 列表标题 —
    const listMatch = line.match(/^##\s+(.+)/);
    if (listMatch) {
      currentList = listMatch[1].trim();
      continue;
    }

    // — 卡片行 —
    // 格式：- [ ] 标题内容 {YYYY-MM-DD} #tag
    const cardMatch = line.match(/^\s*[-*]\s+\[([ x])\]\s+(.+)/);
    if (!cardMatch) continue;

    const isChecked = cardMatch[1] === 'x';
    const rawTitle = cardMatch[2].trim();

    // 提取日期
    const dateMatch = rawTitle.match(dateRegex);
    const date = dateMatch ? dateMatch[1] || dateMatch[0].replace(/[{}@]/g, '') : null;

    // 判断是否完成
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
      sourceBoard: friendlyBoardName(sourcePath),
      listName: currentList,
      title,
      date,
      isComplete,
      isArchived,
    });
  }

  return cards;
}

/**
 * 扫描 vault 中所有看板文件，返回所有卡片。
 */
export async function scanAllBoards(
  app: App,
  datePattern: string,
): Promise<KanbanCard[]> {
  const files = app.vault.getMarkdownFiles();
  const dateRegex = new RegExp(datePattern, 'g');
  const allCards: KanbanCard[] = [];

  for (const file of files) {
    if (!(await isKanbanBoard(app, file))) continue;
    const content = await app.vault.read(file);
    const cards = parseKanbanMd(content, file.path, dateRegex);
    allCards.push(...cards);
  }

  return allCards;
}

/**
 * 判断一个 markdown 文件是否是 kanban 看板。
 */
async function isKanbanBoard(app: App, file: TFile): Promise<boolean> {
  // 快速路径：检查前 20 行是否含 kanban-plugin 关键字
  const content = await app.vault.cachedRead(file);
  if (!content.includes('kanban-plugin')) return false;

  // 解析 frontmatter
  const frontmatter = extractFrontmatter(content);
  if (!frontmatter) return false;

  const plugin = frontmatter['kanban-plugin'];
  return plugin === 'board' || plugin === 'basic';
}

/**
 * 从文件路径提取友好看板名称。
 * 例如: "Project/Work Kanban.md" → "Work Kanban"
 */
function friendlyBoardName(filePath: string): string {
  // 取文件名（去目录）
  const name = filePath.replace(/^.*[\\/]/, '');
  // 去扩展名
  return name.replace(/\.md$/i, '');
}

/**
 * 从 markdown 中提取 YAML frontmatter。
 */
function extractFrontmatter(content: string): Record<string, unknown> | null {
  const lines = content.split('\n');
  if (lines.length < 2 || lines[0].trim() !== '---') return null;

  let endIdx = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === '---') {
      endIdx = i;
      break;
    }
  }
  if (endIdx === -1) return null;

  const yamlText = lines.slice(1, endIdx).join('\n');
  try {
    const parsed = parseYaml(yamlText);
    return typeof parsed === 'object' && parsed !== null
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}
