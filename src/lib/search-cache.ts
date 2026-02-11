import { db } from '@/lib/db';
import { SearchResult } from '@/lib/types';

// 缓存状态类型
export type CachedPageStatus = 'ok' | 'timeout' | 'forbidden';

// 缓存条目接口
export interface CachedPageEntry {
  expiresAt: number;
  status: CachedPageStatus;
  data: SearchResult[];
  pageCount?: number; // 仅第一页可选存储
}

// 缓存配置
const SEARCH_CACHE_TTL_MS = 10 * 60 * 1000; // 10分钟
const CACHE_CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // 5分钟清理一次
const MAX_CACHE_SIZE = 1000; // 最大缓存条目数量（搜索）
const MAX_DETAIL_CACHE_SIZE = 500; // 详情缓存上限

// 内存二级缓存 (L1 Cache)
const SEARCH_CACHE: Map<string, CachedPageEntry> = new Map();
const DETAIL_CACHE: Map<string, CachedPageEntry> = new Map();

// 自动清理定时器
let cleanupTimer: NodeJS.Timeout | null = null;
let lastCleanupTime = 0;

/**
 * 生成搜索缓存键：source + query + page
 */
function makeSearchCacheKey(
  sourceKey: string,
  query: string,
  page: number,
): string {
  return `cache:search:${sourceKey}::${query.trim()}::${page}`;
}

/**
 * 获取缓存的搜索页面数据
 */
export async function getCachedSearchPage(
  sourceKey: string,
  query: string,
  page: number,
): Promise<CachedPageEntry | null> {
  const key = makeSearchCacheKey(sourceKey, query, page);

  // 1. L1 Cache (Memory)
  const entry = SEARCH_CACHE.get(key);
  if (entry) {
    if (entry.expiresAt > Date.now()) {
      return entry;
    }
    SEARCH_CACHE.delete(key);
  }

  // 2. L2 Cache (Persistent DB)
  try {
    const dbValue = await db.get(key);
    if (dbValue && typeof dbValue === 'object') {
      const dbEntry = dbValue as CachedPageEntry;
      if (dbEntry.expiresAt > Date.now()) {
        // Backfill L1
        SEARCH_CACHE.set(key, dbEntry);
        return dbEntry;
      }
    }
  } catch (err) {
    console.error('[Cache] Redis read failed:', err);
  }

  return null;
}

/**
 * 设置缓存的搜索页面数据
 */
export async function setCachedSearchPage(
  sourceKey: string,
  query: string,
  page: number,
  status: CachedPageStatus,
  data: SearchResult[],
  pageCount?: number,
): Promise<void> {
  // 惰性启动自动清理
  ensureAutoCleanupStarted();

  const now = Date.now();
  const expiresAt = now + SEARCH_CACHE_TTL_MS;
  const key = makeSearchCacheKey(sourceKey, query, page);
  const entry: CachedPageEntry = {
    expiresAt,
    status,
    data,
    pageCount,
  };

  // 1. Set L1
  SEARCH_CACHE.set(key, entry);

  // 2. Set L2 (Persistent DB)
  try {
    // TTL in seconds for Redis
    await db.set(key, entry, Math.floor(SEARCH_CACHE_TTL_MS / 1000));
  } catch (err) {
    console.error('[Cache] Redis write failed:', err);
  }

  // 惰性清理：每次写入时检查是否需要清理 L1
  if (now - lastCleanupTime > CACHE_CLEANUP_INTERVAL_MS) {
    performCacheCleanup();
  }
}

/**
 * 确保自动清理已启动（惰性初始化）
 */
function ensureAutoCleanupStarted(): void {
  if (!cleanupTimer) {
    startAutoCleanup();
  }
}

/**
 * 智能清理过期的缓存条目 (仅清理 L1)
 */
