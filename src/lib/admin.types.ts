export interface ApiSite {
  key: string;
  name: string;
  api: string;
  detail?: string; // Optional detail API
  from?: 'config' | 'custom';
  disabled?: boolean;
}

export interface LiveCfg {
  key: string;
  name: string;
  url: string;
  ua?: string;
  epg?: string;
  channelNumber?: number;
  from?: 'config' | 'custom';
  disabled?: boolean;
}

export interface Tag {
  name: string;
  color?: string;
  enabledApis?: string[]; // Array of ApiSite keys
  enabledLives?: string[]; // Array of LiveCfg keys (NEW)
}

export interface User {
  username: string;
  role: 'owner' | 'admin' | 'user';
  banned: boolean;
  enabledApis?: string[]; // Array of ApiSite keys
  enabledLives?: string[]; // Array of LiveCfg keys (NEW)
  tags?: string[]; // Array of Tag names
  disableYellowFilter?: boolean; // NEW: Per-user yellow filter override
}

export interface SiteConfig {
  SiteName: string;
  Announcement: string;
  SearchDownstreamMaxPage: number;
  SiteInterfaceCacheTime: number;
  DoubanProxyType:
    | 'direct'
    | 'custom'
    | 'cors-proxy-zwei'
    | 'cmliussss-cdn-tencent'
    | 'cmliussss-cdn-ali';
  DoubanProxy: string;
  DoubanImageProxyType:
    | 'direct'
    | 'cmliussss-cdn-tencent'
    | 'cmliussss-cdn-ali'
    | 'custom';
  DoubanImageProxy: string;
  DisableYellowFilter: boolean;
  FluidSearch: boolean;
  DoubanDataCacheTTL: number;
  ImageCacheTTL: number;
  DebugLogs?: boolean; // Add optional DebugLogs
  SeasonalEffects?: {
    enabled: boolean;
    season: 'auto' | 'spring' | 'summer' | 'autumn' | 'winter' | 'off';
    intensity: 'light' | 'normal' | 'heavy';
  };
}

export interface UserConfig {
  Users: User[];
  Tags?: Tag[];
}

export interface CustomCategory {
  name: string;
  type: 'movie' | 'tv';
  query: string;
  from?: 'config' | 'custom';
  disabled?: boolean;
}

export interface AdminConfig {
  ConfigFile: string; // The raw JSON string from file/env
  ConfigSubscription: {
    URL: string;
    AutoUpdate: boolean;
    LastCheck: string;
  };
  SiteConfig: SiteConfig;
  UserConfig: UserConfig;
  SourceConfig: ApiSite[];
  CustomCategories: CustomCategory[];
  LiveConfig: LiveCfg[];
}

export interface AdminConfigResult {
  Role: 'owner' | 'admin' | 'user';
  Config: AdminConfig;
}
