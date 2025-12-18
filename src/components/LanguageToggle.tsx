'use client';

import { useEffect, useState } from 'react';

import { useLanguage } from './LanguageProvider';

export function LanguageToggle() {
  const [mounted, setMounted] = useState(false);
  const { language, setLanguage } = useLanguage();

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return <div className='w-10 h-10' />;
  }

  const toggleLanguage = () => {
    setLanguage(language === 'hans' ? 'hant' : 'hans');
  };

  return (
    <button
      onClick={toggleLanguage}
      className='flex h-10 w-10 items-center justify-center rounded-full p-2 text-sm font-bold text-gray-600 transition-colors hover:bg-gray-200/50 dark:text-gray-300 dark:hover:bg-gray-700/50'
      aria-label='Toggle language'
    >
      {language === 'hans' ? '繁' : '簡'}
    </button>
  );
}