function performCacheCleanup(): {
  expired: number;
  total: number;
  sizeLimited: number;
} {
  const now = Date.now();
  const keysToDelete: string[] = [];
  const detailKeysToDelete: string[] = [];
  let sizeLimitedDeleted = 0;
  let detailSizeLimitedDeleted = 0;

  // 1. 清理过期条目
  SEARCH_CACHE.forEach((entry, key) => {
    if (entry.expiresAt <= now) {
      keysToDelete.push(key);
    }
  });
  DETAIL_CACHE.forEach((entry, key) => {
    if (entry.expiresAt <= now) {
      detailKeysToDelete.push(key);
    }
  });

  const expiredCount = keysToDelete.length + detailKeysToDelete.length;
  keysToDelete.forEach((key) => SEARCH_CACHE.delete(key));
  detailKeysToDelete.forEach((key) => DETAIL_CACHE.delete(key));

  // 2. 如果缓存大小超限，清理最老的条目（LRU策略）
  if (SEARCH_CACHE.size > MAX_CACHE_SIZE) {
    const entries = Array.from(SEARCH_CACHE.entries());
    entries.sort((a, b) => a[1].expiresAt - b[1].expiresAt);

    const toRemove = SEARCH_CACHE.size - MAX_CACHE_SIZE;
    for (let i = 0; i < toRemove; i++) {
      SEARCH_CACHE.delete(entries[i][0]);
      sizeLimitedDeleted++;
    }
  }

  if (DETAIL_CACHE.size > MAX_DETAIL_CACHE_SIZE) {
    const entries = Array.from(DETAIL_CACHE.entries());
    entries.sort((a, b) => a[1].expiresAt - b[1].expiresAt);
    const toRemove = DETAIL_CACHE.size - MAX_DETAIL_CACHE_SIZE;
    for (let i = 0; i < toRemove; i++) {
      DETAIL_CACHE.delete(entries[i][0]);
      detailSizeLimitedDeleted++;
    }
  }

  lastCleanupTime = now;

  return {
    expired: expiredCount,
    total: SEARCH_CACHE.size + DETAIL_CACHE.size,
    sizeLimited: sizeLimitedDeleted + detailSizeLimitedDeleted,
  };
}

function makeDetailCacheKey(sourceKey: string, id: string): string {
  return `cache:detail:${sourceKey}::${id}`;
}

export async function getCachedDetail(
  sourceKey: string,
  id: string,
): Promise<CachedPageEntry | null> {
  const key = makeDetailCacheKey(sourceKey, id);

  // 1. L1
  const entry = DETAIL_CACHE.get(key);
  if (entry) {
    if (entry.expiresAt > Date.now()) {
      return entry;
    }
    DETAIL_CACHE.delete(key);
  }

  // 2. L2
  try {
    const dbValue = await db.get(key);
    if (dbValue && typeof dbValue === 'object') {
      const dbEntry = dbValue as CachedPageEntry;
      if (dbEntry.expiresAt > Date.now()) {
        DETAIL_CACHE.set(key, dbEntry);
        return dbEntry;
      }
    }
  } catch (err) {
    console.error('[Cache] Redis read failed (detail):', err);
  }

  return null;
}

export async function setCachedDetail(
  sourceKey: string,
  id: string,
  status: CachedPageStatus,
  data: SearchResult[], // Detail is wrapped in array
): Promise<void> {
  ensureAutoCleanupStarted();
  const now = Date.now();
  const expiresAt = now + SEARCH_CACHE_TTL_MS;
  const key = makeDetailCacheKey(sourceKey, id);
  const entry: CachedPageEntry = {
    expiresAt,
    status,
    data,
  };

  // 1. L1
  DETAIL_CACHE.set(key, entry);

  // 2. L2
  try {
    await db.set(key, entry, Math.floor(SEARCH_CACHE_TTL_MS / 1000));
  } catch (err) {
    console.error('[Cache] Redis write failed (detail):', err);
  }

  if (now - lastCleanupTime > CACHE_CLEANUP_INTERVAL_MS) {
    performCacheCleanup();
  }
}

/**
 * 启动自动清理定时器
 */
function startAutoCleanup(): void {
  if (cleanupTimer) return; // 避免重复启动

  cleanupTimer = setInterval(() => {
    performCacheCleanup();
  }, CACHE_CLEANUP_INTERVAL_MS);

  // 在 Node.js 环境中避免阻止程序退出
  if (typeof process !== 'undefined' && cleanupTimer.unref) {
    cleanupTimer.unref();
  }
}
