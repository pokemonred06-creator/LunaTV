'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { AdminConfig, SiteConfig, User, ApiSite, LiveCfg, CustomCategory } from '@/lib/admin.types';

export default function AdminPage() {
  const router = useRouter();
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
        alert('保存失败');
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
        alert('刷新失败');
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

  if (loading) return <div className="p-8 text-center">加载中...</div>;
  if (!config) return <div className="p-8 text-center">加载失败</div>;

  return (
    <div className="container mx-auto p-4 max-w-6xl">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold">系统设置</h1>
        <div className="space-x-4">
          <Link href="/" className="text-blue-500 hover:underline">返回首页</Link>
          <button
            onClick={() => {
              fetch('/api/auth/logout', { method: 'POST' }).then(() => router.push('/login'));
            }}
            className="text-red-500 hover:underline"
          >
            退出登录
          </button>
        </div>
      </div>

      <div className="flex mb-6 border-b overflow-x-auto">
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
                ? 'border-blue-500 text-blue-600 font-medium'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {tab.name}
          </button>
        ))}
      </div>

      <div className="bg-white rounded-lg shadow p-6">
        {activeTab === 'base' && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">站点名称</label>
                <input
                  type="text"
                  value={config.SiteConfig?.SiteName || ''}
                  onChange={(e) => handleSiteConfigChange('SiteName', e.target.value)}
                  className="w-full border rounded px-3 py-2 outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">接口缓存时间 (秒)</label>
                <input
                  type="number"
                  value={config.SiteConfig?.SiteInterfaceCacheTime || 0}
                  onChange={(e) => handleSiteConfigChange('SiteInterfaceCacheTime', Number(e.target.value))}
                  className="w-full border rounded px-3 py-2 outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">搜索最大页数</label>
                <input
                  type="number"
                  value={config.SiteConfig?.SearchDownstreamMaxPage || 5}
                  onChange={(e) => handleSiteConfigChange('SearchDownstreamMaxPage', Number(e.target.value))}
                  className="w-full border rounded px-3 py-2 outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div className="col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-1">站点公告</label>
                <textarea
                  value={config.SiteConfig?.Announcement || ''}
                  onChange={(e) => handleSiteConfigChange('Announcement', e.target.value)}
                  className="w-full border rounded px-3 py-2 h-24 outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div className="col-span-2 border-t pt-4 mt-2">
                <h3 className="font-medium mb-4">豆瓣代理设置</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">接口代理类型</label>
                    <select
                      value={config.SiteConfig?.DoubanProxyType || 'direct'}
                      onChange={(e) => handleSiteConfigChange('DoubanProxyType', e.target.value)}
                      className="w-full border rounded px-3 py-2 outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="direct">直连</option>
                      <option value="custom">自定义代理</option>
                      <option value="cmliussss-cdn-tencent">cmliussss-cdn-tencent</option>
                      <option value="cmliussss-cdn-ali">cmliussss-cdn-ali</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">接口代理地址</label>
                    <input
                      type="text"
                      value={config.SiteConfig?.DoubanProxy || ''}
                      onChange={(e) => handleSiteConfigChange('DoubanProxy', e.target.value)}
                      placeholder="例如: https://api.example.com"
                      disabled={config.SiteConfig?.DoubanProxyType !== 'custom'}
                      className="w-full border rounded px-3 py-2 outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">图片代理类型</label>
                    <select
                      value={config.SiteConfig?.DoubanImageProxyType || 'cmliussss-cdn-tencent'}
                      onChange={(e) => handleSiteConfigChange('DoubanImageProxyType', e.target.value)}
                      className="w-full border rounded px-3 py-2 outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="direct">直连</option>
                      <option value="cmliussss-cdn-tencent">cmliussss-cdn-tencent</option>
                      <option value="custom">自定义代理</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">图片代理地址</label>
                    <input
                      type="text"
                      value={config.SiteConfig?.DoubanImageProxy || ''}
                      onChange={(e) => handleSiteConfigChange('DoubanImageProxy', e.target.value)}
                      placeholder="例如: https://img.example.com"
                      disabled={config.SiteConfig?.DoubanImageProxyType !== 'custom'}
                      className="w-full border rounded px-3 py-2 outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100"
                    />
                  </div>
                </div>
              </div>

              <div className="col-span-2 border-t pt-4 mt-2">
                <h3 className="font-medium mb-4">高级设置</h3>
                <div className="flex items-center space-x-4">
                  <label className="flex items-center space-x-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={config.SiteConfig?.DisableYellowFilter || false}
                      onChange={(e) => handleSiteConfigChange('DisableYellowFilter', e.target.checked)}
                      className="rounded text-blue-600 focus:ring-blue-500"
                    />
                    <span className="text-sm text-gray-700">禁用黄反过滤</span>
                  </label>
                  <label className="flex items-center space-x-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={config.SiteConfig?.FluidSearch || false}
                      onChange={(e) => handleSiteConfigChange('FluidSearch', e.target.checked)}
                      className="rounded text-blue-600 focus:ring-blue-500"
                    />
                    <span className="text-sm text-gray-700">启用流式搜索</span>
                  </label>
                </div>
              </div>
            </div>

            <div className="flex justify-end pt-4">
              <button
                onClick={saveBaseConfig}
                disabled={saving}
                className={`px-6 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 ${
                  saving ? 'opacity-50 cursor-not-allowed' : ''
                }`}
              >
                {saving ? '保存中...' : '保存配置'}
              </button>
            </div>
          </div>
        )}

        {activeTab === 'users' && (
          <UserManagement 
            users={config.UserConfig.Users || []} 
            role={role}
            onAction={handleUserAction}
          />
        )}

        {activeTab === 'sources' && (
          <SourceManagement 
            sources={config.SourceConfig || []}
            onAction={handleSourceAction}
          />
        )}

        {activeTab === 'live' && (
          <LiveManagement 
            lives={config.LiveConfig || []}
            onAction={handleLiveAction}
            onRefresh={refreshLiveChannels}
          />
        )}

        {activeTab === 'category' && (
          <CategoryManagement 
            categories={config.CustomCategories || []}
            onAction={handleCategoryAction}
          />
        )}

        {activeTab === 'subscribe' && (
           <div className="text-gray-500">订阅管理功能开发中... (ConfigSubscribtion URL: {config.ConfigSubscribtion?.URL})</div>
        )}
      </div>
    </div>
  );
}

