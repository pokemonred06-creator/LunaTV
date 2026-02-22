'use client';

import { useEffect, useState } from 'react';

import { useLocalStorage } from '@/hooks/useLocalStorage';

/**
 * DebugConsole component
 * Dynamically injects Eruda (mobile console) when enabled in settings.
 */
export function DebugConsole() {
  const [debugEnabled] = useLocalStorage('debugConsole', false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!debugEnabled) {
      // If disabled, we don't destroy it (to avoid complex cleanup),
      // but it won't load if it was never enabled.
      // Eruda usually stays once injected unless manually removed.
      return;
    }

    if (loaded) return;

    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/eruda@3.0.1/eruda.js';
    script.async = true;
    script.onload = () => {
      if (window.eruda) {
        window.eruda.init();
        setLoaded(true);
      }
    };
    document.body.appendChild(script);

    return () => {
      // Cleanup script tag if unmounted before load
      if (!loaded && document.body.contains(script)) {
        document.body.removeChild(script);
      }
    };
  }, [debugEnabled, loaded]);

  return null; // Side-effect only component
}

// Add eruda to global window type for TS
declare global {
  interface Window {
    eruda: {
      init: () => void;
      [key: string]: unknown;
    };
  }
}
