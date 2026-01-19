import { NextRequest } from 'next/server';

// 从cookie获取认证信息 (服务端使用)
export function getAuthInfoFromCookie(request: NextRequest): {
  password?: string;
  username?: string;
  signature?: string;
  timestamp?: number;
} | null {
  const authCookie = request.cookies.get('auth');

  if (!authCookie) {
    return null;
  }

  try {
    let decoded = decodeURIComponent(authCookie.value);
    // If it's still encoded, decode again (handles double encoding from some clients)
    if (decoded.includes('%')) {
      decoded = decodeURIComponent(decoded);
    }
    const authData = JSON.parse(decoded);
    return authData;
  } catch (error) {
    return null;
  }
}

// 从cookie获取认证信息 (客户端使用)
export interface AuthInfo {
  username?: string;
  role?: 'owner' | 'admin' | 'user';
  timestamp?: number;
}

export function getAuthInfoFromBrowserCookie(): AuthInfo | null {
  if (typeof document === 'undefined') return null;

  // Look for the PUBLIC UI cookie "auth-user"
  const match = document.cookie.match(/(?:^|;\s*)auth-user=([^;]+)/);
  if (!match) return null;

  try {
    const val = JSON.parse(decodeURIComponent(match[1]));
    if (!val?.username || !val?.role) return null;
    return val as AuthInfo;
  } catch {
    return null;
  }
}