// --- Sub Components ---

function UserManagement({ users, role, onAction }: { users: User[], role: any, onAction: (a: string, p: any) => void }) {
  const [newUser, setNewUser] = useState({ username: '', password: '', userGroup: '' });
  
  return (
    <div className="space-y-6">
      <div className="border p-4 rounded">
        <h3 className="font-bold mb-4">添加用户</h3>
        <div className="flex gap-4">
          <input 
            placeholder="用户名" 
            className="border p-2 rounded" 
            value={newUser.username} 
            onChange={e => setNewUser({...newUser, username: e.target.value})}
          />
          <input 
            placeholder="密码" 
            type="password"
            className="border p-2 rounded" 
            value={newUser.password}
            onChange={e => setNewUser({...newUser, password: e.target.value})}
          />
          <button 
            className="bg-green-500 text-white px-4 py-2 rounded"
            onClick={() => {
              onAction('add', { targetUsername: newUser.username, targetPassword: newUser.password });
              setNewUser({ username: '', password: '', userGroup: '' });
            }}
          >添加</button>
        </div>
      </div>

      <table className="min-w-full text-left">
        <thead>
          <tr className="border-b">
            <th className="p-2">用户名</th>
            <th className="p-2">角色</th>
            <th className="p-2">状态</th>
            <th className="p-2">操作</th>
          </tr>
        </thead>
        <tbody>
          {users.map(u => (
            <tr key={u.username} className="border-b">
              <td className="p-2">{u.username}</td>
              <td className="p-2">{u.role === 'owner' ? '站长' : u.role === 'admin' ? '管理员' : '普通用户'}</td>
              <td className="p-2">{u.banned ? '已封禁' : '正常'}</td>
              <td className="p-2 space-x-2">
                {u.role !== 'owner' && (
                  <>
                    <button 
                      className="text-red-500" 
                      onClick={() => onAction(u.banned ? 'unban' : 'ban', { targetUsername: u.username })}
                    >
                      {u.banned ? '解封' : '封禁'}
                    </button>
                    {u.role === 'admin' ? (
                       <button className="text-yellow-500" onClick={() => onAction('cancelAdmin', { targetUsername: u.username })}>取消管理员</button>
                    ) : (
                       <button className="text-blue-500" onClick={() => onAction('setAdmin', { targetUsername: u.username })}>设为管理员</button>
                    )}
                    <button className="text-red-700" onClick={() => onAction('deleteUser', { targetUsername: u.username })}>删除</button>
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

function SourceManagement({ sources, onAction }: { sources: ApiSite[], onAction: (a: string, p: any) => void }) {
  const [newSource, setNewSource] = useState({ key: '', name: '', api: '' });

  return (
    <div className="space-y-6">
      <div className="border p-4 rounded">
        <h3 className="font-bold mb-4">添加采集源</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <input placeholder="Key (唯一标识)" className="border p-2 rounded" value={newSource.key} onChange={e => setNewSource({...newSource, key: e.target.value})} />
          <input placeholder="名称" className="border p-2 rounded" value={newSource.name} onChange={e => setNewSource({...newSource, name: e.target.value})} />
          <input placeholder="API 地址" className="border p-2 rounded" value={newSource.api} onChange={e => setNewSource({...newSource, api: e.target.value})} />
        </div>
        <button className="mt-4 bg-green-500 text-white px-4 py-2 rounded" onClick={() => onAction('add', newSource)}>添加</button>
      </div>

      <table className="min-w-full text-left">
        <thead>
          <tr className="border-b">
            <th className="p-2">名称</th>
            <th className="p-2">API</th>
            <th className="p-2">状态</th>
            <th className="p-2">操作</th>
          </tr>
        </thead>
        <tbody>
          {sources.map(s => (
            <tr key={s.key} className="border-b">
              <td className="p-2">{s.name}</td>
              <td className="p-2 truncate max-w-xs">{s.api}</td>
              <td className="p-2">{s.disabled ? '禁用' : '启用'}</td>
              <td className="p-2 space-x-2">
                <button className="text-blue-500" onClick={() => onAction(s.disabled ? 'enable' : 'disable', { key: s.key })}>
                  {s.disabled ? '启用' : '禁用'}
                </button>
                {s.from === 'custom' && (
                  <button className="text-red-500" onClick={() => onAction('delete', { key: s.key })}>删除</button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function LiveManagement({ lives, onAction, onRefresh }: { lives: LiveCfg[], onAction: (a: string, p: any) => void, onRefresh: () => void }) {
  const [newLive, setNewLive] = useState({ key: '', name: '', url: '' });

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
         <h3 className="font-bold">直播源列表</h3>
         <button className="bg-blue-500 text-white px-4 py-2 rounded" onClick={onRefresh}>刷新频道数</button>
      </div>
      
      <div className="border p-4 rounded">
        <h3 className="font-bold mb-4">添加直播源</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <input placeholder="Key" className="border p-2 rounded" value={newLive.key} onChange={e => setNewLive({...newLive, key: e.target.value})} />
          <input placeholder="名称" className="border p-2 rounded" value={newLive.name} onChange={e => setNewLive({...newLive, name: e.target.value})} />
          <input placeholder="M3U8 URL" className="border p-2 rounded" value={newLive.url} onChange={e => setNewLive({...newLive, url: e.target.value})} />
        </div>
        <button className="mt-4 bg-green-500 text-white px-4 py-2 rounded" onClick={() => onAction('add', newLive)}>添加</button>
      </div>

      <table className="min-w-full text-left">
        <thead>
          <tr className="border-b">
            <th className="p-2">名称</th>
            <th className="p-2">频道数</th>
            <th className="p-2">状态</th>
            <th className="p-2">操作</th>
          </tr>
        </thead>
        <tbody>
          {lives.map(l => (
            <tr key={l.key} className="border-b">
              <td className="p-2">{l.name}</td>
              <td className="p-2">{l.channelNumber}</td>
              <td className="p-2">{l.disabled ? '禁用' : '启用'}</td>
              <td className="p-2 space-x-2">
                <button className="text-blue-500" onClick={() => onAction(l.disabled ? 'enable' : 'disable', { key: l.key })}>
                  {l.disabled ? '启用' : '禁用'}
                </button>
                {l.from === 'custom' && (
                  <button className="text-red-500" onClick={() => onAction('delete', { key: l.key })}>删除</button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CategoryManagement({ categories, onAction }: { categories: CustomCategory[], onAction: (a: string, p: any) => void }) {
  const [newCat, setNewCat] = useState({ name: '', type: 'movie', query: '' });

  return (
    <div className="space-y-6">
      <div className="border p-4 rounded">
        <h3 className="font-bold mb-4">添加分类</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <input placeholder="名称" className="border p-2 rounded" value={newCat.name} onChange={e => setNewCat({...newCat, name: e.target.value})} />
          <select className="border p-2 rounded" value={newCat.type} onChange={e => setNewCat({...newCat, type: e.target.value as any})}>
            <option value="movie">电影</option>
            <option value="tv">剧集</option>
          </select>
          <input placeholder="查询关键词" className="border p-2 rounded" value={newCat.query} onChange={e => setNewCat({...newCat, query: e.target.value})} />
        </div>
        <button className="mt-4 bg-green-500 text-white px-4 py-2 rounded" onClick={() => onAction('add', newCat)}>添加</button>
      </div>

      <table className="min-w-full text-left">
        <thead>
          <tr className="border-b">
            <th className="p-2">名称</th>
            <th className="p-2">类型</th>
            <th className="p-2">查询词</th>
            <th className="p-2">操作</th>
          </tr>
        </thead>
        <tbody>
          {categories.map((c, i) => (
            <tr key={`${c.query}-${i}`} className="border-b">
              <td className="p-2">{c.name}</td>
              <td className="p-2">{c.type === 'movie' ? '电影' : '剧集'}</td>
              <td className="p-2">{c.query}</td>
              <td className="p-2">
                {c.from === 'custom' && (
                  <button className="text-red-500" onClick={() => onAction('delete', { query: c.query, type: c.type })}>删除</button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
