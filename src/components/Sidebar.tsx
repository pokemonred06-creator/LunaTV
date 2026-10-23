/* eslint-disable @typescript-eslint/no-explicit-any */

'use client';

import {
  Cat,
  Clapperboard,
  Home,
  Menu,
  Mic,
  Radio,
  Search,
  Star,
  Tv,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useState,
} from 'react';

import { useLanguage } from './LanguageProvider';
import { useSite } from './SiteProvider';

interface SidebarContextType {
  isCollapsed: boolean;
}

const SidebarContext = createContext<SidebarContextType>({
  isCollapsed: false,
});

export const useSidebar = () => useContext(SidebarContext);

// 可替换为你自己的 logo 图片
const Logo = () => {
  const { siteName } = useSite();
  const initial = siteName ? siteName.charAt(0).toUpperCase() : 'L';
  return (
    <Link
      href='/'
      className='flex items-center gap-2 select-none hover:opacity-90 transition-opacity duration-200'
    >
      <div className='w-8 h-8 rounded-lg bg-gradient-to-br from-brand-500 to-emerald-500 flex items-center justify-center shadow-lg shadow-brand-500/25'>
        <span className='text-white text-base font-black'>{initial}</span>
      </div>
      <span className='text-xl font-black bg-gradient-to-r from-brand-600 to-emerald-500 dark:from-brand-400 dark:to-emerald-300 bg-clip-text text-transparent tracking-tight'>
        {siteName}
      </span>
    </Link>
  );
};

interface SidebarProps {
  onToggle?: (collapsed: boolean) => void;
  activePath?: string;
}

// 在浏览器环境下通过全局变量缓存折叠状态，避免组件重新挂载时出现初始值闪烁
declare global {
  interface Window {
    __sidebarCollapsed?: boolean;
  }
}

