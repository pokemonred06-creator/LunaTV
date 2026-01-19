'use client';

import {
  KeyRound,
  LogOut,
  LucideIcon,
  Settings,
  Shield,
  User,
  X,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTheme } from 'next-themes';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { getAuthInfoFromBrowserCookie } from '@/lib/auth';
import { CURRENT_VERSION } from '@/lib/version';
import { checkForUpdates, UpdateStatus } from '@/lib/version_check';

import { themeOptions } from './ThemeToggle';
import { VersionPanel } from './VersionPanel';

// --- Global Utilities & Hooks ---

// 1. Reference-Counted Scroll Lock
// Prevents body scroll from unlocking if multiple modals overlap
let scrollLockCount = 0;
let originalOverflow = '';

const useScrollLock = (isLocked: boolean) => {
  useEffect(() => {
    if (!isLocked) return;

    scrollLockCount++;
    if (scrollLockCount === 1) {
      originalOverflow = window.getComputedStyle(document.body).overflow;
      document.body.style.overflow = 'hidden';
    }

    return () => {
      scrollLockCount--;
      if (scrollLockCount <= 0) {
        scrollLockCount = 0; // Safety reset
        document.body.style.overflow = originalOverflow;
      }
    };
  }, [isLocked]);
};

// 2. Robust LocalStorage Hook (SSR Safe + Cross-Tab Sync)
function useLocalStorage<T>(
  key: string,
  initialValue: T,
): [T, (value: T | ((val: T) => T)) => void] {
  // Lazy initialization to avoid hydration mismatch
  const readValue = useCallback((): T => {
    if (typeof window === 'undefined') return initialValue;
    try {
      const item = window.localStorage.getItem(key);
      return item ? (JSON.parse(item) as T) : initialValue;
    } catch (error) {
      console.warn(`Error reading localStorage key "${key}":`, error);
      return initialValue;
    }
  }, [initialValue, key]);

  const [storedValue, setStoredValue] = useState<T>(initialValue);

  // Sync state with local storage on mount
  useEffect(() => {
    setStoredValue(readValue());
  }, [readValue]);

  // Sync across tabs
  useEffect(() => {
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === key && e.newValue !== null) {
        try {
          setStoredValue(JSON.parse(e.newValue));
        } catch {
          /* ignore */
        }
      }
    };
    window.addEventListener('storage', handleStorageChange);
    return () => window.removeEventListener('storage', handleStorageChange);
  }, [key]);

  const setValue = useCallback(
    (value: T | ((val: T) => T)) => {
      try {
        const valueToStore =
          value instanceof Function ? value(storedValue) : value;
        setStoredValue(valueToStore);
        if (typeof window !== 'undefined') {
          window.localStorage.setItem(key, JSON.stringify(valueToStore));
        }
      } catch (error) {
        console.warn(`Error setting localStorage key "${key}":`, error);
      }
    },
    [key, storedValue],
  );

  return [storedValue, setValue];
}

// --- Types ---

interface AuthInfo {
  username?: string;
  role?: 'owner' | 'admin' | 'user';
}

interface MenuItemProps {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
  className?: string;
}

// --- Sub-Components ---

