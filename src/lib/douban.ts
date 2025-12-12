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
const memoryCache = new Map<string, CacheItem<any>>();

// 获取带超时的缓存数据
async function getCachedData<T>(
  key: string,
  fetchFn: () => Promise<T>,
  ttlMinutes?: number // Optional TTL override, defaults to config
): Promise<T> {
  const config = await getConfig();
  // Use provided TTL or config TTL or default to 1 day (1440 minutes)
  const cacheTimeMinutes = ttlMinutes !== undefined ? ttlMinutes : (config.SiteConfig.DoubanDataCacheTTL || 1440);
  const cacheTime = cacheTimeMinutes * 60 * 1000; // Convert to ms

  const now = Date.now();

  // 1. 尝试从内存获取
  const memItem = memoryCache.get(key);
  if (memItem) {
    if (now - memItem.timestamp < cacheTime) {
      console.log(`[Douban Cache] Memory hit for ${key}. TTL: ${cacheTimeMinutes}m. Remaining: ${((cacheTime - (now - memItem.timestamp)) / 60000).toFixed(1)}m`);
      return memItem.data;
    }
    console.log(`[Douban Cache] Memory expired for ${key}`);
    memoryCache.delete(key);
  }

  // 2. 尝试从数据库获取
  try {
    // 使用 db.get 替代 db.getCache
    const dbValue = await db.get(key);
    if (dbValue) {
      const dbItem = JSON.parse(dbValue) as CacheItem<T>;
      if (dbItem && dbItem.timestamp) {
        if (now - dbItem.timestamp < cacheTime) {
          // 回写到内存
          memoryCache.set(key, dbItem);
          console.log(`[Douban Cache] DB hit for ${key}. TTL: ${cacheTimeMinutes}m. Remaining: ${((cacheTime - (now - dbItem.timestamp)) / 60000).toFixed(1)}m`);
          return dbItem.data;
        }
        console.log(`[Douban Cache] DB expired for ${key}`);
        // db.deleteCache 不存在，且 set 会覆盖，这里可以选择不做操作或者设置过期值
        // await db.set(key, null, 1); // 可选：主动清除
      }
    }
  } catch (error) {
    console.error(`[Douban Cache] DB read error for ${key}:`, error);
  }

  // 3. 重新获取
  console.log(`[Douban Cache] Fetching fresh data for ${key}`);
  const data = await fetchFn();

  // 4. 写入缓存
  const timestamp = Date.now();
  const cacheItem = { data, timestamp };
  memoryCache.set(key, cacheItem);
  try {
    // 使用 db.set 替代 db.setCache，并传入 ttl (秒)
    // 注意：db.set 的 ttl 参数是可选的，这里传入 cacheTimeMinutes * 60
    await db.set(key, JSON.stringify(cacheItem), cacheTimeMinutes * 60);
  } catch (error) {
    console.error(`[Douban Cache] DB write error for ${key}:`, error);
  }

  return data;
}

export async function searchDouban(keyword: string): Promise<DoubanSubject[]> {
  return getCachedData(`douban_search:${keyword}`, async () => {
    const config = await getConfig();
    let proxy = '';
    if (config.SiteConfig.DoubanProxyType === 'custom') {
      proxy = config.SiteConfig.DoubanProxy;
    }

    const headers: HeadersInit = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    };

    let url = `https://movie.douban.com/j/subject_suggest?q=${encodeURIComponent(keyword)}`;
    
    if (proxy) {
       if (proxy.startsWith('http')) {
           url = proxy + url; 
       }
    }

    try {
      const response = await fetch(url, { headers });
      if (!response.ok) {
        console.error(`[Douban API] Search failed: ${response.status} ${response.statusText}`);
        return [];
      }
      const data = await response.json();
      return data || [];
    } catch (error) {
      console.error('[Douban API] Search error:', error);
      return [];
    }
  }, 60); 
}

export async function getDoubanDetail(id: string): Promise<DoubanSubject | null> {
  return getCachedData(`douban_detail:${id}`, async () => {
    const config = await getConfig();
    let proxy = '';
    if (config.SiteConfig.DoubanProxyType === 'custom') {
      proxy = config.SiteConfig.DoubanProxy;
    }

    const headers: HeadersInit = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    };

    const url = `https://movie.douban.com/subject/${id}/`;
    
    console.warn('[Douban API] Detail fetching not fully implemented, returning mock data.');
    return {
        id,
        title: `Douban ID ${id}`,
    };
  });
}

// New generic fetch function for douban data with caching
export async function fetchDoubanData<T>(url: string, ttlMinutes?: number): Promise<T> {
  const cacheKey = `douban_generic:${url}`;
  return getCachedData<T>(cacheKey, async () => {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch from ${url}: ${response.status} ${response.statusText}`);
    }
    return response.json();
  }, ttlMinutes);
}