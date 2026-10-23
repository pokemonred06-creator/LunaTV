import type { NextRequest } from 'next/server';
import { createHmac, timingSafeEqual } from 'node:crypto';

import { getAuthInfoFromCookie, isActiveUsername } from '@/lib/auth/server';
import { getAvailableLiveSources } from '@/lib/config';

const lifetime = 7 * 24 * 60 * 60 * 1000;

function signature(url: URL): string {
  const secret =
    process.env.PROXY_SECRET || process.env.AUTH_SECRET || process.env.PASSWORD;
  if (!secret) throw new Error('Media signing secret is required');
  const query = new URLSearchParams(url.search);
  query.delete('media-sign');
  query.sort();
  return createHmac('sha256', secret)
    .update(`media-v1\n${url.pathname}\n${query}`)
    .digest('hex');
}

export function signMediaUrl(
  raw: string,
  username: string,
  expires = Date.now() + lifetime,
): string {
  const url = new URL(raw, 'http://media.local');
  url.searchParams.set('media-user', username);
  url.searchParams.set('media-expires', String(expires));
  url.searchParams.set('media-sign', signature(url));
  return /^https?:\/\//.test(raw)
    ? url.toString()
    : `${url.pathname}${url.search}`;
}

export async function authorizeMediaRequest(
  request: NextRequest,
): Promise<{ username: string; expires: number } | null> {
  const url = new URL(request.url);
  const query = url.searchParams;
  let username: string;
  let expires: number;
  if (query.has('media-sign')) {
    username = query.get('media-user') || '';
    expires = Number(query.get('media-expires'));
    if (
      !username ||
      !Number.isSafeInteger(expires) ||
      expires <= Date.now() ||
      expires > Date.now() + lifetime + 60_000
    )
      return null;
    const actual = query.get('media-sign') || '';
    const expected = signature(url);
    if (
      !/^[a-f0-9]{64}$/.test(actual) ||
      !timingSafeEqual(Buffer.from(actual), Buffer.from(expected))
    )
      return null;
    if (!(await isActiveUsername(username))) return null;
  } else {
    const auth = await getAuthInfoFromCookie(request);
    if (!auth?.username || typeof auth.timestamp !== 'number') return null;
    username = auth.username;
    expires = auth.timestamp + lifetime;
  }
  const source = query.get('moontv-source');
  if (
    source &&
    !(await getAvailableLiveSources(username)).some(
      (entry) => entry.key === source,
    )
  )
    return null;
  return { username, expires };
}
