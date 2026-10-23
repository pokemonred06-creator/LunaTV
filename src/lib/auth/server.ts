import { cookies, headers } from 'next/headers';
import type { NextRequest } from 'next/server';

import { getConfig } from '@/lib/config';

import {
  getAuthInfoFromCookie as readCookie,
  parseAndVerifyAuthCookie,
} from './edge';
import { isOwnerUsername } from './shared';
import { type AuthInfo } from './types';

// Re-export edge-compatible functions for convenience (though middleware should import from edge.ts directly)
export { calculateSignature } from './edge';

export async function isActiveUsername(username: string): Promise<boolean> {
  if (isOwnerUsername(username)) return true;
  if (username === 'e2e_test_visitor' && process.env.NODE_ENV !== 'production')
    return true;
  const config = await getConfig();
  const user = config.UserConfig.Users.find(
    (user) => user.username === username,
  );
  return !!user && !user.banned;
}

export async function getAuthInfoFromCookie(
  req: NextRequest,
): Promise<AuthInfo | null> {
  const auth = await readCookie(req);
  return auth?.username &&
    typeof auth.timestamp === 'number' &&
    (await isActiveUsername(auth.username))
    ? auth
    : null;
}

/** Server Components: read `auth` cookie (Uses next/headers) */
export async function getAuthSession(): Promise<AuthInfo | null> {
  const headersStore = await headers();
  const bypassHeader = headersStore.get('x-e2e-bypass');
  if (bypassHeader === 'true' && process.env.NODE_ENV !== 'production') {
    return {
      username: 'e2e_test_visitor',
      role: 'user',
      timestamp: Date.now(),
      signature: 'dummy_sig',
    };
  }

  const cookieStore = await cookies();
  const raw = cookieStore.get('auth')?.value;
  const auth = raw ? await parseAndVerifyAuthCookie(raw) : null;
  return auth?.username &&
    typeof auth.timestamp === 'number' &&
    (await isActiveUsername(auth.username))
    ? auth
    : null;
}
