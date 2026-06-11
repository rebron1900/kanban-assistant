/// <reference types="obsidian" />

import type { KanbanCard, ScanCache, LogEntry } from './types';

/**
 * 生成卡片的唯一指纹，用于跨扫描追踪同一张卡片。
 * 格式：sourceFile::listName::title
 * 注意：标题变化会导致新指纹，卡片会变成"新卡"。
 * 这是合理的——标题改了说明任务内容变了。
 */
export function cardFingerprint(card: KanbanCard): string {
  return `${card.sourceFile}::${card.listName}::${card.title}`;
}

/**
 * 将扫描结果合并到缓存中。
 * 1. 更新每个文件的 mtime + 指纹列表
 * 2. 为新卡片记录 firstSeen
 * 3. 返回带 firstSeen 时间的卡片列表
 */
export function updateCache(
  cache: ScanCache,
  cards: KanbanCard[],
  fileStats: { path: string; mtime: number }[],
): { cards: KanbanCard[]; cache: ScanCache } {
  const now = Date.now();
  const updatedFiles: Record<string, boolean> = {};

  // — 更新文件状态 —
  for (const stat of fileStats) {
    cache.files[stat.path] = {
      mtime: stat.mtime,
      fingerprints: [],
    };
    updatedFiles[stat.path] = true;
  }

  // — 为每张卡片填写 firstSeen —
  const enriched: KanbanCard[] = [];
  for (const card of cards) {
    const fp = cardFingerprint(card);

    // 记录此指纹属于哪个文件
    if (cache.files[card.sourceFile]) {
      cache.files[card.sourceFile].fingerprints.push(fp);
    }

    // 如果是新卡片，记录首次出现时间
    if (!cache.firstSeen[fp]) {
      cache.firstSeen[fp] = now;
    }

    enriched.push({
      ...card,
      firstSeen: cache.firstSeen[fp],
    });
  }

  // — 清理已不存在的指纹（避免无限膨胀） —
  // 保留最近 7 天的历史指纹供分析用
  const cutoff = now - 7 * 24 * 60 * 60 * 1000;
  for (const [fp, firstSeen] of Object.entries(cache.firstSeen)) {
    if (firstSeen < cutoff && !cards.some((c) => cardFingerprint(c) === fp)) {
      delete cache.firstSeen[fp];
    }
  }

  // — 清理不存在的文件记录 —
  for (const filePath of Object.keys(cache.files)) {
    if (!updatedFiles[filePath]) {
      delete cache.files[filePath];
    }
  }

  cache.lastScan = now;

  return { cards: enriched, cache };
}

/**
 * 只重新解析变更过的文件。
 * 返回 { fullRescan: true } 表示需要全量扫描（文件增删等），
 * 否则返回变更文件的路径列表。
 */
export function getChangedFiles(
  cache: ScanCache,
  currentFiles: { path: string; mtime: number }[],
): { changed: string[]; removed: string[]; fullRescan: boolean } {
  const changed: string[] = [];
  const removed: string[] = [];
  let fullRescan = false;

  const cachedPaths = new Set(Object.keys(cache.files));
  const currentPaths = new Set(currentFiles.map((f) => f.path));

  // 新增的文件
  for (const file of currentFiles) {
    if (!cachedPaths.has(file.path)) {
      changed.push(file.path);
    }
  }

  // 删除的文件
  for (const cachedPath of cachedPaths) {
    if (!currentPaths.has(cachedPath)) {
      removed.push(cachedPath);
    }
  }

  // 修改过的文件（mtime 不同）
  for (const file of currentFiles) {
    const cached = cache.files[file.path];
    if (cached && cached.mtime !== file.mtime) {
      changed.push(file.path);
    }
  }

  // 如果缓存为空（首次运行），需要全量
  if (Object.keys(cache.files).length === 0) {
    fullRescan = true;
  }

  return { changed, removed, fullRescan };
}

/**
 * 从 vault 事件中获取文件 stats（path + mtime）。
 * 用于 cache 比较。
 */
export function getFileStats(
  files: { path: string; stat: { mtime: number } }[],
): { path: string; mtime: number }[] {
  return files.map((f) => ({ path: f.path, mtime: f.stat.mtime }));
}
