/* eslint-disable @typescript-eslint/no-explicit-any */

import { NextRequest, NextResponse } from 'next/server';

import { getConfig } from '@/lib/config';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const url = searchParams.get('url');
  const source = searchParams.get('moontv-source');

  if (!url) {
    return NextResponse.json({ error: 'Missing url' }, { status: 400 });
  }
  const config = await getConfig();
  const liveSource = config.LiveConfig?.find((s: any) => s.key === source);
  if (!liveSource) {
    return NextResponse.json({ error: 'Source not found' }, { status: 404 });
  }
  const ua = liveSource.ua || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

  try {
    const decodedUrl = decodeURIComponent(url);

    let currentUrl = decodedUrl;
    let cookie = '';
    let response;
    let redirectCount = 0;
    const maxRedirects = 5;

    // Inject Referer for Huya mainly
    const extraHeaders: Record<string, string> = {};
    if (url?.includes('huya') || url?.includes('douzhicloud')) {
        extraHeaders['Referer'] = 'https://www.huya.com/';
    }

    while (redirectCount < maxRedirects) {
      response = await fetch(currentUrl, {
        cache: 'no-cache',
        redirect: 'manual',
        credentials: 'same-origin',
        headers: {
          'User-Agent': ua,
          ...extraHeaders,
          ...(cookie ? { Cookie: cookie } : {}),
        },
      });

      const setCookie = response.headers.get('set-cookie');
      if (setCookie) {
        // Simple cookie handling: just use the new cookies. 
        // For distinct cookies merging, we'd need a parser, but this usually suffices for redirects.
        cookie = setCookie; 
      }

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');
        if (location) {
          currentUrl = new URL(location, currentUrl).toString();
          redirectCount++;
          continue;
        }
      }
      
      // If 403, we might want to return success=false but with specific error?
      // But standard logic handles !response.ok below.
      break;
    }

    if (!response || !response.ok) {
      // If it's 403, we might fail here.
      // But if we can't fetch it, we can't identify it.
      // Maybe return 'flv' by default if we suspect it's FLV due to URL?
      // Only for huya/douzhicloud if we know?
      // For now, return error as usual.
      return NextResponse.json({ error: 'Failed to fetch', message: response?.statusText || 'Unknown' }, { status: 500 });
    }

    const contentType = response.headers.get('Content-Type');
    if (response.body) {
      response.body.cancel();
    }
    if (contentType?.includes('video/mp4')) {
      return NextResponse.json({ success: true, type: 'mp4' }, { status: 200 });
    }
    if (contentType?.includes('video/x-flv')) {
      return NextResponse.json({ success: true, type: 'flv' }, { status: 200 });
    }
    return NextResponse.json({ success: true, type: 'm3u8' }, { status: 200 });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to fetch', message: error }, { status: 500 });
  }
}