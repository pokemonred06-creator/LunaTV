export interface ApiSite {
  key: string;
  name: string;
  api: string;
  download?: string;
  detail?: string;
  jiexiUrl?: string;
  from?: 'config' | 'custom';
  disabled?: boolean;
}

export interface User {
  username: string;
  password?: string;
  role: 'owner' | 'admin' | 'user';
  banned?: boolean;
  score?: number;
  // 用户独立的采集源配置
  enabledApis?: string[]; // 允许使用的 API key 列表，为空则使用全局配置或 tags 配置
  tags?: string[]; // 用户拥有的标签列表
}

export interface Tag {
  name: string;
  enabledApis?: string[]; // 该标签允许使用的 API key 列表
}

export interface CustomCategory {
  name: string;
  type: 'movie' | 'tv';
  query: string;
  from?: 'config' | 'custom';
  disabled?: boolean;
}

export interface LiveCfg {
  key: string;
  name: string;
  url: string;
  ua?: string;
  epg?: string;
  logo?: string;
  channelNumber?: number; // 频道号
  from: 'config' | 'custom'; // Changed to required
  disabled?: boolean;
}

export interface SiteConfig {
  SiteName: string;
  Announcement: string;
  SearchDownstreamMaxPage: number;
  SiteInterfaceCacheTime: number; // 站点接口缓存时间
  DoubanProxyType: 'direct' | 'custom' | 'cors-proxy-zwei' | 'cmliussss-cdn-tencent' | 'cmliussss-cdn-ali';
  DoubanProxy: string;
  DoubanImageProxyType: 'direct' | 'cmliussss-cdn-tencent' | 'cmliussss-cdn-ali' | 'custom';
  DoubanImageProxy: string;
  DisableYellowFilter: boolean; // 是否禁用黄反
  FluidSearch: boolean; // 是否启用流式搜索
  DoubanDataCacheTTL?: number; // Minutes
  ImageCacheTTL?: number; // Days
}

export interface UserConfig {
  Users: User[];
  Tags?: Tag[];
}

export interface AdminConfig {
  ConfigFile: string; // 原始配置文件内容
  ConfigSubscribtion: {
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
  Role: 'owner' | 'user';
  Config: AdminConfig;
}