// 1. Change Password Modal
const ChangePasswordModal = ({
  isOpen,
  onClose,
  onLogout,
}: {
  isOpen: boolean;
  onClose: () => void;
  onLogout: () => void;
}) => {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useScrollLock(isOpen);

  // Keyboard trap
  useEffect(() => {
    if (!isOpen) return;
    const handleEsc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleSubmit = async () => {
    setError('');
    if (!newPassword) return setError('新密码不得为空');
    if (newPassword !== confirmPassword)
      return setError('两次输入的密码不一致');

    setLoading(true);
    try {
      const res = await fetch('/api/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '修改密码失败');

      onClose();
      onLogout();
    } catch (err) {
      setError(err instanceof Error ? err.message : '网络错误');
    } finally {
      setLoading(false);
    }
  };

  return createPortal(
    <div
      className='fixed inset-0 z-1000 flex items-center justify-center p-4'
      role='dialog'
      aria-modal='true'
      aria-labelledby='modal-pw-title'
    >
      <div
        className='fixed inset-0 bg-black/50 backdrop-blur-sm'
        onClick={onClose}
        aria-hidden='true'
      />
      <div className='relative w-full max-w-md bg-white dark:bg-gray-900 rounded-xl shadow-xl z-10 overflow-hidden animate-in fade-in zoom-in-95 duration-200'>
        <div className='flex justify-between items-center p-6 border-b dark:border-gray-800'>
          <h3 id='modal-pw-title' className='text-xl font-bold dark:text-white'>
            修改密码
          </h3>
          <button
            onClick={onClose}
            className='p-1 rounded-full hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors'
            aria-label='关闭'
          >
            <X className='w-5 h-5' />
          </button>
        </div>
        <div className='p-6 space-y-4'>
          <input
            type='password'
            placeholder='当前密码'
            className='w-full p-2 border rounded dark:bg-gray-800 dark:border-gray-700'
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
          />
          <input
            type='password'
            placeholder='新密码'
            className='w-full p-2 border rounded dark:bg-gray-800 dark:border-gray-700'
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
          />
          <input
            type='password'
            placeholder='确认新密码'
            className='w-full p-2 border rounded dark:bg-gray-800 dark:border-gray-700'
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
          />
          {error && <p className='text-red-500 text-sm'>{error}</p>}
        </div>
        <div className='p-6 bg-gray-50 dark:bg-gray-800/50 flex justify-end gap-3'>
          <button
            onClick={onClose}
            className='px-4 py-2 text-sm rounded bg-gray-200 dark:bg-gray-700 hover:opacity-80 transition-opacity'
          >
            取消
          </button>
          <button
            onClick={handleSubmit}
            disabled={loading}
            className='px-4 py-2 text-sm rounded bg-green-600 text-white hover:bg-green-700 disabled:opacity-50 transition-colors'
          >
            {loading ? '提交中...' : '确认修改'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
};

// 2. Settings Modal
const SettingsModal = ({
  isOpen,
  onClose,
}: {
  isOpen: boolean;
  onClose: () => void;
}) => {
  const { theme, setTheme } = useTheme();

  // Settings State using robust hook
  const [doubanSource, setDoubanSource] = useLocalStorage(
    'doubanDataSource',
    'cmliussss-cdn-tencent',
  );
  const [doubanProxy, setDoubanProxy] = useLocalStorage('doubanProxyUrl', '');
  const [imageProxyType, setImageProxyType] = useLocalStorage(
    'doubanImageProxyType',
    'cmliussss-cdn-tencent',
  );
  const [imageProxyUrl, setImageProxyUrl] = useLocalStorage(
    'doubanImageProxyUrl',
    '',
  );

  const [aggSearch, setAggSearch] = useLocalStorage(
    'defaultAggregateSearch',
    true,
  );
  const [optimize, setOptimize] = useLocalStorage('enableOptimization', true);
  const [fluid, setFluid] = useLocalStorage('fluidSearch', true);
  const [directLive, setDirectLive] = useLocalStorage(
    'liveDirectConnect',
    false,
  );

  useScrollLock(isOpen);

  // Esc to close
  useEffect(() => {
    if (!isOpen) return;
    const handleEsc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return createPortal(
    <div
      className='fixed inset-0 z-1000 flex items-center justify-center p-4'
      role='dialog'
      aria-modal='true'
      aria-labelledby='modal-settings-title'
    >
      <div
        className='fixed inset-0 bg-black/50 backdrop-blur-sm'
        onClick={onClose}
        aria-hidden='true'
      />
      <div className='relative w-full max-w-xl max-h-[85vh] flex flex-col bg-white dark:bg-gray-900 rounded-xl shadow-xl z-10 overflow-hidden animate-in fade-in zoom-in-95 duration-200'>
        {/* Header */}
        <div className='flex justify-between items-center p-6 border-b dark:border-gray-800 shrink-0'>
          <h3
            id='modal-settings-title'
            className='text-xl font-bold dark:text-white'
          >
            本地设置
          </h3>
          <button
            onClick={onClose}
            className='p-1 rounded-full hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors'
            aria-label='关闭'
          >
            <X className='w-5 h-5' />
          </button>
        </div>

        {/* Content */}
        <div className='flex-1 overflow-y-auto p-6 space-y-8'>
          {/* Theme */}
          <section>
            <h4 className='text-sm font-medium mb-3 dark:text-gray-200'>
              外观主题
            </h4>
            <div className='flex gap-2'>
              {themeOptions.map((opt) => {
                const Icon = opt.icon;
                return (
                  <button
                    key={opt.value}
                    onClick={() => setTheme(opt.value)}
                    className={`flex-1 flex items-center justify-center gap-2 p-2.5 rounded-lg border text-sm transition-all
                      ${
                        theme === opt.value
                          ? 'border-green-500 bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-400'
                          : 'border-gray-200 dark:border-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800'
                      }`}
                  >
                    <Icon className='w-4 h-4' /> {opt.label}
                  </button>
                );
              })}
            </div>
          </section>

          <hr className='border-gray-100 dark:border-gray-800' />

          {/* Sources */}
          <section className='space-y-4'>
            <div>
              <label className='block text-sm font-medium mb-1 dark:text-gray-200'>
                豆瓣数据源
              </label>
              <select
                value={doubanSource}
                onChange={(e) => setDoubanSource(e.target.value)}
                className='w-full p-2.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-transparent dark:bg-gray-800 outline-none focus:ring-2 focus:ring-green-500'
              >
                <option value='direct'>直连</option>
                <option value='cors-proxy-zwei'>Cors Proxy By Zwei</option>
                <option value='cmliussss-cdn-tencent'>
                  CMLiussss (腾讯云)
                </option>
                <option value='cmliussss-cdn-ali'>CMLiussss (阿里云)</option>
                <option value='custom'>自定义</option>
              </select>
              {doubanSource === 'custom' && (
                <input
                  className='mt-2 w-full p-2 border rounded dark:bg-gray-800 dark:border-gray-700'
                  placeholder='https://api...'
                  value={doubanProxy}
                  onChange={(e) => setDoubanProxy(e.target.value)}
                />
              )}
            </div>

            <div>
              <label className='block text-sm font-medium mb-1 dark:text-gray-200'>
                图片代理
              </label>
              <select
                value={imageProxyType}
                onChange={(e) => setImageProxyType(e.target.value)}
                className='w-full p-2.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-transparent dark:bg-gray-800 outline-none focus:ring-2 focus:ring-green-500'
              >
                <option value='direct'>直连</option>
                <option value='cmliussss-cdn-tencent'>
                  CMLiussss (腾讯云)
                </option>
                <option value='custom'>自定义</option>
              </select>
              {imageProxyType === 'custom' && (
                <input
                  className='mt-2 w-full p-2 border rounded dark:bg-gray-800 dark:border-gray-700'
                  placeholder='https://img...'
                  value={imageProxyUrl}
                  onChange={(e) => setImageProxyUrl(e.target.value)}
                />
              )}
            </div>
          </section>

          <hr className='border-gray-100 dark:border-gray-800' />

          {/* Toggles */}
          <section className='space-y-4'>
            <ToggleItem
              label='默认聚合搜索'
              sub='按标题和年份聚合结果'
              checked={aggSearch}
              onChange={setAggSearch}
            />
            <ToggleItem
              label='优选测速'
              sub='解决播放劫持问题'
              checked={optimize}
              onChange={setOptimize}
            />
            <ToggleItem
              label='流式搜索'
              sub='实时显示搜索结果'
              checked={fluid}
              onChange={setFluid}
            />
            <ToggleItem
              label='IPTV 直连'
              sub='需安装 Allow CORS 插件'
              checked={directLive}
              onChange={setDirectLive}
            />
          </section>
        </div>
        <div className='p-4 border-t dark:border-gray-800 text-center text-xs text-gray-400'>
          设置自动保存在本地
        </div>
      </div>
    </div>,
    document.body,
  );
};

const ToggleItem = ({
  label,
  sub,
  checked,
  onChange,
}: {
  label: string;
  sub: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) => (
  <div className='flex items-center justify-between'>
    <div>
      <div className='text-sm font-medium dark:text-gray-200'>{label}</div>
      <div className='text-xs text-gray-500'>{sub}</div>
    </div>
    <label className='relative inline-flex items-center cursor-pointer'>
      <input
        type='checkbox'
        className='sr-only peer'
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-green-600"></div>
    </label>
  </div>
);

const MenuItem = ({
  icon: Icon,
  label,
  onClick,
  className = '',
}: MenuItemProps) => (
  <button
    onClick={onClick}
    role='menuitem'
    className={`w-full flex items-center justify-start gap-3 px-3 py-2.5 text-sm font-medium rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors text-gray-700 dark:text-gray-200 text-left ${className}`}
  >
    <Icon className='w-4 h-4' />
    {label}
  </button>
);

// --- Main Component ---

export const UserMenu: React.FC = () => {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);

  // Modals state
  const [showSettings, setShowSettings] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showVersion, setShowVersion] = useState(false);

  const [authInfo, setAuthInfo] = useState<AuthInfo | null>(null);
  const [storageType, setStorageType] = useState('localstorage');
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus | null>(null);
  const [mounted, setMounted] = useState(false);

  // Refs for Accessibility
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMounted(true);
    if (typeof window !== 'undefined') {
      setAuthInfo(getAuthInfoFromBrowserCookie());

      setStorageType(
        (window as unknown as { RUNTIME_CONFIG?: { STORAGE_TYPE?: string } })
          .RUNTIME_CONFIG?.STORAGE_TYPE || 'localstorage',
      );
    }
    checkForUpdates()
      .then(setUpdateStatus)
      .catch(() => {});
  }, []);

  // Menu Accessibility Logic
  useEffect(() => {
    if (!isOpen) return;

    // Focus Trap / Escape Listener for Dropdown
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsOpen(false);
    };

    // Click outside listener
    const handleClickOutside = (e: MouseEvent) => {
      if (
        menuRef.current &&
        !menuRef.current.contains(e.target as Node) &&
        buttonRef.current &&
        !buttonRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    document.addEventListener('mousedown', handleClickOutside);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  // Restore focus to button when menu closes
  useEffect(() => {
    if (!isOpen && buttonRef.current) {
      // Only focus if we aren't opening a modal
      if (!showSettings && !showPassword && !showVersion) {
        // Optional: restore focus
      }
    }
  }, [isOpen, showSettings, showPassword, showVersion]);

  const handleLogout = async () => {
    await fetch('/api/logout', { method: 'POST' });
    window.location.href = '/';
  };

  const getRoleText = (role?: string) => {
    if (role === 'owner') return '站长';
    if (role === 'admin') return '管理员';
    return '用户';
  };

  const menuPanel = (
    <div
      ref={menuRef}
      className='fixed top-16 right-4 w-60 bg-white dark:bg-gray-900 rounded-xl shadow-xl z-999 border dark:border-gray-800 overflow-hidden animate-in fade-in zoom-in-95 duration-100'
      role='menu'
      aria-label='User menu'
    >
      <div className='p-4 bg-gray-50 dark:bg-gray-800/50 border-b dark:border-gray-800'>
        <div className='flex justify-between items-start mb-1'>
          <span className='text-xs font-bold text-gray-400 uppercase'>
            当前用户
          </span>
          <span
            className={`px-2 py-0.5 text-xs rounded-full font-medium ${
              authInfo?.role === 'owner'
                ? 'bg-purple-100 text-purple-700'
                : 'bg-blue-100 text-blue-700'
            }`}
          >
            {getRoleText(authInfo?.role)}
          </span>
        </div>
        <div className='font-semibold text-gray-900 dark:text-white truncate'>
          {authInfo?.username || 'Guest'}
        </div>
        <div className='text-[10px] text-gray-400 mt-1'>
          存储: {storageType}
        </div>
      </div>

      <div className='p-1'>
        <MenuItem
          icon={Settings}
          label='设置'
          onClick={() => {
            setIsOpen(false);
            setShowSettings(true);
          }}
        />

        {(authInfo?.role === 'owner' || authInfo?.role === 'admin') && (
          <MenuItem
            icon={Shield}
            label='管理面板'
            onClick={() => {
              setIsOpen(false);
              router.push('/admin');
            }}
          />
        )}

        {authInfo?.role !== 'owner' && storageType !== 'localstorage' && (
          <MenuItem
            icon={KeyRound}
            label='修改密码'
            onClick={() => {
              setIsOpen(false);
              setShowPassword(true);
            }}
          />
        )}

        <div className='my-1 border-t dark:border-gray-800' role='separator' />

        <MenuItem
          icon={LogOut}
          label='登出'
          onClick={handleLogout}
          className='text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20'
        />

        <div className='my-1 border-t dark:border-gray-800' role='separator' />

        <button
          onClick={() => {
            setIsOpen(false);
            setShowVersion(true);
          }}
          className='w-full py-2 text-xs text-center text-gray-400 hover:text-gray-600 flex items-center justify-center gap-2 transition-colors'
          role='menuitem'
        >
          v{CURRENT_VERSION}
          {updateStatus === UpdateStatus.HAS_UPDATE && (
            <span className='w-2 h-2 rounded-full bg-yellow-500' />
          )}
        </button>
      </div>
    </div>
  );

  return (
    <>
      <div className='relative'>
        <button
          ref={buttonRef}
          onClick={() => setIsOpen(!isOpen)}
          className='w-10 h-10 rounded-full flex items-center justify-center hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors focus:outline-none focus:ring-2 focus:ring-gray-200 dark:focus:ring-gray-700'
          aria-haspopup='menu'
          aria-expanded={isOpen}
          aria-label='User Menu'
        >
          <User className='w-6 h-6 text-gray-600 dark:text-gray-300' />
          {updateStatus === UpdateStatus.HAS_UPDATE && (
            <span className='absolute top-0 right-0 w-2.5 h-2.5 bg-yellow-500 rounded-full border-2 border-white dark:border-black' />
          )}
        </button>
      </div>

      {mounted && isOpen && createPortal(menuPanel, document.body)}

      {mounted && showSettings && (
        <SettingsModal
          isOpen={showSettings}
          onClose={() => setShowSettings(false)}
        />
      )}

      {mounted && showPassword && (
        <ChangePasswordModal
          isOpen={showPassword}
          onClose={() => setShowPassword(false)}
          onLogout={handleLogout}
        />
      )}

      {mounted && (
        <VersionPanel
          isOpen={showVersion}
          onClose={() => setShowVersion(false)}
        />
      )}
    </>
  );
};
