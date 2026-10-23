'use client';

import Link from 'next/link';

import { BackButton } from './BackButton';
import { LanguageToggle } from './LanguageToggle';
import { useSite } from './SiteProvider';
import { ThemeToggle } from './ThemeToggle';
import { UserMenu } from './UserMenu';

interface MobileHeaderProps {
  showBackButton?: boolean;
  forced?: boolean;
}

const MobileHeader = ({
  showBackButton = false,
  forced = false,
}: MobileHeaderProps) => {
  const { siteName } = useSite();
  return (
    <header
      className={`${forced ? 'block' : 'md:hidden'} fixed top-0 left-0 right-0 z-999 w-full bg-white/60 dark:bg-slate-950/65 backdrop-blur-2xl border-b border-slate-200/40 dark:border-slate-800/40 shadow-xs`}
    >
      <div className='h-12 flex items-center justify-between px-4'>
        {/* 左侧：搜索按钮、返回按钮和设置按钮 */}
        <div className='flex items-center gap-2'>
          <Link
            href='/search'
            className='w-10 h-10 p-2 rounded-full flex items-center justify-center text-gray-600 hover:bg-gray-200/50 dark:text-gray-300 dark:hover:bg-gray-700/50 transition-colors'
          >
            <svg
              className='w-full h-full'
              fill='none'
              stroke='currentColor'
              viewBox='0 0 24 24'
              xmlns='http://www.w3.org/2000/svg'
            >
              <path
                strokeLinecap='round'
                strokeLinejoin='round'
                strokeWidth={2}
                d='M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z'
              />
            </svg>
          </Link>
          {showBackButton && <BackButton />}
        </div>

        {/* 右侧按钮 */}
        <div className='flex items-center gap-2'>
          <LanguageToggle />
          <ThemeToggle />
          <UserMenu />
        </div>
      </div>

      {/* 中间：Logo（绝对居中） */}
      <div className='absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2'>
        <Link
          href='/'
          className='flex items-center gap-1.5 select-none hover:opacity-90 transition-opacity'
        >
          <div className='w-6 h-6 rounded-md bg-gradient-to-br from-brand-500 to-emerald-500 flex items-center justify-center shadow-md shadow-brand-500/20'>
            <span className='text-white text-[11px] font-black'>
              {siteName?.charAt(0)?.toUpperCase() ?? 'L'}
            </span>
          </div>
          <span className='text-base font-black bg-gradient-to-r from-brand-600 to-emerald-500 dark:from-brand-400 dark:to-emerald-300 bg-clip-text text-transparent tracking-tight'>
            {siteName}
          </span>
        </Link>
      </div>
    </header>
  );
};

export default MobileHeader;
