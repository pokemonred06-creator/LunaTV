'use client';

import {
  Ban,
  CheckCircle,
  Database,
  Home,
  Loader2,
  LogOut,
  Plus,
  RefreshCw,
  Rss,
  Save,
  Settings,
  Shield,
  ShieldAlert,
  Tags,
  Trash2,
  Tv,
  Users,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { Dispatch, ElementType, SetStateAction } from 'react';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';

import {
  AdminConfig,
  ApiSite,
  CustomCategory,
  LiveCfg,
  SiteConfig,
  User,
} from '@/lib/admin.types';

import { useLanguage } from '@/components/LanguageProvider';

// --- Domain Types ---

type TabType = 'base' | 'users' | 'sources' | 'live' | 'category' | 'subscribe';
type Season = 'auto' | 'spring' | 'summer' | 'autumn' | 'winter' | 'off';
type Intensity = 'light' | 'normal' | 'heavy';
type HttpMethod = 'GET' | 'POST';

interface TabDefinition {
  id: TabType;
  name: string;
  icon: ElementType;
}

interface ApiErrorShape {
  error?: string;
}

// Type guard
function isApiErrorShape(x: unknown): x is ApiErrorShape {
  return typeof x === 'object' && x !== null && 'error' in x;
}

// --- Main Component ---

export default function AdminPage() {
  const router = useRouter();
  const { convert } = useLanguage();

  const [config, setConfig] = useState<AdminConfig | null>(null);
  const [role, setRole] = useState<'owner' | 'admin' | 'user' | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<TabType>('base');

  // Granular processing map: stores 'true' for specific action keys (e.g., 'user-ban-username')
  const [processingMap, setProcessingMap] = useState<Record<string, boolean>>(
    {},
  );

  const setProcessingKey = (key: string, val: boolean) =>
    setProcessingMap((m) => ({ ...m, [key]: val }));

  // --- API Helper ---

  const fetchConfig = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/config');
      if (res.status === 401) {
        router.push('/login');
        return;
      }
      const data = await res.json();
      setConfig(data.Config);
      setRole(data.Role);
    } catch (error) {
      console.error(error);
      toast.error('Failed to load configuration');
    } finally {
      setLoading(false);
    }
  }, [router]);

  const handleRequest = useCallback(
    async <T,>(
      key: string,
      url: string,
      method: HttpMethod,
      body?: unknown,
      opts?: {
        successMessage?: string;
        onSuccess?: (data: T) => void;
        refresh?: boolean;
      },
    ): Promise<T | null> => {
      setProcessingKey(key, true);
      try {
        const res = await fetch(url, {
          method,
          headers: body ? { 'Content-Type': 'application/json' } : undefined,
          body: body ? JSON.stringify(body) : undefined,
        });

        if (res.status === 401) {
          router.push('/login');
          return null;
        }

        const data = (await res.json().catch(() => null)) as
          | T
          | ApiErrorShape
          | null;

        if (!res.ok) {
          const msg =
            data && isApiErrorShape(data) && data.error
              ? data.error
              : 'Operation failed';
          toast.error(msg);
          return null;
        }

        if (opts?.successMessage) toast.success(opts.successMessage);
        if (opts?.onSuccess && data) opts.onSuccess(data as T);
        if (opts?.refresh) fetchConfig();

        return (data as T) ?? null;
      } catch (e) {
        console.error(e);
        toast.error('Network error');
        return null;
      } finally {
        setProcessingKey(key, false);
      }
    },
    [router, fetchConfig],
  );

  // --- Initial Load ---
  useEffect(() => {
    fetchConfig();
  }, [fetchConfig]);

  // --- Handlers ---

  const handleLogout = async () => {
    // Only redirect if the logout request actually succeeds
    const res = await handleRequest('logout', '/api/auth/logout', 'POST');
    if (res !== null) {
      router.push('/login');
    }
  };

  const saveBaseConfig = () => {
    if (!config) return;
    handleRequest('saveBase', '/api/admin/site', 'POST', config.SiteConfig, {
      successMessage: 'Base configuration saved',
      refresh: true,
    });
  };

  const refreshLiveChannels = () => {
    handleRequest(
      'refreshLive',
      '/api/admin/live/refresh',
      'POST',
      {},
      {
        successMessage: 'Channels refreshed successfully',
        refresh: true,
      },
    );
  };

  const saveSubscribeConfig = () => {
    if (!config) return;
    handleRequest(
      'saveSubscribe',
      '/api/admin/subscribe',
      'POST',
      config.ConfigSubscribtion,
      {
        successMessage: 'Subscription config saved',
        refresh: true,
      },
    );
  };

  /**
   * Generic List Action Handler
   * @param keyPrefix - e.g. 'user'
   * @param endpoint - e.g. '/api/admin/user'
   * @param action - e.g. 'ban'
   * @param payload - Data payload
   * @param uniqueId - Specific ID (username, key) to prevent UI loading collisions
   */
  const handleAction = (
    keyPrefix: string,
    endpoint: string,
    action: string,
    payload: object,
    uniqueId?: string,
  ) => {
    const loadingKey = uniqueId
      ? `${keyPrefix}-${action}-${uniqueId}`
      : `${keyPrefix}-${action}`;
    const body = { action, ...payload };

    handleRequest(loadingKey, endpoint, 'POST', body, {
      successMessage: 'Operation successful',
      refresh: true,
    });
  };

  // --- Render ---

  if (loading) {
    return (
      <div className='flex flex-col items-center justify-center min-h-screen text-gray-500 bg-gray-50 dark:bg-gray-900'>
        <Loader2 className='w-10 h-10 animate-spin mb-4 text-blue-500' />
        <p>{convert('正在加载系统配置...')}</p>
      </div>
    );
  }

  if (!config)
    return <div className='p-8 text-center text-red-500'>加载失败</div>;

  const tabs: TabDefinition[] = [
    { id: 'base', name: '基本设置', icon: Settings },
    { id: 'users', name: '用户管理', icon: Users },
    { id: 'sources', name: '源管理', icon: Database },
    { id: 'live', name: '直播源', icon: Tv },
    { id: 'category', name: '分类管理', icon: Tags },
    { id: 'subscribe', name: '订阅管理', icon: Rss },
  ];

  return (
    <div className='container mx-auto p-4 max-w-6xl min-h-screen pb-20'>
      {/* Header */}
      <div className='flex flex-col md:flex-row justify-between items-center mb-8 gap-4'>
        <div>
          <h1 className='text-3xl font-bold text-gray-900 dark:text-white tracking-tight'>
            {convert('系统设置')}
          </h1>
          <p className='text-sm text-gray-500 dark:text-gray-400 mt-1'>
            {convert('管理您的站点配置、用户和内容源')}
          </p>
        </div>
        <div className='flex items-center gap-3'>
          <Link
            href='/'
            className='flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-800 transition-colors'
          >
            <Home className='w-4 h-4' />
            {convert('返回首页')}
          </Link>
          <button
            onClick={handleLogout}
            disabled={processingMap['logout']}
            className='flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/20 transition-colors disabled:opacity-50'
          >
            {processingMap['logout'] ? (
              <Loader2 className='w-4 h-4 animate-spin' />
            ) : (
              <LogOut className='w-4 h-4' />
            )}
            {convert('退出登录')}
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className='flex mb-8 border-b dark:border-gray-700 overflow-x-auto scrollbar-hide'>
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`
                group flex items-center gap-2 px-6 py-3 border-b-2 transition-all whitespace-nowrap text-sm font-medium
                ${
                  isActive
                    ? 'border-blue-500 text-blue-600 dark:text-blue-400 dark:border-blue-400'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300 dark:text-gray-400 dark:hover:text-gray-200'
                }
              `}
            >
              <Icon
                className={`w-4 h-4 ${isActive ? 'text-blue-500' : 'text-gray-400 group-hover:text-gray-600'}`}
              />
              {convert(tab.name)}
            </button>
          );
        })}
      </div>

      {/* Content Area */}
      <div className='bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-6 md:p-8 transition-all'>
        {activeTab === 'base' && (
          <BaseConfigForm
            config={config}
            setConfig={setConfig}
            onSave={saveBaseConfig}
            processing={!!processingMap['saveBase']}
            convert={convert}
          />
        )}

        {activeTab === 'users' && (
          <UserManagement
            users={config.UserConfig.Users || []}
            role={role}
            onAction={(action, payload, uid) =>
              handleAction('user', '/api/admin/user', action, payload, uid)
            }
            convert={convert}
            processingMap={processingMap}
          />
        )}

        {activeTab === 'sources' && (
          <SourceManagement
            sources={config.SourceConfig || []}
            onAction={(action, payload, uid) =>
              handleAction('source', '/api/admin/source', action, payload, uid)
            }
            convert={convert}
            processingMap={processingMap}
          />
        )}

        {activeTab === 'live' && (
          <LiveManagement
            lives={config.LiveConfig || []}
            onAction={(action, payload, uid) =>
              handleAction('live', '/api/admin/live', action, payload, uid)
            }
            onRefresh={refreshLiveChannels}
            isRefreshing={!!processingMap['refreshLive']}
            convert={convert}
            processingMap={processingMap}
          />
        )}

        {activeTab === 'category' && (
          <CategoryManagement
            categories={config.CustomCategories || []}
            onAction={(action, payload, uid) =>
              handleAction(
                'category',
                '/api/admin/category',
                action,
                payload,
                uid,
              )
            }
            convert={convert}
            processingMap={processingMap}
          />
        )}

        {activeTab === 'subscribe' && (
          <SubscribeManagement
            configSubscribtion={config.ConfigSubscribtion}
            setConfig={setConfig}
            onSave={saveSubscribeConfig}
            processing={!!processingMap['saveSubscribe']}
            convert={convert}
          />
        )}
      </div>
    </div>
  );
}

