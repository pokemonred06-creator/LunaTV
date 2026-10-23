import type { NextRequest } from 'next/server';

import { safeMaybeDoubleDecode } from './shared';
import { type AuthInfo, ROLE_SET } from './types';

/**
 * Centralized signature generator (WebCrypto).
 */
export async function calculateSignature(
  username: string,
  role: string,
  timestamp: number,
): Promise<string> {
  const secret = process.env.AUTH_SECRET || process.env.PASSWORD || '';

  // Fail-fast: empty secret means signatures are trivially forgeable
  if (!secret) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        'Fatal: AUTH_SECRET or PASSWORD must be set in production',
      );
    }
    console.warn(
      '[Auth] WARNING: No AUTH_SECRET or PASSWORD set. Signatures will be insecure.',
    );
  }

  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );

  const data = `${username}:${role}:${timestamp}`;
  const signatureBuffer = await crypto.subtle.sign(
    'HMAC',
    key,
    encoder.encode(data),
  );

  // Convert buffer to hex string
  return Array.from(new Uint8Array(signatureBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function safeCompare(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

async function parseAndVerifyAuthCookie(
  rawCookie: string,
): Promise<AuthInfo | null> {
  try {
    // console.log('[Auth] Verifying cookie raw len:', rawCookie.length);
    const decoded = safeMaybeDoubleDecode(rawCookie);
    const val = JSON.parse(decoded);
    // console.log('[Auth] Decoded:', JSON.stringify(val));

    const username =
      typeof val?.username === 'string' ? val.username : undefined;
    const role = val?.role;
    const timestamp =
      typeof val?.timestamp === 'number' ? val.timestamp : undefined;
    const signature =
      typeof val?.signature === 'string' ? val.signature : undefined;

    if (!username || !ROLE_SET.has(role)) {
      /*
      console.log('[Auth] Invalid structure or missing username/role', {
        username,
        role,
      });
      */
      return null;
    }

    // Strict Verification - reject unsigned cookies
    const now = Date.now();
    const maxAge = 7 * 24 * 60 * 60 * 1000;
    if (
      !signature ||
      !Number.isSafeInteger(timestamp) ||
      timestamp === undefined ||
      timestamp <= 0 ||
      timestamp > now + 60_000 ||
      now - timestamp >= maxAge
    ) {
      console.warn('[Auth] Unsigned cookie rejected for user:', username);
      return null;
    }

    const expected = await calculateSignature(username, role, timestamp);
    if (!safeCompare(signature, expected)) {
      console.warn('[Auth] Signature mismatch for user:', username);
      return null;
    }

    // console.log('[Auth] Verification Success:', username);
    return { username, role, timestamp, signature };
  } catch (err) {
    console.error('[Auth] Parse Error:', err);
    return null;
  }
}

/** Server-side: read HttpOnly `auth` cookie (Async for WebCrypto) */
export async function getAuthInfoFromCookie(
  req: NextRequest,
): Promise<AuthInfo | null> {
  const bypassHeader = req.headers.get('x-e2e-bypass');
  if (bypassHeader === 'true' && process.env.NODE_ENV !== 'production') {
    return {
      username: 'e2e_test_visitor',
      role: 'user',
      timestamp: Date.now(),
      signature: 'dummy_sig',
    };
  }

  const raw = req.cookies.get('auth')?.value;
  // No cookie found is normal for initial visits
  return raw ? await parseAndVerifyAuthCookie(raw) : null;
}

// Export for Server Component Usage (server.ts)
export { parseAndVerifyAuthCookie };
