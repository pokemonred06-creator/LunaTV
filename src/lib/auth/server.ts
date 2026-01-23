import { cookies } from 'next/headers';
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

/** Server-side: read HttpOnly `auth` cookie (Async for WebCrypto) */
export async function getAuthInfoFromCookie(
  req: NextRequest,
): Promise<AuthInfo | null> {
  const raw = req.cookies.get('auth')?.value;
  return raw ? await parseAndVerifyAuthCookie(raw) : null;
}

/** Server Components: read `auth` cookie */
export async function getAuthSession(): Promise<AuthInfo | null> {
  const cookieStore = await cookies();
  const raw = cookieStore.get('auth')?.value;
  return raw ? await parseAndVerifyAuthCookie(raw) : null;
}

async function parseAndVerifyAuthCookie(
  rawCookie: string,
): Promise<AuthInfo | null> {
  try {
    const decoded = safeMaybeDoubleDecode(rawCookie);
    const val = JSON.parse(decoded);

    const username =
      typeof val?.username === 'string' ? val.username : undefined;
    const role = val?.role;
    const timestamp =
      typeof val?.timestamp === 'number' ? val.timestamp : undefined;
    const signature =
      typeof val?.signature === 'string' ? val.signature : undefined;

    if (!username || !ROLE_SET.has(role)) return null;

    // Strict Verification
    if (signature && timestamp) {
      const expected = await calculateSignature(username, role, timestamp);
      if (!safeCompare(signature, expected)) {
        console.warn('[Auth] Signature mismatch for user:', username);
        return null;
      }
    } else {
      // Optional: Reject unsigned cookies in strict mode
      // return null;
    }

    return { username, role, timestamp, signature };
  } catch {
    return null;
  }
}
