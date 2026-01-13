/* eslint-disable react-hooks/exhaustive-deps, @typescript-eslint/no-explicit-any */
'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect,useState } from 'react';

import { AdminConfig, ApiSite, CustomCategory,LiveCfg, SiteConfig, User } from '@/lib/admin.types';

import { useLanguage } from '@/components/LanguageProvider';

export default function AdminPage() {
  const router = useRouter();
  const { convert } = useLanguage();
  const [config, setConfig] = useState<AdminConfig | null>(null);
  const [role, setRole] = useState<'owner' | 'admin' | 'user' | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setLoadingSave] = useState(false);
  const [activeTab, setActiveTab] = useState<'base' | 'users' | 'sources' | 'live' | 'category' | 'subscribe'>('base');

  // Fetch Config
  const fetchConfig = async () => {
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
      console.error('获取配置失败', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchConfig();
  }, []);

  // --- Base Settings Handlers ---
  const handleSiteConfigChange = (key: keyof SiteConfig, value: any) => {
    if (!config) return;
    setConfig({ ...config, SiteConfig: { ...config.SiteConfig, [key]: value } });
  };

  const saveBaseConfig = async () => {
    if (!config) return;
    setLoadingSave(true);
    try {
      const res = await fetch('/api/admin/site', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config.SiteConfig),
      });
      if (res.ok) {
        alert('保存成功');
        fetchConfig();
      } else {
        const err = await res.json();
        alert(`保存失败: ${err.error}`);
      }
    } catch (error) {
      console.error(error);
      alert('保存失败');
    } finally {
      setLoadingSave(false);
    }
  };

  // --- User Management Handlers ---
  const handleUserAction = async (action: string, payload: any) => {
    try {
      const res = await fetch('/api/admin/user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, ...payload }),
      });
      if (res.ok) {
        alert('操作成功');
        fetchConfig();
      } else {
        const err = await res.json();
        alert(`操作失败: ${err.error}`);
      }
    } catch (e) {
      alert('操作失败');
    }
  };

  // --- Source Management Handlers ---
  const handleSourceAction = async (action: string, payload: any) => {
    try {
      const res = await fetch('/api/admin/source', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, ...payload }),
      });
      if (res.ok) {
        alert('操作成功');
        fetchConfig();
      } else {
        const err = await res.json();
        alert(`操作失败: ${err.error}`);
      }
    } catch (e) {
      alert('操作失败');
    }
  };

  // --- Live Management Handlers ---
  const handleLiveAction = async (action: string, payload: any) => {
    try {
      const res = await fetch('/api/admin/live', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, ...payload }),
      });
      if (res.ok) {
        alert('操作成功');
        fetchConfig();
      } else {
        const err = await res.json();
        alert(`操作失败: ${err.error}`);
      }
    } catch (e) {
      alert('操作失败');
    }
  };

  const refreshLiveChannels = async () => {
    try {
      const res = await fetch('/api/admin/live/refresh', { method: 'POST' });
      if (res.ok) {
        alert('刷新成功');
        fetchConfig();
      } else {
        const err = await res.json();
        alert(`刷新失败: ${err.error}`);
      }
    } catch (e) {
      alert('刷新失败');
    }
  };

  // --- Category Management Handlers ---
  const handleCategoryAction = async (action: string, payload: any) => {
    try {
      const res = await fetch('/api/admin/category', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, ...payload }),
      });
      if (res.ok) {
        alert('操作成功');
        fetchConfig();
      } else {
        const err = await res.json();
        alert(`操作失败: ${err.error}`);
      }
    } catch (e) {
      alert('操作失败');
    }
  };

  // --- Subscribe Management Handlers ---
  const handleSubscribeConfigChange = (key: 'URL' | 'AutoUpdate', value: any) => {
    if (!config) return;
    setConfig({ ...config, ConfigSubscribtion: { ...config.ConfigSubscribtion, [key]: value } });
  };

  const saveSubscribeConfig = async () => {
    if (!config) return;
    setLoadingSave(true);
    try {
      const res = await fetch('/api/admin/subscribe', { // Assuming an API route for subscribe config
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config.ConfigSubscribtion),
      });
      if (res.ok) {
        alert('保存成功');
        fetchConfig();
      } else {
        const err = await res.json();
        alert(`保存失败: ${err.error}`);
      }
    } catch (error) {
      console.error(error);
      alert('保存失败');
    } finally {
      setLoadingSave(false);
    }
  };


  if (loading) return <div className="p-8 text-center text-gray-500 dark:text-gray-400">加载中...</div>;
  if (!config) return <div className="p-8 text-center text-red-500">加载失败</div>;

  return (
    <div className="container mx-auto p-4 max-w-6xl">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold text-gray-800 dark:text-white">{convert('系统设置')}</h1>
        <div className="space-x-4">
          <Link href="/" className="text-blue-500 hover:underline dark:text-blue-400">{convert('返回首页')}</Link>
          <button
            onClick={() => {
              fetch('/api/auth/logout', { method: 'POST' }).then(() => router.push('/login'));
            }}
            className="text-red-500 hover:underline dark:text-red-400"
          >
            {convert('退出登录')}
          </button>
        </div>
      </div>

      <div className="flex mb-6 border-b dark:border-gray-700 overflow-x-auto">
        {[
          { id: 'base', name: '基本设置' },
          { id: 'users', name: '用户管理' },
          { id: 'sources', name: '源管理' },
          { id: 'live', name: '直播源' },
          { id: 'category', name: '分类管理' },
          { id: 'subscribe', name: '订阅管理' },
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id as any)}
            className={`px-4 py-2 border-b-2 transition-colors whitespace-nowrap ${
              activeTab === tab.id
                ? 'border-blue-500 text-blue-600 font-medium dark:text-blue-400 dark:border-blue-400'
                : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
            }`}
          >
            {convert(tab.name)}
          </button>
        ))}
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6 transition-colors">
        {activeTab === 'base' && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{convert('站点名称')}</label>
                <input
                  type="text"
                  value={config.SiteConfig?.SiteName || ''}
                  onChange={(e) => handleSiteConfigChange('SiteName', e.target.value)}
                  className="w-full border rounded px-3 py-2 outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{convert('接口缓存时间 (秒)')}</label>
                <input
                  type="number"
                  value={config.SiteConfig?.SiteInterfaceCacheTime || 0}
                  onChange={(e) => handleSiteConfigChange('SiteInterfaceCacheTime', Number(e.target.value))}
                  className="w-full border rounded px-3 py-2 outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{convert('搜索最大页数')}</label>
                <input
                  type="number"
                  value={config.SiteConfig?.SearchDownstreamMaxPage || 5}
                  onChange={(e) => handleSiteConfigChange('SearchDownstreamMaxPage', Number(e.target.value))}
                  className="w-full border rounded px-3 py-2 outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                />
              </div>

              <div className="col-span-2">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{convert('站点公告')}</label>
                <textarea
                  value={config.SiteConfig?.Announcement || ''}
                  onChange={(e) => handleSiteConfigChange('Announcement', e.target.value)}
                  className="w-full border rounded px-3 py-2 h-24 outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                />
              </div>

              <div className="col-span-2 border-t dark:border-gray-700 pt-4 mt-2">
                <h3 className="font-medium mb-4 text-gray-800 dark:text-white">{convert('豆瓣代理设置')}</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{convert('接口代理类型')}</label>
                    <select
                      value={config.SiteConfig?.DoubanProxyType || 'direct'}
                      onChange={(e) => handleSiteConfigChange('DoubanProxyType', e.target.value)}
                      className="w-full border rounded px-3 py-2 outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                    >
                      <option value="direct">{convert('直连')}</option>
                      <option value="custom">{convert('自定义代理')}</option>
                      <option value="cors-proxy-zwei">cors-proxy-zwei</option>
                      <option value="cmliussss-cdn-tencent">cmliussss-cdn-tencent</option>
                      <option value="cmliussss-cdn-ali">cmliussss-cdn-ali</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{convert('接口代理地址')}</label>
                    <input
                      type="text"
                      value={config.SiteConfig?.DoubanProxy || ''}
                      onChange={(e) => handleSiteConfigChange('DoubanProxy', e.target.value)}
                      placeholder="例如: https://api.example.com"
                      disabled={config.SiteConfig?.DoubanProxyType !== 'custom'}
                      className="w-full border rounded px-3 py-2 outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100 dark:bg-gray-700 dark:border-gray-600 dark:text-white dark:disabled:bg-gray-800 dark:disabled:text-gray-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{convert('图片代理类型')}</label>
                    <select
                      value={config.SiteConfig?.DoubanImageProxyType || 'cmliussss-cdn-tencent'}
                      onChange={(e) => handleSiteConfigChange('DoubanImageProxyType', e.target.value)}
                      className="w-full border rounded px-3 py-2 outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                    >
                      <option value="direct">{convert('直连')}</option>
                      <option value="cmliussss-cdn-tencent">cmliussss-cdn-tencent</option>
                      <option value="cmliussss-cdn-ali">cmliussss-cdn-ali</option>
                      <option value="custom">{convert('自定义代理')}</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{convert('图片代理地址')}</label>
                    <input
                      type="text"
                      value={config.SiteConfig?.DoubanImageProxy || ''}
                      onChange={(e) => handleSiteConfigChange('DoubanImageProxy', e.target.value)}
                      placeholder="例如: https://img.example.com"
                      disabled={config.SiteConfig?.DoubanImageProxyType !== 'custom'}
                      className="w-full border rounded px-3 py-2 outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100 dark:bg-gray-700 dark:border-gray-600 dark:text-white dark:disabled:bg-gray-800 dark:disabled:text-gray-500"
                    />
                  </div>
                </div>
              </div>

              <div className="col-span-2 border-t dark:border-gray-700 pt-4 mt-2">
                <h3 className="font-medium mb-4 text-gray-800 dark:text-white">{convert('高级设置')}</h3>
                <div className="flex items-center space-x-4">
                  <label className="flex items-center space-x-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={config.SiteConfig?.DisableYellowFilter || false}
                      onChange={(e) => handleSiteConfigChange('DisableYellowFilter', e.target.checked)}
                      className="rounded text-blue-600 focus:ring-blue-500 dark:bg-gray-700 dark:border-gray-600"
                    />
                    <span className="text-sm text-gray-700 dark:text-gray-300">{convert('禁用黄反过滤')}</span>
                  </label>
                  <label className="flex items-center space-x-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={config.SiteConfig?.FluidSearch || false}
                      onChange={(e) => handleSiteConfigChange('FluidSearch', e.target.checked)}
                      className="rounded text-blue-600 focus:ring-blue-500 dark:bg-gray-700 dark:border-gray-600"
                    />
                    <span className="text-sm text-gray-700 dark:text-gray-300">{convert('启用流式搜索')}</span>
                  </label>
                  <label className="flex items-center space-x-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={config.SiteConfig?.DebugLogs || false}
                      onChange={(e) => handleSiteConfigChange('DebugLogs', e.target.checked)}
                      className="rounded text-blue-600 focus:ring-blue-500 dark:bg-gray-700 dark:border-gray-600"
                    />
                    <span className="text-sm text-gray-700 dark:text-gray-300">{convert('启用播放器调试日志')}</span>
                  </label>
                </div>
              </div>

              {/* 季节特效设置 */}
              <div className="col-span-2 border-t dark:border-gray-700 pt-4 mt-2">
                <h3 className="font-medium mb-4 text-gray-800 dark:text-white">{convert('季节特效')} ❄️🌸🍃🍁</h3>
                <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
                  {convert('配置后对所有用户生效，在屏幕上显示季节性飘落效果')}
                </p>
                
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  {/* 开启/关闭 */}
                  <div className="flex items-center">
                    <label className="flex items-center space-x-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={config.SiteConfig?.SeasonalEffects?.enabled || false}
                        onChange={(e) => handleSiteConfigChange('SeasonalEffects', {
                          ...config.SiteConfig?.SeasonalEffects,
                          enabled: e.target.checked,
                          season: config.SiteConfig?.SeasonalEffects?.season || 'auto',
                          intensity: config.SiteConfig?.SeasonalEffects?.intensity || 'normal',
                        })}
                        className="rounded text-blue-600 focus:ring-blue-500 dark:bg-gray-700 dark:border-gray-600"
                      />
                      <span className="text-sm text-gray-700 dark:text-gray-300">{convert('启用季节特效')}</span>
                    </label>
                  </div>

                  {/* 季节选择 */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{convert('季节')}</label>
                    <select
                      value={config.SiteConfig?.SeasonalEffects?.season || 'auto'}
                      onChange={(e) => handleSiteConfigChange('SeasonalEffects', {
                        ...config.SiteConfig?.SeasonalEffects,
                        enabled: config.SiteConfig?.SeasonalEffects?.enabled || false,
                        season: e.target.value,
                        intensity: config.SiteConfig?.SeasonalEffects?.intensity || 'normal',
                      })}
                      disabled={!config.SiteConfig?.SeasonalEffects?.enabled}
                      className="w-full border rounded px-3 py-2 outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white disabled:opacity-50"
                    >
                      <option value="auto">{convert('自动（根据月份）')}</option>
                      <option value="spring">{convert('春季 - 樱花雨 🌸')}</option>
                      <option value="summer">{convert('夏季 - 绿叶雨 🍃')}</option>
                      <option value="autumn">{convert('秋季 - 红枫落叶 🍁')}</option>
                      <option value="winter">{convert('冬季 - 雪花 ❄️')}</option>
                      <option value="off">{convert('关闭效果')}</option>
                    </select>
                  </div>

                  {/* 密度选择 */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{convert('飘落密度')}</label>
                    <div className="flex space-x-2">
                      {[
                        { value: 'light', label: '轻柔' },
                        { value: 'normal', label: '正常' },
                        { value: 'heavy', label: '浓密' },
                      ].map((opt) => (
                        <button
                          key={opt.value}
                          onClick={() => handleSiteConfigChange('SeasonalEffects', {
                            ...config.SiteConfig?.SeasonalEffects,
                            enabled: config.SiteConfig?.SeasonalEffects?.enabled || false,
                            season: config.SiteConfig?.SeasonalEffects?.season || 'auto',
                            intensity: opt.value,
                          })}
                          disabled={!config.SiteConfig?.SeasonalEffects?.enabled}
                          className={`flex-1 px-3 py-2 text-sm rounded border transition-colors ${
                            config.SiteConfig?.SeasonalEffects?.intensity === opt.value
                              ? 'border-blue-500 bg-blue-50 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400'
                              : 'border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'
                          } disabled:opacity-50`}
                        >
                          {convert(opt.label)}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="flex justify-end pt-4">
              <button
                onClick={saveBaseConfig}
                disabled={saving}
                className={`px-6 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:bg-blue-500 dark:hover:bg-blue-600 ${
                  saving ? 'opacity-50 cursor-not-allowed' : ''
                }`}
              >
                {saving ? convert('保存中...') : convert('保存配置')}
              </button>
            </div>
          </div>
        )}

        {activeTab === 'users' && (
          <UserManagement 
            users={config.UserConfig.Users || []} 
            role={role}
            onAction={handleUserAction}
            convert={convert}
          />
        )}

        {activeTab === 'sources' && (
          <SourceManagement 
            sources={config.SourceConfig || []}
            onAction={handleSourceAction}
            convert={convert}
          />
        )}

        {activeTab === 'live' && (
          <LiveManagement 
            lives={config.LiveConfig || []}
            onAction={handleLiveAction}
            onRefresh={refreshLiveChannels}
            convert={convert}
          />
        )}

        {activeTab === 'category' && (
          <CategoryManagement 
            categories={config.CustomCategories || []}
            onAction={handleCategoryAction}
            convert={convert}
          />
        )}

        {activeTab === 'subscribe' && (
          <SubscribeManagement
            configSubscribtion={config.ConfigSubscribtion}
            onConfigChange={handleSubscribeConfigChange}
            onSave={saveSubscribeConfig}
            isSaving={saving}
            convert={convert}
          />
        )}
      </div>
    </div>
  );
}

// --- Sub Components ---

function UserManagement({ users, role, onAction, convert }: { users: User[], role: any, onAction: (a: string, p: any) => void, convert: (s:string)=>string }) {
  const [newUser, setNewUser] = useState({ username: '', password: '', userGroup: '' });
  
  return (
    <div className="space-y-6">
      <div className="border dark:border-gray-700 p-4 rounded bg-gray-50 dark:bg-gray-700/50">
        <h3 className="font-bold mb-4 text-gray-800 dark:text-white">{convert('添加用户')}</h3>
        <div className="flex gap-4">
          <input 
            placeholder={convert('用户名')}
            className="border p-2 rounded dark:bg-gray-700 dark:border-gray-600 dark:text-white" 
            value={newUser.username} 
            onChange={e => setNewUser({...newUser, username: e.target.value})}
          />
          <input 
            placeholder={convert('密码')}
            type="password"
            className="border p-2 rounded dark:bg-gray-700 dark:border-gray-600 dark:text-white" 
            value={newUser.password}
            onChange={e => setNewUser({...newUser, password: e.target.value})}
          />
          <button 
            className="bg-green-500 text-white px-4 py-2 rounded hover:bg-green-600 dark:bg-green-600 dark:hover:bg-green-700"
            onClick={() => {
              onAction('add', { targetUsername: newUser.username, targetPassword: newUser.password });
              setNewUser({ username: '', password: '', userGroup: '' });
            }}
          >{convert('添加')}</button>
        </div>
      </div>

      <table className="min-w-full text-left">
        <thead>
          <tr className="border-b dark:border-gray-700 text-gray-700 dark:text-gray-300">
            <th className="p-2">{convert('用户名')}</th>
            <th className="p-2">{convert('角色')}</th>
            <th className="p-2">{convert('状态')}</th>
            <th className="p-2">{convert('操作')}</th>
          </tr>
        </thead>
        <tbody>
          {users.map((u, i) => (
            <tr key={`${u.username}-${i}`} className="border-b dark:border-gray-700 text-gray-800 dark:text-gray-200">
              <td className="p-2">{u.username}</td>
              <td className="p-2">{u.role === 'owner' ? convert('站长') : u.role === 'admin' ? convert('管理员') : convert('普通用户')}</td>
              <td className="p-2">{u.banned ? convert('已封禁') : convert('正常')}</td>
              <td className="p-2 space-x-2">
                {u.role !== 'owner' && (
                  <>
                    <button 
                      className="text-red-500 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300" 
                      onClick={() => onAction(u.banned ? 'unban' : 'ban', { targetUsername: u.username })}
                    >
                      {u.banned ? convert('解封') : convert('封禁')}
                    </button>
                    {u.role === 'admin' ? (
                       <button className="text-yellow-500 hover:text-yellow-700 dark:text-yellow-400" onClick={() => onAction('cancelAdmin', { targetUsername: u.username })}>{convert('取消管理员')}</button>
                    ) : (
                       <button className="text-blue-500 hover:text-blue-700 dark:text-blue-400" onClick={() => onAction('setAdmin', { targetUsername: u.username })}>{convert('设为管理员')}</button>
                    )}
                    <button className="text-red-700 hover:text-red-900 dark:text-red-500" onClick={() => onAction('deleteUser', { targetUsername: u.username })}>{convert('删除')}</button>
                  </>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SourceManagement({ sources, onAction, convert }: { sources: ApiSite[], onAction: (a: string, p: any) => void, convert: (s:string)=>string }) {
  const [newSource, setNewSource] = useState({ key: '', name: '', api: '' });

  return (
    <div className="space-y-6">
      <div className="border dark:border-gray-700 p-4 rounded bg-gray-50 dark:bg-gray-700/50">
        <h3 className="font-bold mb-4 text-gray-800 dark:text-white">{convert('添加采集源')}</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <input placeholder={convert('Key (唯一标识)')} className="border p-2 rounded dark:bg-gray-700 dark:border-gray-600 dark:text-white" value={newSource.key} onChange={e => setNewSource({...newSource, key: e.target.value})} />
          <input placeholder={convert('名称')} className="border p-2 rounded dark:bg-gray-700 dark:border-gray-600 dark:text-white" value={newSource.name} onChange={e => setNewSource({...newSource, name: e.target.value})} />
          <input placeholder={convert('API 地址')} className="border p-2 rounded dark:bg-gray-700 dark:border-gray-600 dark:text-white" value={newSource.api} onChange={e => setNewSource({...newSource, api: e.target.value})} />
        </div>
        <button className="mt-4 bg-green-500 text-white px-4 py-2 rounded hover:bg-green-600 dark:bg-green-600" onClick={() => onAction('add', newSource)}>{convert('添加')}</button>
      </div>

      <table className="min-w-full text-left">
        <thead>
          <tr className="border-b dark:border-gray-700 text-gray-700 dark:text-gray-300">
            <th className="p-2">{convert('名称')}</th>
            <th className="p-2">{convert('API')}</th>
            <th className="p-2">{convert('状态')}</th>
            <th className="p-2">{convert('操作')}</th>
          </tr>
        </thead>
        <tbody>
          {sources.map(s => (
            <tr key={s.key} className="border-b dark:border-gray-700 text-gray-800 dark:text-gray-200">
              <td className="p-2">{s.name}</td>
              <td className="p-2 truncate max-w-xs">{s.api}</td>
              <td className="p-2">{s.disabled ? convert('禁用') : convert('启用')}</td>
              <td className="p-2 space-x-2">
                <button className="text-blue-500 hover:text-blue-700 dark:text-blue-400" onClick={() => onAction(s.disabled ? 'enable' : 'disable', { key: s.key })}>
                  {s.disabled ? convert('启用') : convert('禁用')}
                </button>
                {s.from === 'custom' && (
                  <button className="text-red-500 hover:text-red-700 dark:text-red-400" onClick={() => onAction('delete', { key: s.key })}>{convert('删除')}</button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function LiveManagement({ lives, onAction, onRefresh, convert }: { lives: LiveCfg[], onAction: (a: string, p: any) => void, onRefresh: () => void, convert: (s:string)=>string }) {
  const [newLive, setNewLive] = useState({ key: '', name: '', url: '' });

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
         <h3 className="font-bold text-gray-800 dark:text-white">{convert('直播源列表')}</h3>
         <button className="bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600 dark:bg-blue-600" onClick={onRefresh}>{convert('刷新频道数')}</button>
      </div>
      
      <div className="border dark:border-gray-700 p-4 rounded bg-gray-50 dark:bg-gray-700/50">
        <h3 className="font-bold mb-4 text-gray-800 dark:text-white">{convert('添加直播源')}</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <input placeholder={convert("Key")} className="border p-2 rounded dark:bg-gray-700 dark:border-gray-600 dark:text-white" value={newLive.key} onChange={e => setNewLive({...newLive, key: e.target.value})} />
          <input placeholder={convert("名称")} className="border p-2 rounded dark:bg-gray-700 dark:border-gray-600 dark:text-white" value={newLive.name} onChange={e => setNewLive({...newLive, name: e.target.value})} />
          <input placeholder={convert("M3U8 URL")} className="border p-2 rounded dark:bg-gray-700 dark:border-gray-600 dark:text-white" value={newLive.url} onChange={e => setNewLive({...newLive, url: e.target.value})} />
        </div>
        <button className="mt-4 bg-green-500 text-white px-4 py-2 rounded hover:bg-green-600 dark:bg-green-600" onClick={() => onAction('add', newLive)}>{convert('添加')}</button>
      </div>

      <table className="min-w-full text-left">
        <thead>
          <tr className="border-b dark:border-gray-700 text-gray-700 dark:text-gray-300">
            <th className="p-2">{convert('名称')}</th>
            <th className="p-2">{convert('频道数')}</th>
            <th className="p-2">{convert('状态')}</th>
            <th className="p-2">{convert('操作')}</th>
          </tr>
        </thead>
        <tbody>
          {lives.map(l => (
            <tr key={l.key} className="border-b dark:border-gray-700 text-gray-800 dark:text-gray-200">
              <td className="p-2">{l.name}</td>
              <td className="p-2">{l.channelNumber}</td>
              <td className="p-2">{l.disabled ? convert('禁用') : convert('启用')}</td>
              <td className="p-2 space-x-2">
                <button className="text-blue-500 hover:text-blue-700 dark:text-blue-400" onClick={() => onAction(l.disabled ? 'enable' : 'disable', { key: l.key })}>
                  {l.disabled ? convert('启用') : convert('禁用')}
                </button>
                {l.from === 'custom' && (
                  <button className="text-red-500 hover:text-red-700 dark:text-red-400" onClick={() => onAction('delete', { key: l.key })}>{convert('删除')}</button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CategoryManagement({ categories, onAction, convert }: { categories: CustomCategory[], onAction: (a: string, p: any) => void, convert: (s:string)=>string }) {
  const [newCat, setNewCat] = useState({ name: '', type: 'movie', query: '' });

  return (
    <div className="space-y-6">
      <div className="border dark:border-gray-700 p-4 rounded bg-gray-50 dark:bg-gray-700/50">
        <h3 className="font-bold mb-4 text-gray-800 dark:text-white">{convert('添加分类')}</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <input placeholder={convert('名称')} className="border p-2 rounded dark:bg-gray-700 dark:border-gray-600 dark:text-white" value={newCat.name} onChange={e => setNewCat({...newCat, name: e.target.value})} />
          <select className="border p-2 rounded dark:bg-gray-700 dark:border-gray-600 dark:text-white" value={newCat.type} onChange={e => setNewCat({...newCat, type: e.target.value as any})}>
            <option value="movie">{convert('电影')}</option>
            <option value="tv">{convert('剧集')}</option>
          </select>
          <input placeholder={convert('查询关键词')} className="border p-2 rounded dark:bg-gray-700 dark:border-gray-600 dark:text-white" value={newCat.query} onChange={e => setNewCat({...newCat, query: e.target.value})} />
        </div>
        <button className="mt-4 bg-green-500 text-white px-4 py-2 rounded hover:bg-green-600 dark:bg-green-600" onClick={() => onAction('add', newCat)}>{convert('添加')}</button>
      </div>

      <table className="min-w-full text-left">
        <thead>
          <tr className="border-b dark:border-gray-700 text-gray-700 dark:text-gray-300">
            <th className="p-2">{convert('名称')}</th>
            <th className="p-2">{convert('类型')}</th>
            <th className="p-2">{convert('查询词')}</th>
            <th className="p-2">{convert('操作')}</th>
          </tr>
        </thead>
        <tbody>
          {categories.map((c, i) => (
            <tr key={`${c.query}-${i}`} className="border-b dark:border-gray-700 text-gray-800 dark:text-gray-200">
              <td className="p-2">{c.name}</td>
              <td className="p-2">{c.type === 'movie' ? convert('电影') : convert('剧集')}</td>
              <td className="p-2">{c.query}</td>
              <td className="p-2">
                {c.from === 'custom' && (
                  <button className="text-red-500 hover:text-red-700 dark:text-red-400" onClick={() => onAction('delete', { query: c.query, type: c.type })}>{convert('删除')}</button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SubscribeManagement({ configSubscribtion, onConfigChange, onSave, isSaving, convert }: { 
  configSubscribtion: AdminConfig['ConfigSubscribtion'], 
  onConfigChange: (key: 'URL' | 'AutoUpdate', value: any) => void,
  onSave: () => void,
  isSaving: boolean,
  convert: (s:string)=>string
}) {
  return (
    <div className="space-y-6">
      <h3 className="text-xl font-bold mb-4 text-gray-800 dark:text-white">{convert('订阅管理')}</h3>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{convert('订阅 URL')}</label>
          <input
            type="text"
            value={configSubscribtion?.URL || ''}
            onChange={(e) => onConfigChange('URL', e.target.value)}
            className="w-full border rounded px-3 py-2 outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white"
            placeholder={convert('例如: https://example.com/config.json')}
          />
        </div>
        <div className="flex items-center mt-4 md:mt-0">
          <input
            type="checkbox"
            checked={configSubscribtion?.AutoUpdate || false}
            onChange={(e) => onConfigChange('AutoUpdate', e.target.checked)}
            className="rounded text-blue-600 focus:ring-blue-500 dark:bg-gray-700 dark:border-gray-600"
            id="autoUpdate"
          />
          <label htmlFor="autoUpdate" className="ml-2 text-sm font-medium text-gray-700 dark:text-gray-300">{convert('自动更新')}</label>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{convert('上次检查时间')}</label>
          <input
            type="text"
            value={configSubscribtion?.LastCheck || 'N/A'}
            className="w-full border rounded px-3 py-2 bg-gray-100 dark:bg-gray-800 outline-none dark:text-gray-400"
            readOnly
          />
        </div>
      </div>
      <div className="flex justify-end pt-4">
        <button
          onClick={onSave}
          disabled={isSaving}
          className={`px-6 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:bg-blue-500 dark:hover:bg-blue-600 ${
            isSaving ? 'opacity-50 cursor-not-allowed' : ''
          }`}
        >
          {isSaving ? convert('保存中...') : convert('保存配置')}
        </button>
      </div>
    </div>
  );
}
