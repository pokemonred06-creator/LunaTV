'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { AdminConfig, SiteConfig } from '@/lib/admin.types';

export default function AdminPage() {
  const router = useRouter();
  const [config, setConfig] = useState<AdminConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setLoadingSave] = useState(false);
  const [activeTab, setActiveTab] = useState<'base' | 'users' | 'sources' | 'live' | 'category' | 'subscribe'>('base');

  useEffect(() => {
    fetchConfig();
  }, []);

  const fetchConfig = async () => {
    try {
      const res = await fetch('/api/admin/config');
      if (res.status === 401) {
        router.push('/login');
        return;
      }
      const data = await res.json();
      setConfig(data);
    } catch (error) {
      console.error('获取配置失败', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSiteConfigChange = (key: keyof SiteConfig, value: any) => {
    if (!config) return;
    setConfig({
      ...config,
      SiteConfig: {
        ...config.SiteConfig,
        [key]: value,
      },
    });
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
      console.error('保存失败', error);
      alert('保存失败');
    } finally {
      setLoadingSave(false);
    }
  };

  if (loading) return <div className="p-8 text-center">加载中...</div>;
  if (!config) return <div className="p-8 text-center">加载失败</div>;

  return (
    <div className="container mx-auto p-4 max-w-6xl">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold">系统设置</h1>
        <div className="space-x-4">
          <Link href="/" className="text-blue-500 hover:underline">
            返回首页
          </Link>
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

      <div className="flex mb-6 border-b">
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
            className={`px-4 py-2 border-b-2 transition-colors ${
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
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  站点名称
                </label>
                <input
                  type="text"
                  value={config.SiteConfig.SiteName}
                  onChange={(e) => handleSiteConfigChange('SiteName', e.target.value)}
                  className="w-full border rounded px-3 py-2 focus:ring-2 focus:ring-blue-500 outline-none"
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  接口缓存时间 (秒)
                </label>
                <input
                  type="number"
                  value={config.SiteConfig.SiteInterfaceCacheTime}
                  onChange={(e) => handleSiteConfigChange('SiteInterfaceCacheTime', Number(e.target.value))}
                  className="w-full border rounded px-3 py-2 focus:ring-2 focus:ring-blue-500 outline-none"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  搜索最大页数
                </label>
                <input
                  type="number"
                  value={config.SiteConfig.SearchDownstreamMaxPage}
                  onChange={(e) => handleSiteConfigChange('SearchDownstreamMaxPage', Number(e.target.value))}
                  className="w-full border rounded px-3 py-2 focus:ring-2 focus:ring-blue-500 outline-none"
                />
              </div>

              <div className="col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  站点公告
                </label>
                <textarea
                  value={config.SiteConfig.Announcement}
                  onChange={(e) => handleSiteConfigChange('Announcement', e.target.value)}
                  className="w-full border rounded px-3 py-2 h-24 focus:ring-2 focus:ring-blue-500 outline-none"
                />
              </div>

              <div className="col-span-2 border-t pt-4 mt-2">
                <h3 className="font-medium mb-4">豆瓣代理设置</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      接口代理类型
                    </label>
                    <select
                      value={config.SiteConfig.DoubanProxyType}
                      onChange={(e) => handleSiteConfigChange('DoubanProxyType', e.target.value)}
                      className="w-full border rounded px-3 py-2 focus:ring-2 focus:ring-blue-500 outline-none"
                    >
                      <option value="direct">直连</option>
                      <option value="custom">自定义代理</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      接口代理地址
                    </label>
                    <input
                      type="text"
                      value={config.SiteConfig.DoubanProxy}
                      onChange={(e) => handleSiteConfigChange('DoubanProxy', e.target.value)}
                      placeholder="例如: https://api.example.com"
                      disabled={config.SiteConfig.DoubanProxyType !== 'custom'}
                      className="w-full border rounded px-3 py-2 focus:ring-2 focus:ring-blue-500 outline-none disabled:bg-gray-100"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      图片代理类型
                    </label>
                    <select
                      value={config.SiteConfig.DoubanImageProxyType}
                      onChange={(e) => handleSiteConfigChange('DoubanImageProxyType', e.target.value)}
                      className="w-full border rounded px-3 py-2 focus:ring-2 focus:ring-blue-500 outline-none"
                    >
                      <option value="direct">直连</option>
                      <option value="cmliussss-cdn-tencent">cmliussss-cdn-tencent</option>
                      <option value="custom">自定义代理</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      图片代理地址
                    </label>
                    <input
                      type="text"
                      value={config.SiteConfig.DoubanImageProxy}
                      onChange={(e) => handleSiteConfigChange('DoubanImageProxy', e.target.value)}
                      placeholder="例如: https://img.example.com"
                      disabled={config.SiteConfig.DoubanImageProxyType !== 'custom'}
                      className="w-full border rounded px-3 py-2 focus:ring-2 focus:ring-blue-500 outline-none disabled:bg-gray-100"
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
                      checked={config.SiteConfig.DisableYellowFilter}
                      onChange={(e) => handleSiteConfigChange('DisableYellowFilter', e.target.checked)}
                      className="rounded text-blue-600 focus:ring-blue-500"
                    />
                    <span className="text-sm text-gray-700">禁用黄反过滤</span>
                  </label>
                  <label className="flex items-center space-x-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={config.SiteConfig.FluidSearch}
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

        {/* 其他 Tab 内容可以使用组件引入，这里省略以保持简洁 */}
        {activeTab === 'users' && <div className="text-center text-gray-500">请使用专门的用户管理组件</div>}
        {activeTab === 'sources' && <div className="text-center text-gray-500">请使用专门的源管理组件</div>}
        {activeTab === 'live' && <div className="text-center text-gray-500">请使用专门的直播源管理组件</div>}
        {activeTab === 'category' && <div className="text-center text-gray-500">请使用专门的分类管理组件</div>}
        {activeTab === 'subscribe' && <div className="text-center text-gray-500">请使用专门的订阅管理组件</div>}
      </div>
    </div>
  );
}