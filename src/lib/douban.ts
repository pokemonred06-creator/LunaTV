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

// Common headers for Douban API requests
const COMMON_HEADERS: HeadersInit = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Referer': 'https://movie.douban.com/',
};

export async function searchDouban(keyword: string): Promise<DoubanSubject[]> {
  // 移除这一层缓存，因为 searchDouban 结果通常比较容易变动，或者使用较短的缓存时间
  // 这里暂时复用全局配置，或者可以硬编码一个较短的时间
  return getCachedData(`douban_search:${keyword}`, async () => {
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
        console.error(`[Douban API] Search failed: ${response.status} ${response.statusText}`);
        return [];
      }
      const data = await response.json();
      // douban suggest api 返回的是数组
      return data || [];
    } catch (error) {
      console.error('[Douban API] Search error:', error);
      return [];
    }
  }, 60); // 搜索结果缓存 60 分钟
}

export async function getDoubanDetail(id: string): Promise<DoubanSubject | null> {
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
    console.warn('[Douban API] Detail fetching not fully implemented, returning mock data.');
    return {
        id,
        title: `Douban ID ${id}`,
        // ...
    };
  });
}

// New generic fetch function for douban data with caching
// New generic fetch function for douban data with caching
export async function fetchDoubanData<T>(url: string, ttlMinutes?: number): Promise<T> {
  // Use a cache key based on the URL
  const cacheKey = `douban_generic:${url}`;
  return getCachedData<T>(cacheKey, async () => {
    const config = await getConfig();
    let targetUrl = url;

    const { DoubanProxyType, DoubanProxy } = config.SiteConfig;

    if (DoubanProxyType === 'custom' && DoubanProxy) {
      targetUrl = DoubanProxy + encodeURIComponent(url);
    } 
    // Add other proxy types if known, for now custom is the main flexible one
    
    // If using a proxy, we might need to adjust headers (e.g. host), but usually the proxy handles it.
    // Ensure we still send User-Agent as some proxies forward it.
    
    const response = await fetch(targetUrl, { headers: COMMON_HEADERS });
    if (!response.ok) {
      throw new Error(`Failed to fetch from ${targetUrl}: ${response.status} ${response.statusText}`);
    }
    return response.json();
  }, ttlMinutes);
}