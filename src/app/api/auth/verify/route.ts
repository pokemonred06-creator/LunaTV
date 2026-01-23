import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { NextRequest, NextResponse } from 'next/server';

import { ServerCrypto } from '@/lib/crypto';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const token = searchParams.get('token');

  if (!process.env.AUTH_SECRET) {
    console.error('AUTH_SECRET is not defined');
    return new NextResponse('Internal Server Error', { status: 500 });
  }

  // 1. Decrypt & Verify
  const payload = await ServerCrypto.decrypt<{ email: string; type: string }>(
    token || '',
    process.env.AUTH_SECRET,
  );

  if (!payload || payload.type !== 'magic-link') {
    return new NextResponse('Invalid or expired link', { status: 401 });
  }

  // 2. Success! Create a Session
  // You can use a different secret for the session if you want, or the same one.
  // Sessions are usually valid for much longer (e.g., 7 days).
  const sessionToken = await ServerCrypto.encrypt(
    { sub: payload.email, role: 'user' },
    process.env.AUTH_SECRET,
    7 * 24 * 60 * 60, // 7 days
  );

  // 3. Set HTTP-Only Cookie
  const cookieStore = await cookies();
  cookieStore.set('session_id', sessionToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 7 * 24 * 60 * 60,
  });

  redirect('/dashboard');
}
