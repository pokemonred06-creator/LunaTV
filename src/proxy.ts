import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth/edge';

// 判断是否需要跳过认证的路径
function shouldSkipAuth(pathname: string): boolean {
  const skipPaths = [
    '/_next',
    '/favicon.ico',
    '/robots.txt',
    '/manifest.json',
    '/icons/',
    '/logo.png',
    '/screenshot.png',
    '/login',
    '/warning',
    '/api/login',
    '/api/register',
    '/api/logout',
    '/api/cron',
    '/api/server-config',
    '/api/auth/verify', // Allow magic link verification
    '/api/seasonal-effects',
    '/api/proxy/', // Go proxy handles its own HMAC auth
    '/api/image-proxy', // Image proxy has SSRF validation
    '/api/live/precheck', // Stream type detection
    '/api/live/m3u', // IPTV clients (e.g., Orion) cannot send site auth cookies
  ];

  return skipPaths.some((path) => pathname.startsWith(path));
}

function handleAuthFailure(request: NextRequest): NextResponse {
  if (request.nextUrl.pathname.startsWith('/api')) {
    return new NextResponse('Unauthorized', { status: 401 });
  }
  const loginUrl = new URL('/login', request.url);
  loginUrl.searchParams.set(
    'redirect',
    request.nextUrl.pathname + request.nextUrl.search,
  );
  return NextResponse.redirect(loginUrl);
}

// Next.js 16+ proxy entrypoint (formerly middleware)
export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // 1. Skip Auth for public paths
  if (shouldSkipAuth(pathname)) {
    return NextResponse.next();
  }

  // 2. Global Password Check (Legacy/Site-wide protection)
  if (!process.env.PASSWORD) {
    return NextResponse.redirect(new URL('/warning', request.url));
  }

  // 3. Authenticate User (Check for generic 'auth' cookie from server.ts)
  const authInfo = await getAuthInfoFromCookie(request);

  if (!authInfo) {
    // Auth failed
    return handleAuthFailure(request);
  }

  // 4. Session Check for Protected Areas (Dashboard/Admin)
  const isProtectedRoute =
    pathname.startsWith('/dashboard') || pathname.startsWith('/admin');

  if (isProtectedRoute) {
    // Already authenticated by the earlier authInfo check.
    return NextResponse.next();
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};

// Next.js 16 requires either default export or named 'proxy' export
export default proxy;
