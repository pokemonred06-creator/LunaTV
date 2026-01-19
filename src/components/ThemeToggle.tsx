'use client';

import { Monitor, Moon, Sun } from 'lucide-react';
import { usePathname } from 'next/navigation';
import { useTheme } from 'next-themes';
import React, { useEffect, useMemo, useState } from 'react';
import ReactDOM from 'react-dom';

// --- Types for View Transitions API ---
interface ViewTransition {
  ready: Promise<void>;
  finished: Promise<void>;
  updateCallbackDone: Promise<void>;
}

interface DocumentWithViewTransition {
  startViewTransition: (callback: () => Promise<void> | void) => ViewTransition;
}

// Extend standard Animation options to include pseudoElement
interface KeyframeAnimationOptionsWithPseudo extends KeyframeAnimationOptions {
  pseudoElement?: string;
}

// --- Helpers ---

// Check OS motion preference
function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined') return true;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

// Calculate the effective theme (resolving 'system' to 'light' or 'dark')
function getEffectiveTheme(
  theme: string | undefined,
  resolvedTheme: string | undefined,
): 'light' | 'dark' {
  if (theme === 'system') {
    if (resolvedTheme === 'dark' || resolvedTheme === 'light')
      return resolvedTheme;
    if (typeof window !== 'undefined') {
      return window.matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light';
    }
    return 'light'; // Server fallback
  }
  return theme === 'dark' ? 'dark' : 'light';
}

// Sync meta theme-color for mobile status bars
function updateThemeColor(effective: 'light' | 'dark') {
  const color = effective === 'dark' ? '#0c111c' : '#f9fbfe';

  let meta = document.querySelector(
    'meta[name="theme-color"]',
  ) as HTMLMetaElement | null;
  if (!meta) {
    meta = document.createElement('meta');
    meta.name = 'theme-color';
    document.head.appendChild(meta);
  }

  if (meta.content !== color) {
    meta.content = color;
  }
}

export function ThemeToggle() {
  const [mounted, setMounted] = useState(false);
  const { theme, setTheme, resolvedTheme } = useTheme();
  const pathname = usePathname();

  // 1. Compute effective theme for logic that needs concrete light/dark
  const effectiveTheme = useMemo(
    () => getEffectiveTheme(theme, resolvedTheme),
    [theme, resolvedTheme],
  );

  // 2. Mount check to prevent hydration mismatch
  useEffect(() => setMounted(true), []);

  // 3. Sync theme-color on mount, theme change, or route change
  useEffect(() => {
    if (!mounted) return;
    updateThemeColor(effectiveTheme);
  }, [mounted, effectiveTheme, pathname]);

  // 4. Listen for system theme changes if user is in 'system' mode
  // Includes legacy Safari fallback
  useEffect(() => {
    if (!mounted || theme !== 'system') return;

    const mql = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (e: MediaQueryListEvent) =>
      updateThemeColor(e.matches ? 'dark' : 'light');

    // Modern vs Legacy Listener Support
    if (mql.addEventListener) {
      mql.addEventListener('change', onChange);
    } else {
      mql.addListener(onChange);
    }

    return () => {
      if (mql.removeEventListener) {
        mql.removeEventListener('change', onChange);
      } else {
        mql.removeListener(onChange);
      }
    };
  }, [mounted, theme]);

  if (!mounted) {
    return <div className='w-10 h-10 p-2' aria-hidden='true' />;
  }

  // --- Toggle Logic ---

  const cycle = ['system', 'light', 'dark'] as const;

  const getNextTheme = (): (typeof cycle)[number] => {
    const current = (theme as (typeof cycle)[number]) || 'system';
    const idx = cycle.indexOf(current);
    return cycle[(idx + 1) % cycle.length];
  };

  const toggleTheme = async (e: React.MouseEvent<HTMLButtonElement>) => {
    const nextTheme = getNextTheme();
    const doc = document as unknown as DocumentWithViewTransition;

    // Check support and user preference
    const canTransition = !!doc.startViewTransition && !prefersReducedMotion();

    if (!canTransition) {
      setTheme(nextTheme);
      return;
    }

    // Capture click coordinates
    const x = e.clientX;
    const y = e.clientY;
    const endRadius = Math.hypot(
      Math.max(x, innerWidth - x),
      Math.max(y, innerHeight - y),
    );

    // Pre-calculate effective theme for immediate status bar update
    const nextEffective =
      nextTheme === 'system'
        ? window.matchMedia('(prefers-color-scheme: dark)').matches
          ? 'dark'
          : 'light'
        : nextTheme;

    // Start View Transition
    const transition = doc.startViewTransition(() => {
      ReactDOM.flushSync(() => {
        setTheme(nextTheme);
      });

      // Immediate update for mobile status bars (prevents 1-frame lag)
      updateThemeColor(nextEffective);
    });

    await transition.ready;

    // Animate the "New" view expanding over the "Old" view
    document.documentElement.animate(
      {
        clipPath: [
          `circle(0px at ${x}px ${y}px)`,
          `circle(${endRadius}px at ${x}px ${y}px)`,
        ],
      },
      {
        duration: 500,
        easing: 'ease-in-out',
        pseudoElement: '::view-transition-new(root)',
      } as KeyframeAnimationOptionsWithPseudo,
    );
  };

  // --- Render ---

  const Icon =
    theme === 'system' ? Monitor : effectiveTheme === 'dark' ? Moon : Sun;

  const getLabel = () => {
    if (theme === 'system') return '跟随系统';
    return effectiveTheme === 'dark' ? '深色模式' : '浅色模式';
  };

  return (
    <button
      onClick={toggleTheme}
      className='w-10 h-10 p-2 rounded-full flex items-center justify-center text-gray-600 hover:bg-gray-200/50 dark:text-gray-300 dark:hover:bg-gray-700/50 transition-colors focus:outline-none focus:ring-2 focus:ring-gray-200 dark:focus:ring-gray-700'
      aria-label={getLabel()}
      title={getLabel()}
    >
      <Icon className='w-full h-full' />
    </button>
  );
}

export const themeOptions = [
  { value: 'system', label: '跟随系统', icon: Monitor },
  { value: 'light', label: '浅色模式', icon: Sun },
  { value: 'dark', label: '深色模式', icon: Moon },
] as const;
