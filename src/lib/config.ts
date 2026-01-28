import { db } from '@/lib/db';

import { AdminConfig, ApiSite, LiveCfg, SiteConfig } from './admin.types';

// --- Interfaces for the JSON File Structure ---

interface ConfigFileStruct {
  cache_time?: number;
  api_site?: { [key: string]: ApiSite };
  custom_category?: {
    name?: string;
    type: 'movie' | 'tv';
    query: string;
  }[];
  lives?: { [key: string]: LiveCfg };
  douban_data_cache_ttl?: number;
  image_cache_ttl?: number;
}

// --- Constants ---

export const API_CONFIG = {
  search: {
    path: '?ac=videolist&wd=',
    pagePath: '?ac=videolist&wd={query}&pg={page}',
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      Accept: 'application/json',
    },
  },
  detail: {
    path: '?ac=videolist&ids=',
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      Accept: 'application/json',
    },
  },
};

const DEFAULT_DOUBAN_DATA_CACHE_TTL_MINUTES = 24 * 60; // 1 day
const DEFAULT_IMAGE_CACHE_TTL_DAYS = 30; // 30 days

// --- Environment & Safety ---

const IS_PROD = process.env.NODE_ENV === 'production';
// Explicit precedence: Env Var -> 'admin' (dev only) -> Empty string (unsafe)
const OWNER_USERNAME = process.env.USERNAME ?? (IS_PROD ? '' : 'admin');

if (IS_PROD && !OWNER_USERNAME) {
  throw new Error('CRITICAL: process.env.USERNAME must be set in production.');
}

/**
 * Helper: Parses an integer. Returns null if invalid or <= 0.
 * Used for TTLs where 0 or negative values are invalid/dangerous.
 */
function parsePositiveInt(val: unknown): number | null {
  const n =
    typeof val === 'string' ? Number(val) : typeof val === 'number' ? val : NaN;
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
}

// --- Internal State ---

let cachedConfig: AdminConfig;

// --- Core Logic ---

/**
 * Merges the static File Config on top of the Database Config.
 * - File config always wins for shared keys.
 * - Items present in File are marked from='config'.
 * - Items only in DB are marked from='custom'.
 */
export function refineConfig(adminConfig: AdminConfig): AdminConfig {
  let fileConfig: ConfigFileStruct;
  const rawFile =
    typeof adminConfig.ConfigFile === 'string' ? adminConfig.ConfigFile : '';

  try {
    fileConfig = JSON.parse(rawFile) as ConfigFileStruct;
  } catch (e) {
    fileConfig = {} as ConfigFileStruct;
  }

  // 1. Process VOD Sources
  const apiSitesFromFile = Object.entries(fileConfig.api_site || {});
  const currentApiSites = new Map(
    (adminConfig.SourceConfig || []).map((s) => [s.key, s]),
  );

  apiSitesFromFile.forEach(([key, site]) => {
    const existingSource = currentApiSites.get(key);
    if (existingSource) {
      existingSource.name = site.name;
      existingSource.api = site.api;
      existingSource.detail = site.detail;
      existingSource.from = 'config';
    } else {
      currentApiSites.set(key, {
        key,
        name: site.name,
        api: site.api,
        detail: site.detail,
        from: 'config',
        disabled: false,
      });
    }
  });

  const apiSitesFromFileKey = new Set(apiSitesFromFile.map(([key]) => key));
  currentApiSites.forEach((source) => {
    if (!apiSitesFromFileKey.has(source.key)) {
      source.from = 'custom';
    }
  });
  adminConfig.SourceConfig = Array.from(currentApiSites.values());

  // 2. Process Custom Categories
  const customCategoriesFromFile = fileConfig.custom_category || [];
  const currentCustomCategories = new Map(
    (adminConfig.CustomCategories || []).map((c) => [c.query + c.type, c]),
  );

  customCategoriesFromFile.forEach((category) => {
    const key = category.query + category.type;
    const existed = currentCustomCategories.get(key);
    if (existed) {
      existed.name = category.name || category.query;
      existed.query = category.query;
      existed.type = category.type;
      existed.from = 'config';
    } else {
      currentCustomCategories.set(key, {
        name: category.name || category.query,
        type: category.type,
        query: category.query,
        from: 'config',
        disabled: false,
      });
    }
  });

  const customCatsFileKeys = new Set(
    customCategoriesFromFile.map((c) => c.query + c.type),
  );
  currentCustomCategories.forEach((category) => {
    if (!customCatsFileKeys.has(category.query + category.type)) {
      category.from = 'custom';
    }
  });
  adminConfig.CustomCategories = Array.from(currentCustomCategories.values());

  // 3. Process Live Sources
  const livesFromFile = Object.entries(fileConfig.lives || {});
  const currentLives = new Map(
    (adminConfig.LiveConfig || []).map((l) => [l.key, l]),
  );

  livesFromFile.forEach(([key, site]) => {
    const existingLive = currentLives.get(key);
    if (existingLive) {
      existingLive.name = site.name;
      existingLive.url = site.url;
      existingLive.ua = site.ua;
      existingLive.epg = site.epg;
      existingLive.from = 'config';
    } else {
      currentLives.set(key, {
        key,
        name: site.name,
        url: site.url,
        ua: site.ua,
        epg: site.epg,
        channelNumber: 0,
        from: 'config',
        disabled: false,
      });
    }
  });

  const livesFromFileKeys = new Set(livesFromFile.map(([key]) => key));
  currentLives.forEach((live) => {
    if (!livesFromFileKeys.has(live.key)) {
      live.from = 'custom';
    }
  });
  adminConfig.LiveConfig = Array.from(currentLives.values());

  return adminConfig;
}

