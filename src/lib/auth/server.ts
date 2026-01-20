import { cookies } from 'next/headers';
import type { NextRequest } from 'next/server';
import { createHmac, timingSafeEqual } from 'node:crypto';

import { safeMaybeDoubleDecode } from './shared';
import { type AuthInfo, ROLE_SET } from './types';

/**
 * Centralized signature generator.
 * Import this in your /api/login route to ensure consistency.
 */
export function calculateSignature(
  username: string,
  role: string,
  timestamp: number,
): string {
  const secret = process.env.AUTH_SECRET || process.env.PASSWORD || '';
  // Data format: "user:role:123456789"
  const data = `${username}:${role}:${timestamp}`;
  return createHmac('sha256', secret).update(data).digest('hex');
}

function safeCompare(a: string, b: string): boolean {
  if (!a || !b) return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/** Server-side: read HttpOnly `auth` cookie */
export function getAuthInfoFromCookie(req: NextRequest): AuthInfo | null {
  const raw = req.cookies.get('auth')?.value;
  return raw ? parseAndVerifyAuthCookie(raw) : null;
}

/** Server Components: read `auth` cookie */
/** Server Components: read `auth` cookie */
export async function getAuthSession(): Promise<AuthInfo | null> {
  const cookieStore = await cookies();
  const raw = cookieStore.get('auth')?.value;
  return raw ? parseAndVerifyAuthCookie(raw) : null;
}

function parseAndVerifyAuthCookie(rawCookie: string): AuthInfo | null {
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
      // Use the exact same function as the login route
      const expected = calculateSignature(username, role, timestamp);
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
