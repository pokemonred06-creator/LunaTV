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
    return handleAuthFailure(request);
  }

  // 4. Session Check for Protected Areas (Dashboard/Admin) - The new architecture
  const isProtectedRoute =
    pathname.startsWith('/dashboard') || pathname.startsWith('/admin');

  if (isProtectedRoute) {
    // For now, if we are already authenticated via global auth (authInfo),
    // we might consider that enough, OR we enforce the new session_id.
    // The user request implied moving to session_id for these areas.
    // Let's check session_id as well if strict.
    const sessionCookie = request.cookies.get('session_id');
    if (!sessionCookie) {
      // If they have global auth but no session, maybe we generate one?
      // Or just redirect to login?
      // For now, let's strictly redirect if session is missing for dashboard
      return NextResponse.redirect(new URL('/login', request.url));
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
