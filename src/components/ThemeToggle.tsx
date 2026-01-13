/* eslint-disable @typescript-eslint/no-explicit-any */

'use client';

import { Monitor, Moon, Sun } from 'lucide-react';
import { usePathname } from 'next/navigation';
import { useTheme } from 'next-themes';
import { useEffect, useState } from 'react';

export function ThemeToggle() {
  const [mounted, setMounted] = useState(false);
  const { theme, setTheme, resolvedTheme } = useTheme();
  const pathname = usePathname();

  const setThemeColor = (themeValue?: string) => {
    const meta = document.querySelector('meta[name="theme-color"]');
    if (!meta) {
      const meta = document.createElement('meta');
      meta.name = 'theme-color';
      meta.content = themeValue === 'dark' ? '#0c111c' : '#f9fbfe';
      document.head.appendChild(meta);
    } else {
      meta.setAttribute('content', themeValue === 'dark' ? '#0c111c' : '#f9fbfe');
    }
  };

  useEffect(() => {
     
    setMounted(true);
  }, []);

  // 监听主题变化和路由变化，确保主题色始终同步
  useEffect(() => {
    if (mounted) {
      setThemeColor(resolvedTheme);
    }
  }, [mounted, resolvedTheme, pathname]);

  if (!mounted) {
    // 渲染一个占位符以避免布局偏移
    return <div className='w-10 h-10' />;
  }

  const toggleTheme = () => {
    // Cycle through: system -> light -> dark -> system
    let targetTheme: string;
    if (theme === 'system') {
      targetTheme = 'light';
    } else if (theme === 'light') {
      targetTheme = 'dark';
    } else {
      targetTheme = 'system';
    }
    
    // For view transition, we need to use the resolved theme
    const resolvedTarget = targetTheme === 'system' 
      ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
      : targetTheme;
    
    setThemeColor(resolvedTarget);
    
    if (!(document as any).startViewTransition) {
      setTheme(targetTheme);
      return;
    }

    (document as any).startViewTransition(() => {
      setTheme(targetTheme);
    });
  };

  // Determine which icon to show
  const getIcon = () => {
    if (theme === 'system') {
      return <Monitor className='w-full h-full' />;
    }
    if (resolvedTheme === 'dark') {
      return <Sun className='w-full h-full' />;
    }
    return <Moon className='w-full h-full' />;
  };

  const getLabel = () => {
    if (theme === 'system') return '跟随系统';
    if (resolvedTheme === 'dark') return '深色模式';
    return '浅色模式';
  };

  return (
    <button
      onClick={toggleTheme}
      className='w-10 h-10 p-2 rounded-full flex items-center justify-center text-gray-600 hover:bg-gray-200/50 dark:text-gray-300 dark:hover:bg-gray-700/50 transition-colors'
      aria-label={getLabel()}
      title={getLabel()}
    >
      {getIcon()}
    </button>
  );
}

// Export theme options for settings UI
export const themeOptions = [
  { value: 'system', label: '跟随系统', icon: Monitor },
  { value: 'light', label: '浅色模式', icon: Sun },
  { value: 'dark', label: '深色模式', icon: Moon },
];
