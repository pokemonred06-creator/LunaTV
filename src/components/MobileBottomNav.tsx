/* eslint-disable @typescript-eslint/no-explicit-any */

'use client';

import { Cat, Clapperboard, Home, Mic, Radio, Star, Tv } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';

import { useLanguage } from './LanguageProvider';

interface MobileBottomNavProps {
  /**
   * 主动指定当前激活的路径。当未提供时，自动使用 usePathname() 获取的路径。
   */
  activePath?: string;
  forced?: boolean;
}

const MobileBottomNav = ({
  activePath,
  forced = false,
}: MobileBottomNavProps) => {
  const { convert } = useLanguage();
  const pathname = usePathname();

  // 当前激活路径：优先使用传入的 activePath，否则回退到浏览器地址
  const currentActive = activePath ?? pathname;

  const [navItems, setNavItems] = useState([
    { icon: Home, label: '首页', href: '/' },
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
      setNavItems((prevItems) => [
        ...prevItems,
        {
          icon: Star,
          label: '自定义',
          href: '/douban?type=custom',
        },
      ]);
    }
  }, []);

  const isActive = (href: string) => {
    const typeMatch = href.match(/type=([^&]+)/)?.[1];

    // 解码URL以进行正确的比较
    const decodedActive = decodeURIComponent(currentActive);
    const decodedItemHref = decodeURIComponent(href);

    return (
      decodedActive === decodedItemHref ||
      (decodedActive.startsWith('/douban') &&
        decodedActive.includes(`type=${typeMatch}`))
    );
  };

  return (
    <nav
      className={`${forced ? 'block' : 'md:hidden'} fixed left-0 right-0 z-600 bg-white/60 backdrop-blur-2xl border-t border-slate-200/40 overflow-hidden dark:bg-slate-950/65 dark:border-slate-800/40 isolation-isolate shadow-[0_-4px_24px_rgba(0,0,0,0.03)]`}
      style={{
        /* 紧贴视口底部，同时在内部留出安全区高度 */
        bottom: 0,
        paddingBottom: 'env(safe-area-inset-bottom)',
        minHeight: 'calc(3.5rem + env(safe-area-inset-bottom))',
        touchAction: 'manipulation', // Allow all valid panning but optimize tap speed
        userSelect: 'none', // Prevent text selection
        WebkitUserSelect: 'none',
      }}
      onClick={(e) => e.stopPropagation()} // Stop any click propagation explicitly
    >
      <ul className='flex items-center overflow-x-auto scrollbar-hide'>
        {navItems.map((item) => {
          const active = isActive(item.href);
          return (
            <li
              key={item.href}
              className='flex-1 min-w-[60px] max-w-[90px]'
            >
              <Link
                href={item.href}
                className='relative flex flex-col items-center justify-center w-full h-14 gap-1 text-[10px] sm:text-xs font-semibold'
              >
                {active && (
                  <div className='absolute top-1 w-5 h-1 bg-gradient-to-r from-brand-500 to-emerald-500 rounded-full shadow-md shadow-brand-500/20' />
                )}
                <div
                  className={`w-9 h-7 rounded-xl flex items-center justify-center transition-all duration-200 ${
                    active
                      ? 'bg-gradient-to-br from-brand-500/12 to-emerald-500/12'
                      : ''
                  }`}
                >
                  <item.icon
                    className={`h-5 w-5 transition-all duration-300 ${
                      active
                        ? 'text-brand-500 dark:text-brand-400 scale-110'
                        : 'text-slate-400 hover:text-brand-500 dark:text-slate-500 dark:hover:text-brand-400'
                    }`}
                  />
                </div>
                <span
                  className={`transition-colors duration-300 ${
                    active
                      ? 'text-brand-500 dark:text-brand-400 font-bold'
                      : 'text-slate-500 dark:text-slate-400'
                  }`}
                >
                  {convert(item.label)}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
};

export default MobileBottomNav;