// Internal Init Logic
async function getInitConfig(
  configFile: string,
  subConfig: {
    URL: string;
    AutoUpdate: boolean;
    LastCheck: string;
  } = { URL: '', AutoUpdate: false, LastCheck: '' },
): Promise<AdminConfig> {
  let cfgFile: ConfigFileStruct;
  try {
    cfgFile = JSON.parse(configFile || '{}') as ConfigFileStruct;
  } catch (e) {
    cfgFile = {} as ConfigFileStruct;
  }

  // Safe Parsing
  const doubanTTL =
    parsePositiveInt(process.env.DOUBAN_DATA_CACHE_TTL_MINUTES) ??
    parsePositiveInt(cfgFile.douban_data_cache_ttl) ??
    DEFAULT_DOUBAN_DATA_CACHE_TTL_MINUTES;

  const imageTTL =
    parsePositiveInt(process.env.IMAGE_CACHE_TTL_DAYS) ??
    parsePositiveInt(cfgFile.image_cache_ttl) ??
    DEFAULT_IMAGE_CACHE_TTL_DAYS;

  const siteCacheTime = parsePositiveInt(cfgFile.cache_time) ?? 7200;

  const adminConfig: AdminConfig = {
    ConfigFile: configFile,
    ConfigSubscription: subConfig,
    SiteConfig: {
      SiteName: process.env.NEXT_PUBLIC_SITE_NAME || 'MoonTV',
      Announcement: process.env.ANNOUNCEMENT || '',
      SearchDownstreamMaxPage:
        Number(process.env.NEXT_PUBLIC_SEARCH_MAX_PAGE) || 5,
      SiteInterfaceCacheTime: siteCacheTime,
      DoubanProxyType:
        (process.env
          .NEXT_PUBLIC_DOUBAN_PROXY_TYPE as SiteConfig['DoubanProxyType']) ||
        'direct',
      DoubanProxy: process.env.NEXT_PUBLIC_DOUBAN_PROXY || '',
      DoubanImageProxyType:
        (process.env
          .NEXT_PUBLIC_DOUBAN_IMAGE_PROXY_TYPE as SiteConfig['DoubanImageProxyType']) ||
        'cmliussss-cdn-tencent',
      DoubanImageProxy: process.env.NEXT_PUBLIC_DOUBAN_IMAGE_PROXY || '',
      DisableYellowFilter:
        process.env.NEXT_PUBLIC_DISABLE_YELLOW_FILTER === 'true',
      FluidSearch: process.env.NEXT_PUBLIC_FLUID_SEARCH !== 'false',
      DoubanDataCacheTTL: doubanTTL,
      ImageCacheTTL: imageTTL,
    },
    UserConfig: { Users: [] },
    SourceConfig: [],
    CustomCategories: [],
    LiveConfig: [],
  };

  // Populate Users
  let userNames: string[] = [];
  try {
    userNames = await db.getAllUsers();
  } catch (e) {
    console.error('获取用户列表失败:', e);
  }

  const allUsers: AdminConfig['UserConfig']['Users'] = userNames
    .filter((u) => u !== OWNER_USERNAME)
    .map((u) => ({
      username: u,
      role: 'user',
      banned: false,
    }));

  // Explicitly add Owner
  allUsers.unshift({
    username: OWNER_USERNAME,
    role: 'owner',
    banned: false,
  });

  adminConfig.UserConfig.Users = allUsers;

  // Populate Config Arrays from File
  Object.entries(cfgFile.api_site || {}).forEach(([key, site]) => {
    adminConfig.SourceConfig.push({
      key: key,
      name: site.name,
      api: site.api,
      detail: site.detail,
      from: 'config',
      disabled: false,
    });
  });

  cfgFile.custom_category?.forEach((category) => {
    adminConfig.CustomCategories.push({
      name: category.name || category.query,
      type: category.type,
      query: category.query,
      from: 'config',
      disabled: false,
    });
  });

  Object.entries(cfgFile.lives || {}).forEach(([key, live]) => {
    adminConfig.LiveConfig.push({
      key,
      name: live.name,
      url: live.url,
      ua: live.ua,
      epg: live.epg,
      channelNumber: 0,
      from: 'config',
      disabled: false,
    });
  });

  return adminConfig;
}