const Sidebar = ({ onToggle, activePath = '/' }: SidebarProps) => {
  const router = useRouter();
  const { convert } = useLanguage();
  const { siteName } = useSite();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  // 若同一次 SPA 会话中已经读取过折叠状态，则直接复用，避免闪烁
  const [isCollapsed, setIsCollapsed] = useState<boolean>(() => {
    if (
      typeof window !== 'undefined' &&
      typeof window.__sidebarCollapsed === 'boolean'
    ) {
      return window.__sidebarCollapsed;
    }
    return false; // 默认展开
  });

  // 首次挂载时读取 localStorage，以便刷新后仍保持上次的折叠状态
  useLayoutEffect(() => {
    const saved = localStorage.getItem('sidebarCollapsed');
    if (saved !== null) {
      const val = JSON.parse(saved);
      setIsCollapsed(val);
      window.__sidebarCollapsed = val;
    }
  }, []);

  // 当折叠状态变化时，同步到 <html> data 属性，供首屏 CSS 使用
  useLayoutEffect(() => {
    if (typeof document !== 'undefined') {
      if (isCollapsed) {
        document.documentElement.dataset.sidebarCollapsed = 'true';
      } else {
        delete document.documentElement.dataset.sidebarCollapsed;
      }
    }
  }, [isCollapsed]);

  const [active, setActive] = useState(activePath);

  useEffect(() => {
    // 优先使用传入 of activePath
    if (activePath) {
      setActive(activePath);
    } else {
      // 否则使用当前路径
      const getCurrentFullPath = () => {
        const queryString = searchParams.toString();
        return queryString ? `${pathname}?${queryString}` : pathname;
      };
      const fullPath = getCurrentFullPath();
      setActive(fullPath);
    }
  }, [activePath, pathname, searchParams]);

  const handleToggle = useCallback(() => {
    const newState = !isCollapsed;
    setIsCollapsed(newState);
    localStorage.setItem('sidebarCollapsed', JSON.stringify(newState));
    if (typeof window !== 'undefined') {
      window.__sidebarCollapsed = newState;
    }
    onToggle?.(newState);
  }, [isCollapsed, onToggle]);

  const handleSearchClick = useCallback(() => {
    router.push('/search');
  }, [router]);

  const contextValue = {
    isCollapsed,
  };

  const [menuItems, setMenuItems] = useState([
    {
      icon: Clapperboard,
      label: '电影',
      href: '/douban?type=movie',
    },
    {
      icon: Tv,
      label: '剧集',
      href: '/douban?type=tv',
    },
    {
      icon: Cat,
      label: '动漫',
      href: '/douban?type=anime',
    },
    {
      icon: Mic,
      label: '综艺',
      href: '/douban?type=show',
    },
    {
      icon: Radio,
      label: '直播',
      href: '/live',
    },
  ]);

  useEffect(() => {
    const runtimeConfig = (window as any).RUNTIME_CONFIG;
    if (runtimeConfig?.CUSTOM_CATEGORIES?.length > 0) {
      setMenuItems((prevItems) => [
        ...prevItems,
        {
          icon: Star,
          label: '自定义',
          href: '/douban?type=custom',
        },
      ]);
    }
  }, []);

  return (
    <SidebarContext.Provider value={contextValue}>
      {/* 在移动端隐藏侧边栏 */}
      <div className='hidden md:flex'>
        <aside
          data-sidebar
          className={`fixed top-0 left-0 h-screen transition-all duration-300 z-10 shadow-xl border-r ${
            isCollapsed
              ? 'w-16 bg-white/70 dark:bg-slate-950/70 border-gray-200/50 dark:border-gray-800/50'
              : 'w-64 bg-white/50 dark:bg-slate-950/50 border-gray-200/30 dark:border-gray-800/30'
          }`}
          style={{
            backdropFilter: 'blur(24px)',
            WebkitBackdropFilter: 'blur(24px)',
          }}
        >
          <div className='flex h-full flex-col'>
            {/* 顶部 Logo 区域 */}
            <div className='relative h-16 flex items-center px-4 justify-between'>
              <div
                className={`flex items-center transition-all duration-300 ${
                  isCollapsed
                    ? 'opacity-0 scale-90 w-0 overflow-hidden'
                    : 'opacity-100 scale-100 w-auto'
                }`}
              >
                {!isCollapsed && <Logo />}
              </div>
              {isCollapsed && (
                <div className='absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 flex flex-col items-center gap-1.5'>
                  <Link
                    href='/'
                    className='w-8 h-8 rounded-lg bg-gradient-to-br from-brand-500 to-emerald-500 flex items-center justify-center shadow-lg shadow-brand-500/25 hover:scale-105 transition-transform duration-200'
                  >
                    <span className='text-white text-base font-black'>
                      {siteName?.charAt(0)?.toUpperCase() ?? 'L'}
                    </span>
                  </Link>
                  <button
                    onClick={handleToggle}
                    className='flex items-center justify-center w-7 h-7 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100/50 transition-colors duration-200 dark:text-gray-500 dark:hover:text-gray-300 dark:hover:bg-gray-800/50'
                  >
                    <Menu className='h-3.5 w-3.5' />
                  </button>
                </div>
              )}
              {!isCollapsed && (
                <button
                  onClick={handleToggle}
                  className='flex items-center justify-center w-8 h-8 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100/50 transition-colors duration-200 dark:text-gray-500 dark:hover:text-gray-300 dark:hover:bg-gray-800/50'
                >
                  <Menu className='h-4 w-4' />
                </button>
              )}
            </div>

            {/* 首页和搜索导航 */}
            <nav className='px-2 mt-4 space-y-1.5 relative'>
              <Link
                href='/'
                onClick={() => setActive('/')}
                data-active={active === '/'}
                className={`group relative flex items-center rounded-xl px-3 py-2 text-gray-650 dark:text-gray-350 hover:text-brand-500 dark:hover:text-brand-400 font-semibold transition-all duration-200 min-h-[44px] ${
                  isCollapsed ? 'justify-center' : 'pl-5 gap-3'
                }`}
              >
                {/* Active left indicator line */}
                {!isCollapsed && active === '/' && (
                  <div className='absolute left-0 top-1/4 bottom-1/4 w-1 bg-gradient-to-b from-brand-500 to-emerald-500 rounded-r-md' />
                )}

                <div
                  className={`w-8 h-8 rounded-lg flex items-center justify-center transition-all duration-300 ${
                    active === '/'
                      ? 'bg-gradient-to-br from-brand-500/15 to-emerald-500/15 border border-brand-500/20 shadow-md shadow-brand-500/5'
                      : 'bg-transparent border border-transparent group-hover:bg-slate-100/50 dark:group-hover:bg-white/5'
                  }`}
                >
                  <Home
                    className={`h-4.5 w-4.5 transition-colors duration-200 ${
                      active === '/'
                        ? 'text-brand-500 dark:text-brand-400'
                        : 'text-gray-400 group-hover:text-brand-500 dark:text-gray-500 dark:group-hover:text-brand-400'
                    }`}
                  />
                </div>
                {!isCollapsed && (
                  <span className='text-sm whitespace-nowrap transition-opacity duration-200'>
                    {convert('首页')}
                  </span>
                )}
              </Link>
              <Link
                href='/search'
                onClick={(e) => {
                  e.preventDefault();
                  handleSearchClick();
                  setActive('/search');
                }}
                data-active={active === '/search'}
                className={`group relative flex items-center rounded-xl px-3 py-2 text-gray-650 dark:text-gray-350 hover:text-brand-500 dark:hover:text-brand-400 font-semibold transition-all duration-200 min-h-[44px] ${
                  isCollapsed ? 'justify-center' : 'pl-5 gap-3'
                }`}
              >
                {!isCollapsed && active === '/search' && (
                  <div className='absolute left-0 top-1/4 bottom-1/4 w-1 bg-gradient-to-b from-brand-500 to-emerald-500 rounded-r-md' />
                )}

                <div
                  className={`w-8 h-8 rounded-lg flex items-center justify-center transition-all duration-300 ${
                    active === '/search'
                      ? 'bg-gradient-to-br from-brand-500/15 to-emerald-500/15 border border-brand-500/20 shadow-md shadow-brand-500/5'
                      : 'bg-transparent border border-transparent group-hover:bg-slate-100/50 dark:group-hover:bg-white/5'
                  }`}
                >
                  <Search
                    className={`h-4.5 w-4.5 transition-colors duration-200 ${
                      active === '/search'
                        ? 'text-brand-500 dark:text-brand-400'
                        : 'text-gray-400 group-hover:text-brand-500 dark:text-gray-500 dark:group-hover:text-brand-400'
                    }`}
                  />
                </div>
                {!isCollapsed && (
                  <span className='text-sm whitespace-nowrap transition-opacity duration-200'>
                    {convert('搜索')}
                  </span>
                )}
              </Link>
            </nav>

            <div className='h-[1px] mx-4 my-3 bg-gray-200/50 dark:bg-gray-800/50' />

            {/* 菜单项 */}
            <div className='flex-1 overflow-y-auto px-2 space-y-1.5'>
              <div className='space-y-1.5'>
                {menuItems.map((item) => {
                  const typeMatch = item.href.match(/type=([^&]+)/)?.[1];
                  const decodedActive = decodeURIComponent(active);
                  const decodedItemHref = decodeURIComponent(item.href);

                  const isActive =
                    decodedActive === decodedItemHref ||
                    (decodedActive.startsWith('/douban') &&
                      decodedActive.includes(`type=${typeMatch}`));
                  const Icon = item.icon;
                  return (
                    <Link
                      key={item.label}
                      href={item.href}
                      onClick={() => setActive(item.href)}
                      data-active={isActive}
                      className={`group relative flex items-center rounded-xl px-3 py-2 text-sm text-gray-650 dark:text-gray-350 hover:text-brand-500 dark:hover:text-brand-400 font-semibold transition-all duration-200 min-h-[44px] ${
                        isCollapsed ? 'justify-center' : 'pl-5 gap-3'
                      }`}
                    >
                      {/* Active indicator bar */}
                      {!isCollapsed && isActive && (
                        <div className='absolute left-0 top-1/4 bottom-1/4 w-1 bg-gradient-to-b from-brand-500 to-emerald-500 rounded-r-md' />
                      )}

                      <div
                        className={`w-8 h-8 rounded-lg flex items-center justify-center transition-all duration-300 ${
                          isActive
                            ? 'bg-gradient-to-br from-brand-500/15 to-emerald-500/15 border border-brand-500/20 shadow-md shadow-brand-500/5'
                            : 'bg-transparent border border-transparent group-hover:bg-slate-100/50 dark:group-hover:bg-white/5'
                        }`}
                      >
                        <Icon
                          className={`h-4.5 w-4.5 transition-colors duration-200 ${
                            isActive
                              ? 'text-brand-500 dark:text-brand-400'
                              : 'text-gray-400 group-hover:text-brand-500 dark:text-gray-500 dark:group-hover:text-brand-400'
                          }`}
                        />
                      </div>
                      {!isCollapsed && (
                        <span className='text-sm whitespace-nowrap transition-opacity duration-200'>
                          {convert(item.label)}
                        </span>
                      )}
                    </Link>
                  );
                })}
              </div>
            </div>
          </div>
        </aside>
        <div
          className={`transition-all duration-300 sidebar-offset ${
            isCollapsed ? 'w-16' : 'w-64'
          }`}
        ></div>
      </div>
    </SidebarContext.Provider>
  );
};

export default Sidebar;
