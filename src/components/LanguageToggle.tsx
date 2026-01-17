'use client';

import { useEffect, useMemo, useState } from 'react';

import { useLanguage } from './LanguageProvider';

export function LanguageToggle() {
  const [mounted, setMounted] = useState(false);
  const { language, setLanguage, isConverterLoading } = useLanguage();

  useEffect(() => {
    setMounted(true);
  }, []);

  // --- 1. Compute values first (Hooks must run unconditionally) ---
  const nextLang = language === 'hans' ? 'hant' : 'hans';
  const labelText = language === 'hans' ? '繁' : '簡';

  const { title, ariaLabel } = useMemo(() => {
    const base =
      nextLang === 'hant'
        ? 'Switch to Traditional Chinese'
        : 'Switch to Simplified Chinese';

    return {
      title: isConverterLoading ? `${base} (loading...)` : base,
      ariaLabel: isConverterLoading ? `${base}. Loading.` : base,
    };
  }, [nextLang, isConverterLoading]);

  const handleToggle = () => {
    if (isConverterLoading) return;
    setLanguage(nextLang);
  };

  // --- 2. Hydration Guard (Early Return) ---
  // Must happen AFTER all hooks are called
  if (!mounted) {
    return <div className='h-10 w-10' aria-hidden='true' />;
  }

  // --- 3. Render ---
  return (
    <button
      type='button'
      onClick={handleToggle}
      disabled={isConverterLoading}
      title={title}
      aria-label={ariaLabel}
      aria-busy={isConverterLoading}
      className={[
        'flex h-10 w-10 items-center justify-center rounded-full p-2 text-sm font-bold transition-all',
        isConverterLoading
          ? 'cursor-wait opacity-70 bg-gray-100 dark:bg-gray-800'
          : 'text-gray-600 hover:bg-gray-200/50 dark:text-gray-300 dark:hover:bg-gray-700/50',
      ].join(' ')}
    >
      {isConverterLoading ? (
        <svg
          className='h-4 w-4 animate-spin text-gray-500'
          xmlns='http://www.w3.org/2000/svg'
          fill='none'
          viewBox='0 0 24 24'
          role='img'
          aria-hidden='true'
        >
          <circle
            className='opacity-25'
            cx='12'
            cy='12'
            r='10'
            stroke='currentColor'
            strokeWidth='4'
          />
          <path
            className='opacity-75'
            fill='currentColor'
            d='M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z'
          />
        </svg>
      ) : (
        labelText
      )}
    </button>
  );
}
