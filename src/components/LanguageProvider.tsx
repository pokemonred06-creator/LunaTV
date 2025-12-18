'use client';

import * as OpenCC from 'opencc-js';
import React, { createContext, useContext, useEffect, useState } from 'react';

type Language = 'hans' | 'hant';

interface LanguageContextType {
  language: Language;
  setLanguage: (lang: Language) => void;
  convert: (text: string) => string;
}

const LanguageContext = createContext<LanguageContextType>({
  language: 'hans',
  setLanguage: () => {},
  convert: (t) => t,
});

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [language, setLanguageState] = useState<Language>('hans');
  // converter is a function
  const [converter, setConverter] = useState<((text: string) => string) | null>(
    null
  );

  useEffect(() => {
    // Initialize from localStorage
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('language') as Language;
      // Default to 'hans' if not set
      if (saved === 'hant') {
        setLanguageState('hant');
      }
    }
  }, []);

  useEffect(() => {
    if (language === 'hant') {
      // Initialize converter for Simplified to Traditional (Hong Kong)
      // This might be heavy, so it runs only when needed
      const cvt = OpenCC.Converter({ from: 'cn', to: 'hk' });
      setConverter(() => cvt);
    } else {
      setConverter(null);
    }
    if (typeof window !== 'undefined') {
      localStorage.setItem('language', language);
    }
  }, [language]);

  const convert = (text: string) => {
    if (!text) return '';
    // Explicitly return original text if language is Simplified (hans)
    if (language === 'hans') {
        return text;
    }
    if (language === 'hant' && converter) {
      try {
        return converter(text);
      } catch (e) {
        // Fallback if conversion fails
        console.error('Conversion failed', e);
        return text;
      }
    }
    return text;
  };

  return (
    <LanguageContext.Provider
      value={{ language, setLanguage: setLanguageState, convert }}
    >
      {children}
    </LanguageContext.Provider>
  );
}

export const useLanguage = () => useContext(LanguageContext);
