/// <reference types="obsidian" />

import { App, TFile, parseYaml } from 'obsidian';
import type { KanbanCard, PluginSettings } from './types';

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

    if (i === 0 && line.trim() === '---') { inFrontmatter = true; continue; }
    if (inFrontmatter) { if (line.trim() === '---') { inFrontmatter = false; } continue; }

    if (line.trim().startsWith('%% kanban:settings')) {
      while (i < lines.length && !lines[i].trim().endsWith('%%')) i++;
      continue;
    }
    if (line.trim() === '```' && i > 0 && lines[i - 1].trim().startsWith('%% kanban:settings')) continue;

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

    let title = rawTitle
      .replace(/\*\*Complete\*\*\s*/g, '')
      .replace(dateRegex, '')
      .replace(/#\S+/g, '')
      .replace(/@@\{[^}]+\}/g, '')
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
 * 扫描 vault 中所有看板文件，返回所有卡片（无过滤）。
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
 * 带过滤的扫描：结合设置中的看板独立配置 + 排除规则。
 */
export async function scanFilteredBoards(
  app: App,
  settings: PluginSettings,
): Promise<KanbanCard[]> {
  const files = app.vault.getMarkdownFiles();
  const dateRegex = new RegExp(settings.datePattern, 'g');
  const allCards: KanbanCard[] = [];

  for (const file of files) {
    if (!(await isKanbanBoard(app, file))) continue;

    const boardConfig = settings.boards[file.path];

    // 看板级别禁用
    if (boardConfig && !boardConfig.enabled) continue;

    const content = await app.vault.read(file);
    const cards = parseKanbanMd(content, file.path, dateRegex);

    // 应用该看板的列表排除规则
    const excludedLists = boardConfig?.excludedLists || [];

    for (const card of cards) {
      // 列表排除
      if (excludedLists.some((l) => card.listName === l)) continue;

      // 全局排除规则
      if (isExcludedByRules(card, settings.exclusions)) continue;

      allCards.push(card);
    }
  }

  return allCards;
}

/**
 * 检查卡片是否匹配任何排除规则。
 */
function isExcludedByRules(card: KanbanCard, rules: PluginSettings['exclusions']): boolean {
  for (const rule of rules) {
    if (!rule.enabled) continue;

    switch (rule.type) {
      case 'board':
        if (card.sourceFile.includes(rule.value)) return true;
        break;
      case 'list':
        if (card.listName.includes(rule.value)) return true;
        break;
      case 'tag':
        // 检查卡片标题中是否包含 #tag（在清理前检查）
        if (card.title.toLowerCase().includes(`#${rule.value.toLowerCase()}`)) return true;
        break;
    }
  }
  return false;
}

/**
 * 获取看板的独立 levels（如有），否则返回 null。
 */
export function getBoardLevels(
  settings: PluginSettings,
  boardPath: string,
) {
  const boardConfig = settings.boards[boardPath];
  if (boardConfig?.levels && boardConfig.levels.length > 0) {
    return boardConfig.levels;
  }
  return null;
}

/**
 * 判断一个 markdown 文件是否是 kanban 看板。
 */
async function isKanbanBoard(app: App, file: TFile): Promise<boolean> {
  const content = await app.vault.cachedRead(file);
  if (!content.includes('kanban-plugin')) return false;
  const frontmatter = extractFrontmatter(content);
  if (!frontmatter) return false;
  const plugin = frontmatter['kanban-plugin'];
  return plugin === 'board' || plugin === 'basic';
}

function friendlyBoardName(filePath: string): string {
  const name = filePath.replace(/^.*[\\/]/, '');
  return name.replace(/\.md$/i, '');
}

function extractFrontmatter(content: string): Record<string, unknown> | null {
  const lines = content.split('\n');
  if (lines.length < 2 || lines[0].trim() !== '---') return null;
  let endIdx = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === '---') { endIdx = i; break; }
  }
  if (endIdx === -1) return null;
  const yamlText = lines.slice(1, endIdx).join('\n');
  try {
    const parsed = parseYaml(yamlText);
    return typeof parsed === 'object' && parsed !== null
      ? (parsed as Record<string, unknown>) : null;
  } catch { return null; }
}
