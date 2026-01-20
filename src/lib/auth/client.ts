import { safeMaybeDoubleDecode } from './shared';
import { AuthInfo, ROLE_SET } from './types';

function getCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const prefix = `${name}=`;

  // Robust loop is safer than regex for edge-case characters
  const parts = document.cookie.split('; ');
  for (const part of parts) {
    if (part.startsWith(prefix)) return part.slice(prefix.length);
  }
  return null;
}

export function getAuthInfoFromBrowserCookie(): AuthInfo | null {
  const raw = getCookie('auth-user');
  if (!raw) return null;

  try {
    const decoded = safeMaybeDoubleDecode(raw);
    const val = JSON.parse(decoded);

    const username =
      typeof val?.username === 'string' ? val.username : undefined;
    const role = val?.role;

    // Strict validation prevents UI hydration errors
    if (!username || !ROLE_SET.has(role)) return null;

    return {
      username,
      role,
      timestamp: typeof val?.timestamp === 'number' ? val.timestamp : undefined,
    };
  } catch {
    return null;
  }
}
