import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth/server';

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
    '/api/proxy',
    '/api/image-proxy',
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

export async function middleware(request: NextRequest) {
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

  // DEBUG HELPER - Always log (Reduced verbosity)
  /*
  console.log('[Middleware] Request:', request.nextUrl.pathname);
  const authCookie = request.cookies.get('auth');
  console.log('[Middleware] Cookie Present:', !!authCookie);
  if (authCookie) {
     console.log('[Middleware] Cookie Val Len:', authCookie.value.length);
  }
  console.log('[Middleware] Auth Info Result:', JSON.stringify(authInfo));
  console.log('[Middleware] Env Password Len:', process.env.PASSWORD?.length);
  */

  if (!authInfo) {
    console.log(
      '[Proxy] Auth Failed in Middleware for:',
      request.nextUrl.pathname,
    );
    return handleAuthFailure(request);
  }

  // 4. Session Check for Protected Areas (Dashboard/Admin)
  const isProtectedRoute =
    pathname.startsWith('/dashboard') || pathname.startsWith('/admin');

  if (isProtectedRoute) {
    // If we have valid authInfo (Legacy/Standard Auth), allow access.
    // Only enforce session_id if authInfo is missing (which is handled above) or strict mode is enabled in future.
    if (authInfo) {
      return NextResponse.next();
    }

    // Fallback: If no authInfo, definitely redirect (though handled by block 3)
    const sessionCookie = request.cookies.get('session_id');
    if (!sessionCookie) {
      return NextResponse.redirect(new URL('/login', request.url));
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
