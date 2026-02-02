import { cookies } from 'next/headers';

import { parseAndVerifyAuthCookie } from './edge';
import { type AuthInfo } from './types';

// Re-export edge-compatible functions for convenience (though middleware should import from edge.ts directly)
export { calculateSignature, getAuthInfoFromCookie } from './edge';

/** Server Components: read `auth` cookie (Uses next/headers) */
export async function getAuthSession(): Promise<AuthInfo | null> {
  const cookieStore = await cookies();
  const raw = cookieStore.get('auth')?.value;
  return raw ? await parseAndVerifyAuthCookie(raw) : null;
}
