import { NextRequest } from 'next/server';

import { GET as proxyStream } from '@/app/api/proxy/[type]/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  // Detection uses the exact same redirects, headers and target validation as playback.
  const target = new URL('/api/proxy/ts', request.url);
  target.search = request.nextUrl.search;
  target.searchParams.set('probe', '1');
  return proxyStream(
    new NextRequest(target, {
      signal: request.signal,
      headers: request.headers,
    }),
    {
      params: Promise.resolve({ type: 'ts' }),
    },
  );
}
