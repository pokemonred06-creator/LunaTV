import { NextRequest, NextResponse } from 'next/server';

import { getConfig } from '@/lib/config';
import { guardedFetch } from '@/lib/guarded-fetch';
import { safeImageResponse } from '@/lib/safe-image';
import { validateSafeUrl } from '@/lib/ssrf-guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// SSRF protection is provided by the shared ssrf-guard module (imported above).

async function fetchWithValidatedRedirects(
  initialUrl: string,
  init: RequestInit,
  maxHops = 5,
): Promise<Response> {
  let current = initialUrl;
  for (let hop = 0; hop <= maxHops; hop++) {
    if (!(await validateSafeUrl(current)))
      throw new Error(`SSRF Blocked: ${current}`);

    const res = await guardedFetch(current, { ...init, redirect: 'manual' });
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location');
      if (!loc) return res;
      await res.body?.cancel();
      try {
        current = new URL(loc, current).toString();
        continue;
      } catch {
        throw new Error('Invalid redirect');
      }
    }
    return res;
  }
  throw new Error('Too many redirects');
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const url = searchParams.get('url');

  if (!url) {
    return new NextResponse('Missing url parameter', { status: 400 });
  }

  // Validate URL format early (raw input)
  try {
    new URL(url);
  } catch {
    return new NextResponse('Invalid URL', { status: 400 });
  }

  let targetUrl = url;
  const upstreamHeaders: Record<string, string> = {
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    Accept: 'image/*,*/*;q=0.8',
  };

  // Douban blocks direct hotlink fetches and often returns 418. Use referer + optional custom proxy.
  if (targetUrl.includes('doubanio.com')) {
    upstreamHeaders['Referer'] = 'https://movie.douban.com/';

    try {
      const cfg = await getConfig();
      const proxyType =
        cfg?.SiteConfig?.DoubanImageProxyType || 'cmliussss-cdn-tencent';
      const proxyBase = cfg?.SiteConfig?.DoubanImageProxy;

      if (proxyType === 'custom' && proxyBase) {
        // proxyBase is expected to be a prefix like "https://example.com/?url=".
        targetUrl = `${proxyBase}${encodeURIComponent(targetUrl)}`;
      } else if (proxyType && proxyType.startsWith('cmliussss')) {
        targetUrl = targetUrl.replace(
          /img\d+\.doubanio\.com/g,
          'img.doubanio.cmliussss.net',
        );
      }
    } catch {
      // Ignore config load errors and use original douban URL with referer.
    }
  }

  try {
    const upstreamRes = await fetchWithValidatedRedirects(
      targetUrl,
      { headers: upstreamHeaders, cache: 'default' },
      5,
    );

    if (!upstreamRes.ok) {
      return new NextResponse(`Upstream Error: ${upstreamRes.status}`, {
        status: upstreamRes.status,
      });
    }

    return safeImageResponse(upstreamRes);
  } catch (e: unknown) {
    const errorMessage = e instanceof Error ? e.message : String(e);
    console.error('[Image Proxy Error]', errorMessage, url);
    const status = errorMessage.includes('SSRF') ? 403 : 500;
    return new NextResponse(errorMessage || 'Internal Proxy Error', { status });
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Range',
      'Access-Control-Max-Age': '86400',
    },
  });
}
