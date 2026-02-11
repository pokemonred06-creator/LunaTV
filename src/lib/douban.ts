import { getConfig } from './config';
import { db } from './db';

// 豆瓣 API 类型定义
export interface DoubanSubject {
  id: string;
  title: string;
  original_title?: string;
  year?: string;
  rating?: {
    average?: number;
  };
  pic?: {
    normal?: string;
  };
  directors?: { name: string }[];
  casts?: { name: string }[];
  genres?: string[];
  summary?: string;
}

export interface DoubanSearchResult {
  total: number;
  subjects: DoubanSubject[];
}

// 缓存接口定义
interface CacheItem<T> {
  data: T;
  timestamp: number;
}

// 内存缓存
const memoryCache = new Map<string, CacheItem<unknown>>();

// 获取带超时的缓存数据
async function getCachedData<T>(
  key: string,
  fetchFn: () => Promise<T>,
  ttlMinutes?: number, // Optional TTL override, defaults to config
): Promise<T> {
  const config = await getConfig();
  // Use provided TTL or config TTL or default to 1 day (1440 minutes)
  const cacheTimeMinutes =
    ttlMinutes !== undefined
      ? ttlMinutes
      : config.SiteConfig.DoubanDataCacheTTL || 1440;
  const cacheTime = cacheTimeMinutes * 60 * 1000; // Convert to ms

  const now = Date.now();

  // 1. Memory Check
  const memItem = memoryCache.get(key);
  if (memItem) {
    if (now - memItem.timestamp < cacheTime) {
      return memItem.data as T;
    }
    memoryCache.delete(key);
  }

  // 2. Persistent Storage Check
  try {
    const dbValue = await db.get(key);
    if (dbValue && typeof dbValue === 'string') {
      const dbItem = JSON.parse(dbValue) as CacheItem<T>;
      if (dbItem && dbItem.timestamp && now - dbItem.timestamp < cacheTime) {
        // Backfill memory cache
        memoryCache.set(key, dbItem);
        return dbItem.data;
      }
    }
  } catch (error) {
    console.error(`[Douban Cache] Storage read error:`, error);
  }

  // 3. Fetch Fresh
  if (config.SiteConfig.DebugLogs) {
    console.log(`[Douban Cache] Fetching fresh: ${key}`);
  }
  const data = await fetchFn();

  // 4. Save Cache
  const timestamp = Date.now();
  const cacheItem = { data, timestamp };
  memoryCache.set(key, cacheItem);
  try {
    // Persistent storage with TTL
    await db.set(key, JSON.stringify(cacheItem), cacheTimeMinutes * 60);
  } catch (error) {
    console.error(`[Douban Cache] Storage write error:`, error);
  }

  return data;
}

// Common headers for Douban API requests
const COMMON_HEADERS: HeadersInit = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  Referer: 'https://movie.douban.com/',
};

export async function searchDouban(keyword: string): Promise<DoubanSubject[]> {
  // 移除这一层缓存，因为 searchDouban 结果通常比较容易变动，或者使用较短的缓存时间
  // 这里暂时复用全局配置，或者可以硬编码一个较短的时间
  return getCachedData(
    `douban_search:${keyword}`,
    async () => {
      const config = await getConfig();
      let proxy = '';
      if (config.SiteConfig.DoubanProxyType === 'custom') {
        proxy = config.SiteConfig.DoubanProxy;
      }

      let url = `https://movie.douban.com/j/subject_suggest?q=${encodeURIComponent(keyword)}`;

      // 如果配置了代理，这里需要处理代理逻辑 (简化起见，假设 fetch 能够处理或者 proxy 是个前缀)
      // 实际项目中可能需要更复杂的代理处理，比如 http-proxy-agent
      if (proxy) {
        // 简单拼接，假设代理是一个反代服务
        // url = `${proxy}${encodeURIComponent(url)}`;
        // 或者如果 proxy 是 http 代理地址，需要用 agent。
        // 这里为了兼容性，暂时只支持直接访问或简单反代前缀
        if (proxy.startsWith('http')) {
          // 假设是反代前缀
          url = proxy + url; // 注意：这种方式需要反代服务支持透传完整 url
        }
      }

      try {
        const response = await fetch(url, { headers: COMMON_HEADERS });
        if (!response.ok) {
          console.error(
            `[Douban API] Search failed: ${response.status} ${response.statusText}`,
          );
          return [];
        }
        const data = await response.json();
        // douban suggest api 返回的是数组
        return data || [];
      } catch (error) {
        console.error('[Douban API] Search error:', error);
        return [];
      }
    },
    60,
  ); // 搜索结果缓存 60 分钟
}

export async function getDoubanDetail(
  id: string,
): Promise<DoubanSubject | null> {
  return getCachedData(`douban_detail:${id}`, async () => {
    const config = await getConfig();
    let proxy = '';
    if (config.SiteConfig.DoubanProxyType === 'custom') {
      proxy = config.SiteConfig.DoubanProxy;
    }

    // 使用 api.douban.com v2 接口或者网页解析，这里假设使用 api
    // 注意：豆瓣 v2 api 已失效，通常需要 api key 或爬虫
    // 这里为了演示，假设有一个可用的后端接口或者直接爬取网页
    // 实际情况请替换为有效的豆瓣获取逻辑

    // 备选：使用 frodo 接口 (需要签名) 或网页解析
    // 这里简化逻辑，返回 null，实际请填入有效实现
    // 或者使用第三方 api

    // 示例：尝试访问一个公共库 (可能不稳定)
    const url = `https://movie.douban.com/subject/${id}/`;
    // 爬取网页获取基础信息... 略

    // 修正：返回一个空对象占位，避免 build 失败，实际逻辑需补充
    console.warn(
      '[Douban API] Detail fetching not fully implemented, returning mock data.',
    );
    return {
      id,
      title: `Douban ID ${id}`,
      // ...
    };
  });
}

// New generic fetch function for douban data with caching
// New generic fetch function for douban data with caching
export async function fetchDoubanData<T>(
  url: string,
  ttlMinutes?: number,
): Promise<T> {
  const cacheKey = `douban_v3:${url}`;
  return getCachedData<T>(
    cacheKey,
    async () => {
      const config = await getConfig();
      const { DoubanProxyType, DoubanProxy } = config.SiteConfig;

      let requestUrl = url;

      if (DoubanProxyType === 'custom' && DoubanProxy) {
        requestUrl = DoubanProxy.includes('%s')
          ? DoubanProxy.replace('%s', encodeURIComponent(url))
          : DoubanProxy + encodeURIComponent(url);
      } else if (DoubanProxyType === 'cmliussss-cdn-tencent') {
        requestUrl =
          'https://proxy-douban.cmliussss.net/' + encodeURIComponent(url);
      }

      const response = await fetch(requestUrl, { headers: COMMON_HEADERS });
      if (!response.ok) {
        throw new Error(`[Douban] HTTP ${response.status} for ${requestUrl}`);
      }
      return response.json();
    },
    ttlMinutes,
  );
}
