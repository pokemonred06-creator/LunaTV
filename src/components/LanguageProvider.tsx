'use client';

import * as OpenCC from 'opencc-js';
import React, {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';

// --- Types ---
export type Language = 'hans' | 'hant';

interface LanguageContextType {
  language: Language;
  setLanguage: (lang: Language) => void;
  convert: (text: string) => string;
  isConverterLoading: boolean;
}

const LanguageContext = createContext<LanguageContextType | undefined>(
  undefined,
);

const STORAGE_KEY = 'lunatv_language_pref';

// --- Helpers ---
function applyHtmlLang(lang: Language) {
  if (typeof document === 'undefined') return;
  document.documentElement.lang = lang === 'hans' ? 'zh-Hans' : 'zh-Hant';
}

function detectBrowserLanguage(): Language {
  if (typeof navigator === 'undefined') return 'hans';

  const list = (
    navigator.languages?.length ? navigator.languages : [navigator.language]
  ).filter(Boolean);

  for (const lang of list) {
    const lower = lang.toLowerCase();
    if (
      lower.includes('zh-tw') ||
      lower.includes('zh-hk') ||
      lower.includes('zh-mo') ||
      lower.includes('hant')
    ) {
      return 'hant';
    }
    if (lower.includes('zh-cn') || lower.includes('hans')) {
      return 'hans';
    }
  }
  return 'hans';
}

const cvt = OpenCC.Converter({ from: 'cn', to: 'hk' });

// --- Provider ---
export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<Language>('hans');
  const [isConverterLoading] = useState(false); // Always false for eager load

  // --- Initial Setup & Sync ---
  useEffect(() => {
    let initial: Language | null = null;
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored === 'hans' || stored === 'hant') initial = stored;
    } catch {
      /* ignore */
    }

    if (!initial) initial = detectBrowserLanguage();

    setLanguageState(initial);
    applyHtmlLang(initial);
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, language);
    } catch {
      /* ignore */
    }
    applyHtmlLang(language);
  }, [language]);

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== STORAGE_KEY) return;
      if (e.newValue === 'hans' || e.newValue === 'hant') {
        setLanguageState(e.newValue);
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const setLanguage = useCallback((lang: Language) => {
    setLanguageState(lang);
  }, []);

  const convert = useCallback(
    (text: string) => {
      if (!text) return '';
      if (language === 'hans') return text;
      try {
        return cvt(text);
      } catch {
        return text;
      }
    },
    [language],
  );

  const value = useMemo(
    () => ({ language, setLanguage, convert, isConverterLoading }),
    [language, setLanguage, convert, isConverterLoading],
  );

  return (
    <LanguageContext.Provider value={value}>
      {children}
    </LanguageContext.Provider>
  );
}

export const useLanguage = () => {
  const context = useContext(LanguageContext);
  if (!context) {
    throw new Error('useLanguage must be used within a LanguageProvider');
  }
  return context;
};