// --- Sub Components ---

interface BaseConfigProps {
  config: AdminConfig;
  setConfig: Dispatch<SetStateAction<AdminConfig | null>>;
  onSave: () => void;
  processing: boolean;
  convert: (s: string) => string;
}

const BaseConfigForm = ({
  config,
  setConfig,
  onSave,
  processing,
  convert,
}: BaseConfigProps) => {
  const handleChange = <K extends keyof SiteConfig>(
    key: K,
    value: SiteConfig[K],
  ) => {
    setConfig((prev) =>
      prev
        ? {
            ...prev,
            SiteConfig: { ...prev.SiteConfig, [key]: value },
          }
        : null,
    );
  };

  const handleSeasonalChange = (
    updates: Partial<NonNullable<SiteConfig['SeasonalEffects']>>,
  ) => {
    const current = config.SiteConfig?.SeasonalEffects || {
      enabled: false,
      season: 'auto',
      intensity: 'normal',
    };
    handleChange('SeasonalEffects', { ...current, ...updates });
  };

  return (
    <div className='space-y-8 animate-in fade-in duration-500'>
      <div className='grid grid-cols-1 md:grid-cols-2 gap-6'>
        <FormInput
          label={convert('站点名称')}
          value={config.SiteConfig?.SiteName}
          onChange={(v) => handleChange('SiteName', v)}
        />
        <FormInput
          label={convert('接口缓存时间 (秒)')}
          type='number'
          value={config.SiteConfig?.SiteInterfaceCacheTime}
          onChange={(v) => handleChange('SiteInterfaceCacheTime', Number(v))}
        />
        <FormInput
          label={convert('搜索最大页数')}
          type='number'
          value={config.SiteConfig?.SearchDownstreamMaxPage}
          onChange={(v) => handleChange('SearchDownstreamMaxPage', Number(v))}
        />

        <div className='col-span-1 md:col-span-2'>
          <label className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1'>
            {convert('站点公告')}
          </label>
          <textarea
            value={config.SiteConfig?.Announcement || ''}
            onChange={(e) => handleChange('Announcement', e.target.value)}
            className='w-full border rounded-lg px-3 py-2 h-24 outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white transition-all'
          />
        </div>
      </div>

      <SectionHeader title={convert('豆瓣代理设置')} />
      <div className='grid grid-cols-1 md:grid-cols-2 gap-6'>
        <div>
          <label className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1'>
            {convert('接口代理类型')}
          </label>
          <select
            value={config.SiteConfig?.DoubanProxyType || 'direct'}
            onChange={(e) =>
              handleChange(
                'DoubanProxyType',
                e.target.value as SiteConfig['DoubanProxyType'],
              )
            }
            className='w-full border rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white'
          >
            <option value='direct'>{convert('直连')}</option>
            <option value='custom'>{convert('自定义代理')}</option>
            <option value='cors-proxy-zwei'>cors-proxy-zwei</option>
            <option value='cmliussss-cdn-tencent'>cmliussss-cdn-tencent</option>
            <option value='cmliussss-cdn-ali'>cmliussss-cdn-ali</option>
          </select>
        </div>
        <FormInput
          label={convert('接口代理地址')}
          value={config.SiteConfig?.DoubanProxy}
          onChange={(v) => handleChange('DoubanProxy', v)}
          placeholder='https://api.example.com'
          disabled={config.SiteConfig?.DoubanProxyType !== 'custom'}
        />

        <div>
          <label className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1'>
            {convert('图片代理类型')}
          </label>
          <select
            value={
              config.SiteConfig?.DoubanImageProxyType || 'cmliussss-cdn-tencent'
            }
            onChange={(e) =>
              handleChange(
                'DoubanImageProxyType',
                e.target.value as SiteConfig['DoubanImageProxyType'],
              )
            }
            className='w-full border rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white'
          >
            <option value='direct'>{convert('直连')}</option>
            <option value='cmliussss-cdn-tencent'>cmliussss-cdn-tencent</option>
            <option value='cmliussss-cdn-ali'>cmliussss-cdn-ali</option>
            <option value='custom'>{convert('自定义代理')}</option>
          </select>
        </div>
        <FormInput
          label={convert('图片代理地址')}
          value={config.SiteConfig?.DoubanImageProxy}
          onChange={(v) => handleChange('DoubanImageProxy', v)}
          placeholder='https://img.example.com'
          disabled={config.SiteConfig?.DoubanImageProxyType !== 'custom'}
        />
      </div>

      <SectionHeader title={convert('高级设置')} />
      <div className='flex flex-wrap gap-6'>
        <Toggle
          label={convert('禁用黄反过滤')}
          checked={config.SiteConfig?.DisableYellowFilter}
          onChange={(v) => handleChange('DisableYellowFilter', v)}
        />
        <Toggle
          label={convert('启用流式搜索')}
          checked={config.SiteConfig?.FluidSearch}
          onChange={(v) => handleChange('FluidSearch', v)}
        />
        <Toggle
          label={convert('启用播放器调试日志')}
          checked={config.SiteConfig?.DebugLogs}
          onChange={(v) => handleChange('DebugLogs', v)}
        />
      </div>

      <SectionHeader title={`${convert('季节特效')} ❄️🌸🍃🍁`} />
      <div className='grid grid-cols-1 md:grid-cols-3 gap-6'>
        <div className='flex items-center'>
          <Toggle
            label={convert('启用季节特效')}
            checked={config.SiteConfig?.SeasonalEffects?.enabled}
            onChange={(v) => handleSeasonalChange({ enabled: v })}
          />
        </div>
        <div>
          <label className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1'>
            {convert('季节')}
          </label>
          <select
            value={config.SiteConfig?.SeasonalEffects?.season || 'auto'}
            onChange={(e) =>
              handleSeasonalChange({ season: e.target.value as Season })
            }
            disabled={!config.SiteConfig?.SeasonalEffects?.enabled}
            className='w-full border rounded-lg px-3 py-2 outline-none dark:bg-gray-700 dark:border-gray-600 dark:text-white disabled:opacity-50'
          >
            <option value='auto'>{convert('自动（根据月份）')}</option>
            <option value='spring'>{convert('春季 - 樱花雨 🌸')}</option>
            <option value='summer'>{convert('夏季 - 绿叶雨 🍃')}</option>
            <option value='autumn'>{convert('秋季 - 红枫落叶 🍁')}</option>
            <option value='winter'>{convert('冬季 - 雪花 ❄️')}</option>
            <option value='off'>{convert('关闭效果')}</option>
          </select>
        </div>
        <div>
          <label className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1'>
            {convert('飘落密度')}
          </label>
          <div className='flex rounded-md shadow-sm'>
            {(['light', 'normal', 'heavy'] as Intensity[]).map((val) => (
              <button
                key={val}
                onClick={() => handleSeasonalChange({ intensity: val })}
                disabled={!config.SiteConfig?.SeasonalEffects?.enabled}
                className={`flex-1 px-3 py-2 text-sm border first:rounded-l-md last:rounded-r-md 
                    ${
                      config.SiteConfig?.SeasonalEffects?.intensity === val
                        ? 'bg-blue-50 border-blue-500 text-blue-600 dark:bg-blue-900/40 dark:text-blue-200'
                        : 'bg-white border-gray-300 text-gray-700 dark:bg-gray-700 dark:border-gray-600 dark:text-gray-300 hover:bg-gray-50'
                    } disabled:opacity-50`}
              >
                {val === 'light' ? '轻柔' : val === 'normal' ? '正常' : '浓密'}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className='flex justify-end pt-6'>
        <SaveButton
          onClick={onSave}
          loading={processing}
          text={convert('保存配置')}
        />
      </div>
    </div>
  );
};

interface UserManagementProps {
  users: User[];
  role: unknown;
  onAction: (action: string, payload: object, uniqueId?: string) => void;
  convert: (s: string) => string;
  processingMap: Record<string, boolean>;
}

function UserManagement({
  users,
  role,
  onAction,
  convert,
  processingMap,
}: UserManagementProps) {
  const [newUser, setNewUser] = useState({ username: '', password: '' });

  return (
    <div className='space-y-6 animate-in fade-in'>
      <div className='border dark:border-gray-700 p-5 rounded-xl bg-gray-50/50 dark:bg-gray-700/30'>
        <h3 className='font-semibold mb-4 text-gray-800 dark:text-white flex items-center gap-2'>
          <Plus className='w-4 h-4' /> {convert('添加用户')}
        </h3>
        <div className='flex flex-col md:flex-row gap-4'>
          <input
            placeholder={convert('用户名')}
            className='flex-1 border p-2 rounded-lg dark:bg-gray-800 dark:border-gray-600 dark:text-white focus:ring-2 focus:ring-blue-500 outline-none'
            value={newUser.username}
            onChange={(e) =>
              setNewUser({ ...newUser, username: e.target.value })
            }
          />
          <input
            placeholder={convert('密码')}
            type='password'
            className='flex-1 border p-2 rounded-lg dark:bg-gray-800 dark:border-gray-600 dark:text-white focus:ring-2 focus:ring-blue-500 outline-none'
            value={newUser.password}
            onChange={(e) =>
              setNewUser({ ...newUser, password: e.target.value })
            }
          />
          <button
            className='bg-green-600 text-white px-6 py-2 rounded-lg hover:bg-green-700 transition-colors font-medium shadow-sm hover:shadow disabled:opacity-50'
            disabled={
              !newUser.username ||
              !newUser.password ||
              !!processingMap['user-add-new']
            }
            onClick={() => {
              onAction(
                'add',
                {
                  targetUsername: newUser.username,
                  targetPassword: newUser.password,
                },
                'new',
              );
              setNewUser({ username: '', password: '' });
            }}
          >
            {processingMap['user-add-new'] ? (
              <Loader2 className='w-4 h-4 animate-spin' />
            ) : (
              convert('添加')
            )}
          </button>
        </div>
      </div>

      <div className='overflow-hidden rounded-lg border border-gray-200 dark:border-gray-700'>
        <table className='min-w-full text-left'>
          <thead className='bg-gray-50 dark:bg-gray-800/50'>
            <tr className='text-xs font-semibold tracking-wide text-gray-500 uppercase dark:text-gray-400'>
              <th className='p-3'>{convert('用户名')}</th>
              <th className='p-3'>{convert('角色')}</th>
              <th className='p-3'>{convert('状态')}</th>
              <th className='p-3 text-right'>{convert('操作')}</th>
            </tr>
          </thead>
          <tbody className='divide-y divide-gray-100 dark:divide-gray-700'>
            {users.map((u) => (
              <tr
                key={u.username}
                className='hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors'
              >
                <td className='p-3 font-medium text-gray-900 dark:text-gray-100'>
                  {u.username}
                </td>
                <td className='p-3'>
                  <span
                    className={`px-2 py-1 rounded-full text-xs ${u.role === 'owner' ? 'bg-purple-100 text-purple-700' : 'bg-gray-100 text-gray-700'}`}
                  >
                    {u.role}
                  </span>
                </td>
                <td className='p-3'>
                  {u.banned ? (
                    <span className='flex items-center gap-1 text-red-600 text-sm'>
                      <Ban className='w-3 h-3' /> {convert('已封禁')}
                    </span>
                  ) : (
                    <span className='flex items-center gap-1 text-green-600 text-sm'>
                      <CheckCircle className='w-3 h-3' /> {convert('正常')}
                    </span>
                  )}
                </td>
                <td className='p-3 flex justify-end gap-2'>
                  {u.role !== 'owner' && (
                    <>
                      <ActionButton
                        icon={u.banned ? CheckCircle : Ban}
                        color={u.banned ? 'green' : 'orange'}
                        loading={
                          !!processingMap[
                            `user-${u.banned ? 'unban' : 'ban'}-${u.username}`
                          ]
                        }
                        onClick={() =>
                          onAction(
                            u.banned ? 'unban' : 'ban',
                            { targetUsername: u.username },
                            u.username,
                          )
                        }
                        title={u.banned ? convert('解封') : convert('封禁')}
                      />
                      <ActionButton
                        icon={u.role === 'admin' ? ShieldAlert : Shield}
                        color='blue'
                        loading={
                          !!processingMap[
                            `user-${u.role === 'admin' ? 'cancelAdmin' : 'setAdmin'}-${u.username}`
                          ]
                        }
                        onClick={() =>
                          onAction(
                            u.role === 'admin' ? 'cancelAdmin' : 'setAdmin',
                            { targetUsername: u.username },
                            u.username,
                          )
                        }
                        title={
                          u.role === 'admin'
                            ? convert('取消管理')
                            : convert('设为管理')
                        }
                      />
                      <ActionButton
                        icon={Trash2}
                        color='red'
                        loading={
                          !!processingMap[`user-deleteUser-${u.username}`]
                        }
                        onClick={() =>
                          onAction(
                            'deleteUser',
                            { targetUsername: u.username },
                            u.username,
                          )
                        }
                        title={convert('删除')}
                      />
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

interface SourceManagementProps {
  sources: ApiSite[];
  onAction: (action: string, payload: object, uniqueId?: string) => void;
  convert: (s: string) => string;
  processingMap: Record<string, boolean>;
}

function SourceManagement({
  sources,
  onAction,
  convert,
  processingMap,
}: SourceManagementProps) {
  const [newSource, setNewSource] = useState({ key: '', name: '', api: '' });

  return (
    <div className='space-y-6'>
      <div className='border dark:border-gray-700 p-5 rounded-xl bg-gray-50/50 dark:bg-gray-700/30'>
        <h3 className='font-semibold mb-4 text-gray-800 dark:text-white flex items-center gap-2'>
          <Plus className='w-4 h-4' /> {convert('添加采集源')}
        </h3>
        <div className='grid grid-cols-1 md:grid-cols-4 gap-4'>
          <input
            placeholder={convert('Key (唯一标识)')}
            className='border p-2 rounded-lg dark:bg-gray-800 dark:border-gray-600 dark:text-white'
            value={newSource.key}
            onChange={(e) =>
              setNewSource({ ...newSource, key: e.target.value })
            }
          />
          <input
            placeholder={convert('名称')}
            className='border p-2 rounded-lg dark:bg-gray-800 dark:border-gray-600 dark:text-white'
            value={newSource.name}
            onChange={(e) =>
              setNewSource({ ...newSource, name: e.target.value })
            }
          />
          <input
            placeholder={convert('API 地址')}
            className='col-span-1 md:col-span-2 border p-2 rounded-lg dark:bg-gray-800 dark:border-gray-600 dark:text-white'
            value={newSource.api}
            onChange={(e) =>
              setNewSource({ ...newSource, api: e.target.value })
            }
          />
        </div>
        <div className='mt-4 flex justify-end'>
          <button
            className='bg-green-600 text-white px-6 py-2 rounded-lg hover:bg-green-700 transition-colors disabled:opacity-50'
            disabled={
              !newSource.key ||
              !newSource.name ||
              !!processingMap['source-add-new']
            }
            onClick={() => {
              onAction('add', newSource, 'new');
              setNewSource({ key: '', name: '', api: '' });
            }}
          >
            {processingMap['source-add-new'] ? (
              <Loader2 className='w-4 h-4 animate-spin' />
            ) : (
              convert('添加')
            )}
          </button>
        </div>
      </div>

      <div className='overflow-hidden rounded-lg border border-gray-200 dark:border-gray-700'>
        <table className='min-w-full text-left'>
          <thead className='bg-gray-50 dark:bg-gray-800/50'>
            <tr className='text-xs font-semibold tracking-wide text-gray-500 uppercase'>
              <th className='p-3'>{convert('名称')}</th>
              <th className='p-3'>{convert('API')}</th>
              <th className='p-3'>{convert('状态')}</th>
              <th className='p-3 text-right'>{convert('操作')}</th>
            </tr>
          </thead>
          <tbody className='divide-y divide-gray-100 dark:divide-gray-700'>
            {sources.map((s) => (
              <tr
                key={s.key}
                className='hover:bg-gray-50 dark:hover:bg-gray-700/50'
              >
                <td className='p-3 font-medium'>{s.name}</td>
                <td
                  className='p-3 text-sm text-gray-500 truncate max-w-xs'
                  title={s.api}
                >
                  {s.api}
                </td>
                <td className='p-3'>
                  {s.disabled ? (
                    <span className='text-red-600 text-xs bg-red-50 dark:bg-red-900/20 px-2 py-1 rounded'>
                      {convert('禁用')}
                    </span>
                  ) : (
                    <span className='text-green-600 text-xs bg-green-50 dark:bg-green-900/20 px-2 py-1 rounded'>
                      {convert('启用')}
                    </span>
                  )}
                </td>
                <td className='p-3 flex justify-end gap-2'>
                  <ActionButton
                    icon={s.disabled ? CheckCircle : Ban}
                    color={s.disabled ? 'green' : 'orange'}
                    loading={
                      !!processingMap[
                        `source-${s.disabled ? 'enable' : 'disable'}-${s.key}`
                      ]
                    }
                    onClick={() =>
                      onAction(
                        s.disabled ? 'enable' : 'disable',
                        { key: s.key },
                        s.key,
                      )
                    }
                    title={s.disabled ? convert('启用') : convert('禁用')}
                  />
                  {s.from === 'custom' && (
                    <ActionButton
                      icon={Trash2}
                      color='red'
                      loading={!!processingMap[`source-delete-${s.key}`]}
                      onClick={() => onAction('delete', { key: s.key }, s.key)}
                      title={convert('删除')}
                    />
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

interface LiveManagementProps {
  lives: LiveCfg[];
  onAction: (action: string, payload: object, uniqueId?: string) => void;
  onRefresh: () => void;
  isRefreshing: boolean;
  convert: (s: string) => string;
  processingMap: Record<string, boolean>;
}

function LiveManagement({
  lives,
  onAction,
  onRefresh,
  isRefreshing,
  convert,
  processingMap,
}: LiveManagementProps) {
  const [newLive, setNewLive] = useState({ key: '', name: '', url: '' });

  return (
    <div className='space-y-6'>
      <div className='flex justify-between items-center'>
        <h3 className='font-bold text-gray-800 dark:text-white'>
          {convert('直播源列表')}
        </h3>
        <button
          className='flex items-center gap-2 bg-blue-500 text-white px-4 py-2 rounded-lg hover:bg-blue-600 disabled:opacity-50'
          onClick={onRefresh}
          disabled={isRefreshing}
        >
          {isRefreshing ? (
            <Loader2 className='w-4 h-4 animate-spin' />
          ) : (
            <RefreshCw className='w-4 h-4' />
          )}
          {convert('刷新频道数')}
        </button>
      </div>

      <div className='border dark:border-gray-700 p-5 rounded-xl bg-gray-50/50 dark:bg-gray-700/30'>
        <h3 className='font-semibold mb-4 text-gray-800 dark:text-white flex items-center gap-2'>
          <Plus className='w-4 h-4' /> {convert('添加直播源')}
        </h3>
        <div className='grid grid-cols-1 md:grid-cols-3 gap-4'>
          <input
            placeholder={convert('Key')}
            className='border p-2 rounded-lg dark:bg-gray-800 dark:border-gray-600 dark:text-white'
            value={newLive.key}
            onChange={(e) => setNewLive({ ...newLive, key: e.target.value })}
          />
          <input
            placeholder={convert('名称')}
            className='border p-2 rounded-lg dark:bg-gray-800 dark:border-gray-600 dark:text-white'
            value={newLive.name}
            onChange={(e) => setNewLive({ ...newLive, name: e.target.value })}
          />
          <input
            placeholder={convert('M3U8 URL')}
            className='border p-2 rounded-lg dark:bg-gray-800 dark:border-gray-600 dark:text-white'
            value={newLive.url}
            onChange={(e) => setNewLive({ ...newLive, url: e.target.value })}
          />
        </div>
        <div className='mt-4 flex justify-end'>
          <button
            className='bg-green-600 text-white px-6 py-2 rounded-lg hover:bg-green-700 transition-colors disabled:opacity-50'
            onClick={() => {
              onAction('add', newLive, 'new');
              setNewLive({ key: '', name: '', url: '' });
            }}
            disabled={!newLive.key || !!processingMap['live-add-new']}
          >
            {processingMap['live-add-new'] ? (
              <Loader2 className='w-4 h-4 animate-spin' />
            ) : (
              convert('添加')
            )}
          </button>
        </div>
      </div>

      <div className='overflow-hidden rounded-lg border border-gray-200 dark:border-gray-700'>
        <table className='min-w-full text-left'>
          <thead className='bg-gray-50 dark:bg-gray-800/50'>
            <tr className='text-xs font-semibold tracking-wide text-gray-500 uppercase'>
              <th className='p-3'>{convert('名称')}</th>
              <th className='p-3'>{convert('频道数')}</th>
              <th className='p-3'>{convert('状态')}</th>
              <th className='p-3 text-right'>{convert('操作')}</th>
            </tr>
          </thead>
          <tbody className='divide-y divide-gray-100 dark:divide-gray-700'>
            {lives.map((l) => (
              <tr
                key={l.key}
                className='hover:bg-gray-50 dark:hover:bg-gray-700/50'
              >
                <td className='p-3 font-medium'>{l.name}</td>
                <td className='p-3 font-mono text-sm'>{l.channelNumber}</td>
                <td className='p-3'>
                  {l.disabled ? (
                    <span className='text-red-600 text-xs bg-red-50 dark:bg-red-900/20 px-2 py-1 rounded'>
                      {convert('禁用')}
                    </span>
                  ) : (
                    <span className='text-green-600 text-xs bg-green-50 dark:bg-green-900/20 px-2 py-1 rounded'>
                      {convert('启用')}
                    </span>
                  )}
                </td>
                <td className='p-3 flex justify-end gap-2'>
                  <ActionButton
                    icon={l.disabled ? CheckCircle : Ban}
                    color={l.disabled ? 'green' : 'orange'}
                    loading={
                      !!processingMap[
                        `live-${l.disabled ? 'enable' : 'disable'}-${l.key}`
                      ]
                    }
                    onClick={() =>
                      onAction(
                        l.disabled ? 'enable' : 'disable',
                        { key: l.key },
                        l.key,
                      )
                    }
                    title={l.disabled ? convert('启用') : convert('禁用')}
                  />
                  {l.from === 'custom' && (
                    <ActionButton
                      icon={Trash2}
                      color='red'
                      loading={!!processingMap[`live-delete-${l.key}`]}
                      onClick={() => onAction('delete', { key: l.key }, l.key)}
                      title={convert('删除')}
                    />
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

interface CategoryManagementProps {
  categories: CustomCategory[];
  onAction: (action: string, payload: object, uniqueId?: string) => void;
  convert: (s: string) => string;
  processingMap: Record<string, boolean>;
}

function CategoryManagement({
  categories,
  onAction,
  convert,
  processingMap,
}: CategoryManagementProps) {
  const [newCat, setNewCat] = useState<{
    name: string;
    type: 'movie' | 'tv';
    query: string;
  }>({ name: '', type: 'movie', query: '' });

  return (
    <div className='space-y-6'>
      <div className='border dark:border-gray-700 p-5 rounded-xl bg-gray-50/50 dark:bg-gray-700/30'>
        <h3 className='font-semibold mb-4 text-gray-800 dark:text-white flex items-center gap-2'>
          <Plus className='w-4 h-4' /> {convert('添加分类')}
        </h3>
        <div className='grid grid-cols-1 md:grid-cols-3 gap-4'>
          <input
            placeholder={convert('名称')}
            className='border p-2 rounded-lg dark:bg-gray-800 dark:border-gray-600 dark:text-white'
            value={newCat.name}
            onChange={(e) => setNewCat({ ...newCat, name: e.target.value })}
          />
          <select
            className='border p-2 rounded-lg dark:bg-gray-800 dark:border-gray-600 dark:text-white'
            value={newCat.type}
            onChange={(e) =>
              setNewCat({ ...newCat, type: e.target.value as 'movie' | 'tv' })
            }
          >
            <option value='movie'>{convert('电影')}</option>
            <option value='tv'>{convert('剧集')}</option>
          </select>
          <input
            placeholder={convert('查询关键词')}
            className='border p-2 rounded-lg dark:bg-gray-800 dark:border-gray-600 dark:text-white'
            value={newCat.query}
            onChange={(e) => setNewCat({ ...newCat, query: e.target.value })}
          />
        </div>
        <div className='mt-4 flex justify-end'>
          <button
            className='bg-green-600 text-white px-6 py-2 rounded-lg hover:bg-green-700 transition-colors disabled:opacity-50'
            onClick={() => {
              onAction('add', newCat, 'new');
              setNewCat({ name: '', type: 'movie', query: '' });
            }}
            disabled={
              !newCat.name ||
              !newCat.query ||
              !!processingMap['category-add-new']
            }
          >
            {processingMap['category-add-new'] ? (
              <Loader2 className='w-4 h-4 animate-spin' />
            ) : (
              convert('添加')
            )}
          </button>
        </div>
      </div>

      <div className='overflow-hidden rounded-lg border border-gray-200 dark:border-gray-700'>
        <table className='min-w-full text-left'>
          <thead className='bg-gray-50 dark:bg-gray-800/50'>
            <tr className='text-xs font-semibold tracking-wide text-gray-500 uppercase'>
              <th className='p-3'>{convert('名称')}</th>
              <th className='p-3'>{convert('类型')}</th>
              <th className='p-3'>{convert('查询词')}</th>
              <th className='p-3 text-right'>{convert('操作')}</th>
            </tr>
          </thead>
          <tbody className='divide-y divide-gray-100 dark:divide-gray-700'>
            {categories.map((c) => (
              <tr
                key={c.query}
                className='hover:bg-gray-50 dark:hover:bg-gray-700/50'
              >
                <td className='p-3 font-medium'>{c.name}</td>
                <td className='p-3 text-sm text-gray-500'>
                  {c.type === 'movie' ? convert('电影') : convert('剧集')}
                </td>
                <td className='p-3 font-mono text-sm'>{c.query}</td>
                <td className='p-3 flex justify-end'>
                  {c.from === 'custom' && (
                    <ActionButton
                      icon={Trash2}
                      color='red'
                      loading={!!processingMap[`category-delete-${c.query}`]}
                      onClick={() =>
                        onAction(
                          'delete',
                          { query: c.query, type: c.type },
                          c.query,
                        )
                      }
                      title={convert('删除')}
                    />
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

interface SubscribeManagementProps {
  configSubscribtion: AdminConfig['ConfigSubscribtion'];
  setConfig: Dispatch<SetStateAction<AdminConfig | null>>;
  onSave: () => void;
  processing: boolean;
  convert: (s: string) => string;
}

function SubscribeManagement({
  configSubscribtion,
  setConfig,
  onSave,
  processing,
  convert,
}: SubscribeManagementProps) {
  const handleChange = (key: string, value: unknown) => {
    setConfig((prev) =>
      prev
        ? {
            ...prev,
            ConfigSubscribtion: { ...prev.ConfigSubscribtion, [key]: value },
          }
        : null,
    );
  };

  return (
    <div className='space-y-6 animate-in fade-in'>
      <div className='bg-blue-50 dark:bg-blue-900/20 p-4 rounded-lg border border-blue-100 dark:border-blue-800'>
        <p className='text-sm text-blue-800 dark:text-blue-200 flex items-center gap-2'>
          <Rss className='w-4 h-4' />
          {convert('配置订阅 URL 可以自动同步远端的配置更新。')}
        </p>
      </div>

      <div className='grid grid-cols-1 gap-6'>
        <FormInput
          label={convert('订阅 URL')}
          value={configSubscribtion?.URL}
          onChange={(v) => handleChange('URL', v)}
          placeholder='https://example.com/config.json'
        />

        <div className='flex items-center justify-between border p-4 rounded-lg dark:border-gray-700 dark:bg-gray-800/30'>
          <div>
            <span className='block font-medium text-gray-700 dark:text-gray-200'>
              {convert('自动更新')}
            </span>
            <span className='text-xs text-gray-500'>
              {convert('定期检查并应用更新')}
            </span>
          </div>
          <Toggle
            checked={configSubscribtion?.AutoUpdate}
            onChange={(v) => handleChange('AutoUpdate', v)}
          />
        </div>

        <div className='bg-gray-50 dark:bg-gray-800 p-4 rounded-lg'>
          <label className='block text-xs font-medium text-gray-500 mb-1 uppercase'>
            {convert('上次检查时间')}
          </label>
          <div className='text-gray-900 dark:text-white font-mono'>
            {configSubscribtion?.LastCheck || 'N/A'}
          </div>
        </div>
      </div>
      <div className='flex justify-end pt-4'>
        <SaveButton
          onClick={onSave}
          loading={processing}
          text={convert('保存配置')}
        />
      </div>
    </div>
  );
}

// --- Reusable UI Atoms ---

const FormInput = ({
  label,
  type = 'text',
  value,
  onChange,
  placeholder,
  disabled,
}: {
  label: string;
  type?: string;
  value: string | number | undefined;
  onChange: (val: string) => void;
  placeholder?: string;
  disabled?: boolean;
}) => (
  <div>
    <label className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1'>
      {label}
    </label>
    <input
      type={type}
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      disabled={disabled}
      className='w-full border rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100 dark:bg-gray-700 dark:border-gray-600 dark:text-white dark:disabled:bg-gray-800 dark:disabled:text-gray-500 transition-all'
    />
  </div>
);

const Toggle = ({
  label,
  checked,
  onChange,
}: {
  label?: string;
  checked?: boolean;
  onChange: (val: boolean) => void;
}) => (
  <label className='flex items-center gap-3 cursor-pointer group'>
    <div
      className={`w-10 h-6 rounded-full p-1 transition-colors duration-200 ease-in-out ${checked ? 'bg-blue-600' : 'bg-gray-300 dark:bg-gray-600'}`}
    >
      <div
        className={`bg-white w-4 h-4 rounded-full shadow-md transform transition-transform duration-200 ease-in-out ${checked ? 'translate-x-4' : 'translate-x-0'}`}
      />
    </div>
    <input
      type='checkbox'
      className='hidden'
      checked={!!checked}
      onChange={(e) => onChange(e.target.checked)}
    />
    {label && (
      <span className='text-sm text-gray-700 dark:text-gray-300 group-hover:text-gray-900 dark:group-hover:text-white transition-colors'>
        {label}
      </span>
    )}
  </label>
);

const SaveButton = ({
  onClick,
  loading,
  text,
}: {
  onClick: () => void;
  loading: boolean;
  text: string;
}) => (
  <button
    onClick={onClick}
    disabled={loading}
    className='flex items-center gap-2 px-6 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:bg-blue-600 dark:hover:bg-blue-700 disabled:opacity-70 disabled:cursor-not-allowed transition-all shadow-sm hover:shadow-md'
  >
    {loading ? (
      <Loader2 className='w-4 h-4 animate-spin' />
    ) : (
      <Save className='w-4 h-4' />
    )}
    {text}
  </button>
);

const ActionButton = ({
  icon: Icon,
  onClick,
  color,
  title,
  loading,
}: {
  icon: ElementType;
  onClick: () => void;
  color: 'red' | 'blue' | 'green' | 'orange';
  title: string;
  loading?: boolean;
}) => {
  const colors = {
    red: 'text-red-500 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/30',
    blue: 'text-blue-500 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-900/30',
    green:
      'text-green-500 hover:bg-green-50 dark:text-green-400 dark:hover:bg-green-900/30',
    orange:
      'text-orange-500 hover:bg-orange-50 dark:text-orange-400 dark:hover:bg-orange-900/30',
  };

  return (
    <button
      onClick={onClick}
      title={title}
      disabled={loading}
      className={`p-1.5 rounded-md transition-colors disabled:opacity-50 ${colors[color]}`}
    >
      {loading ? (
        <Loader2 className='w-4 h-4 animate-spin' />
      ) : (
        <Icon className='w-4 h-4' />
      )}
    </button>
  );
};

const SectionHeader = ({ title }: { title: string }) => (
  <div className='pb-2 border-b dark:border-gray-700 mt-6 mb-4'>
    <h3 className='font-semibold text-gray-800 dark:text-white text-lg'>
      {title}
    </h3>
  </div>
);