export async function getConfig(): Promise<AdminConfig> {
  if (cachedConfig) return cachedConfig;

  let adminConfig: AdminConfig | null = null;
  try {
    adminConfig = await db.getAdminConfig();
  } catch (e) {
    console.error('获取管理员配置失败:', e);
  }

  if (!adminConfig) {
    adminConfig = await getInitConfig('');
  }

  // 1. Apply File Config Overlays
  adminConfig = refineConfig(adminConfig);

  // 2. Sanitize & Enforce Rules
  adminConfig = configSelfCheck(adminConfig);

  // 3. Update Cache & DB
  cachedConfig = adminConfig;
  try {
    await db.saveAdminConfig(cachedConfig);
  } catch (e) {
    console.error('Failed to sync config to DB:', e);
  }

  return cachedConfig;
}

export function configSelfCheck(adminConfig: AdminConfig): AdminConfig {
  if (!adminConfig.UserConfig) adminConfig.UserConfig = { Users: [] };
  if (!Array.isArray(adminConfig.UserConfig.Users))
    adminConfig.UserConfig.Users = [];
  if (!Array.isArray(adminConfig.SourceConfig)) adminConfig.SourceConfig = [];
  if (!Array.isArray(adminConfig.CustomCategories))
    adminConfig.CustomCategories = [];
  if (!Array.isArray(adminConfig.LiveConfig)) adminConfig.LiveConfig = [];

  // Owner Enforcement
  const seenUsernames = new Set<string>();
  adminConfig.UserConfig.Users = adminConfig.UserConfig.Users.filter((user) => {
    if (seenUsernames.has(user.username)) return false;
    seenUsernames.add(user.username);
    return true;
  });

  const originOwnerCfg = adminConfig.UserConfig.Users.find(
    (u) => u.username === OWNER_USERNAME,
  );

  // Demote/Remove bad owners
  adminConfig.UserConfig.Users = adminConfig.UserConfig.Users.filter(
    (user) => user.username !== OWNER_USERNAME,
  );
  adminConfig.UserConfig.Users.forEach((user) => {
    if (user.role === 'owner') user.role = 'user';
  });

  // Re-insert Real Owner
  adminConfig.UserConfig.Users.unshift({
    username: OWNER_USERNAME,
    role: 'owner',
    banned: false,
    enabledApis: originOwnerCfg?.enabledApis,
    enabledLives: originOwnerCfg?.enabledLives, // Preserve lives
    tags: originOwnerCfg?.tags,
  });

  // Deduplication
  const dedupe = <T>(arr: T[], keyFn: (item: T) => string) => {
    const seen = new Set<string>();
    return arr.filter((item) => {
      const key = keyFn(item);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  };

  adminConfig.SourceConfig = dedupe(adminConfig.SourceConfig, (s) => s.key);
  adminConfig.CustomCategories = dedupe(
    adminConfig.CustomCategories,
    (c) => c.query + c.type,
  );
  adminConfig.LiveConfig = dedupe(adminConfig.LiveConfig, (l) => l.key);

  return adminConfig;
}

export async function resetConfig() {
  let originConfig: AdminConfig | null = null;
  try {
    originConfig = await db.getAdminConfig();
  } catch {
    /* ignore */
  }

  if (!originConfig) originConfig = {} as AdminConfig;

  let adminConfig = await getInitConfig(
    originConfig.ConfigFile,
    originConfig.ConfigSubscription,
  );

  // Immediate Normalization
  adminConfig = refineConfig(adminConfig);
  adminConfig = configSelfCheck(adminConfig);

  cachedConfig = adminConfig;
  try {
    await db.saveAdminConfig(adminConfig);
  } catch (e) {
    console.error('Failed to save reset config:', e);
  }
}

export async function getCacheTime(): Promise<number> {
  const config = await getConfig();
  return config.SiteConfig.SiteInterfaceCacheTime || 7200;
}

export async function getAvailableApiSites(user?: string): Promise<ApiSite[]> {
  const config = await getConfig();
  const allApiSites = config.SourceConfig.filter((s) => !s.disabled);

  if (!user) return allApiSites;

  const userConfig = config.UserConfig.Users.find((u) => u.username === user);
  if (!userConfig) return []; // Fail Closed

  // 1. Explicit Allowlist
  if (userConfig.enabledApis?.length) {
    const set = new Set(userConfig.enabledApis);
    return allApiSites.filter((s) => set.has(s.key));
  }

  // 2. Tags
  if (userConfig.tags?.length && config.UserConfig.Tags?.length) {
    const enabledFromTags = new Set<string>();
    for (const tagName of userConfig.tags) {
      const tag = config.UserConfig.Tags.find((t) => t.name === tagName);
      tag?.enabledApis?.forEach((key) => enabledFromTags.add(key));
    }
    if (enabledFromTags.size > 0) {
      return allApiSites.filter((s) => enabledFromTags.has(s.key));
    }
  }

  // 3. Permissive Fallback
  return allApiSites;
}

export async function getAvailableLiveSources(
  user?: string,
): Promise<LiveCfg[]> {
  const config = await getConfig();
  const allLives = config.LiveConfig.filter((l) => !l.disabled);

  if (!user) return allLives;

  const userConfig = config.UserConfig.Users.find((u) => u.username === user);
  if (!userConfig) return []; // Fail Closed

  // 1. Explicit Allowlist
  if (userConfig.enabledLives?.length) {
    const set = new Set(userConfig.enabledLives);
    return allLives.filter((l) => set.has(l.key));
  }

  // 2. Tags
  if (userConfig.tags?.length && config.UserConfig.Tags?.length) {
    const enabledFromTags = new Set<string>();
    for (const tagName of userConfig.tags) {
      const tag = config.UserConfig.Tags.find((t) => t.name === tagName);
      tag?.enabledLives?.forEach((key) => enabledFromTags.add(key));
    }
    if (enabledFromTags.size > 0) {
      return allLives.filter((l) => enabledFromTags.has(l.key));
    }
  }

  // 3. Permissive Fallback
  return allLives;
}

export async function setCachedConfig(config: AdminConfig) {
  cachedConfig = config;
}

export type { ApiSite, LiveCfg };
