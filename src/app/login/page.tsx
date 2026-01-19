'use client';

import { AlertCircle, CheckCircle } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';

import { CURRENT_VERSION } from '@/lib/version';
import { checkForUpdates, UpdateStatus } from '@/lib/version_check';

import { LanguageToggle } from '@/components/LanguageToggle';
import { useSite } from '@/components/SiteProvider';
import { ThemeToggle } from '@/components/ThemeToggle';

// --- Components ---

function VersionDisplay() {
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus | null>(null);
  const [isChecking, setIsChecking] = useState(true);

  useEffect(() => {
    let mounted = true;
    const checkUpdate = async () => {
      try {
        const status = await checkForUpdates();
        if (mounted) setUpdateStatus(status);
      } catch (_) {
        // Silently fail for version checks
      } finally {
        if (mounted) setIsChecking(false);
      }
    };

    checkUpdate();
    return () => {
      mounted = false;
    };
  }, []);

  return (
    <button
      onClick={() =>
        window.open('https://github.com/MoonTechLab/LunaTV', '_blank')
      }
      className='absolute bottom-6 left-1/2 transform -translate-x-1/2 flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200 transition-colors cursor-pointer'
      aria-label='Check for updates on GitHub'
    >
      <span className='font-mono opacity-80'>v{CURRENT_VERSION}</span>
      {!isChecking && updateStatus !== UpdateStatus.FETCH_FAILED && (
        <div
          className={`flex items-center gap-1.5 transition-opacity duration-500 ${
            updateStatus === UpdateStatus.HAS_UPDATE
              ? 'text-yellow-600 dark:text-yellow-400'
              : 'text-green-600 dark:text-green-400'
          }`}
        >
          {updateStatus === UpdateStatus.HAS_UPDATE ? (
            <>
              <AlertCircle className='w-3.5 h-3.5' />
              <span className='font-semibold text-xs'>有新版本</span>
            </>
          ) : (
            <>
              <CheckCircle className='w-3.5 h-3.5' />
              <span className='font-semibold text-xs'>已是最新</span>
            </>
          )}
        </div>
      )}
    </button>
  );
}

function LoginPageClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { siteName } = useSite();

  // Form State
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // UX State: Initialize to TRUE to prevent layout shift/flicker on load
  const [shouldAskUsername] = useState(true);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);

    if (!password || (shouldAskUsername && !username)) return;

    try {
      setLoading(true);
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          password,
          ...(shouldAskUsername ? { username } : {}),
        }),
      });

      if (res.ok) {
        const redirect = searchParams.get('redirect') || '/';
        router.replace(redirect);
      } else if (res.status === 401) {
        setError('用户名或密码错误');
      } else {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? '服务器错误');
      }
    } catch (error) {
      setError('网络错误，请检查连接');
    } finally {
      setLoading(false);
    }
  };

  return (
    // 'bg-gradient-to-b' is standard Tailwind (fixed from 'bg-linear-to-b')
    <div className='relative min-h-screen w-full flex flex-col items-center justify-center px-4 overflow-hidden bg-gray-50 dark:bg-zinc-950 transition-colors duration-300'>
      {/* Top Right Controls */}
      <div className='absolute top-6 right-6 flex items-center gap-3 z-20'>
        <LanguageToggle />
        <ThemeToggle />
      </div>

      {/* Main Card */}
      <div className='relative z-10 w-full max-w-md'>
        <div className='rounded-3xl bg-white/80 dark:bg-zinc-900/60 backdrop-blur-xl shadow-2xl p-8 sm:p-10 border border-white/20 dark:border-zinc-800/50'>
          <h1 className='text-3xl font-extrabold text-center mb-8 bg-linear-to-r from-green-600 to-emerald-600 bg-clip-text text-transparent drop-shadow-sm tracking-tight'>
            {siteName}
          </h1>

          <form onSubmit={handleSubmit} className='space-y-6'>
            {shouldAskUsername && (
              <div className='space-y-1'>
                <label htmlFor='username' className='sr-only'>
                  用户名
                </label>
                <input
                  id='username'
                  name='username'
                  type='text'
                  autoComplete='username'
                  required
                  className='block w-full rounded-xl border-0 py-3.5 px-4 text-gray-900 dark:text-gray-100 shadow-sm ring-1 ring-inset ring-gray-300 dark:ring-white/10 placeholder:text-gray-500 dark:placeholder:text-gray-400 focus:ring-2 focus:ring-inset focus:ring-green-500 sm:text-sm sm:leading-6 bg-white/50 dark:bg-zinc-800/50 backdrop-blur transition-all'
                  placeholder='输入用户名'
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                />
              </div>
            )}

            <div className='space-y-1'>
              <label htmlFor='password' className='sr-only'>
                密码
              </label>
              <input
                id='password'
                name='password'
                type='password'
                autoComplete='current-password'
                required
                className='block w-full rounded-xl border-0 py-3.5 px-4 text-gray-900 dark:text-gray-100 shadow-sm ring-1 ring-inset ring-gray-300 dark:ring-white/10 placeholder:text-gray-500 dark:placeholder:text-gray-400 focus:ring-2 focus:ring-inset focus:ring-green-500 sm:text-sm sm:leading-6 bg-white/50 dark:bg-zinc-800/50 backdrop-blur transition-all'
                placeholder='输入访问密码'
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>

            {/* Error Message with Animation */}
            {error && (
              <div className='rounded-lg bg-red-50 dark:bg-red-900/20 p-3 animate-in fade-in slide-in-from-top-1'>
                <p className='text-sm text-red-600 dark:text-red-400 text-center font-medium'>
                  {error}
                </p>
              </div>
            )}

            <button
              type='submit'
              disabled={
                !password || loading || (shouldAskUsername && !username)
              }
              className='group relative w-full flex justify-center py-3.5 px-4 border border-transparent text-sm font-semibold rounded-xl text-white bg-green-600 hover:bg-green-500 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-lg hover:shadow-green-500/30'
            >
              {loading ? (
                <span className='flex items-center gap-2'>
                  <svg
                    className='animate-spin h-4 w-4 text-white'
                    xmlns='http://www.w3.org/2000/svg'
                    fill='none'
                    viewBox='0 0 24 24'
                  >
                    <circle
                      className='opacity-25'
                      cx='12'
                      cy='12'
                      r='10'
                      stroke='currentColor'
                      strokeWidth='4'
                    ></circle>
                    <path
                      className='opacity-75'
                      fill='currentColor'
                      d='M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z'
                    ></path>
                  </svg>
                  登录中...
                </span>
              ) : (
                '登录'
              )}
            </button>
          </form>
        </div>
      </div>

      <VersionDisplay />
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className='min-h-screen w-full bg-gray-50 dark:bg-zinc-950' />
      }
    >
      <LoginPageClient />
    </Suspense>
  );
}
