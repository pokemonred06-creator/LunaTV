
import { NextRequest, NextResponse } from 'next/server';
import { getConfig } from '@/lib/config';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const url = searchParams.get('url');

  if (!url) {
    return new NextResponse('Missing url parameter', { status: 400 });
  }

  try {
    const config = await getConfig();
    let targetUrl = url;

    // Apply Douban Proxy logic
    if (url.includes('doubanio.com')) {
      const { DoubanImageProxyType, DoubanImageProxy } = config.SiteConfig;

      if (DoubanImageProxyType === 'custom' && DoubanImageProxy) {
        targetUrl = DoubanImageProxy + encodeURIComponent(url);
      } else if (DoubanImageProxyType && DoubanImageProxyType.startsWith('cmliussss')) {
        // Use cmliussss mirror
        targetUrl = url.replace(/img\d+\.doubanio\.com/, 'img.doubanio.cmliussss.net');
      } else if (DoubanImageProxyType === 'direct') {
         // Direct fetch, do nothing (but risk rate limit)
      } else {
        // Default fallback to cmliussss if not configured specifically to direct
         targetUrl = url.replace(/img\d+\.doubanio\.com/, 'img.doubanio.cmliussss.net');
      }
    }

    let response = await fetch(targetUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        'Referer': '' // Important for Douban
      }
    });

    // Fallback logic: If proxy/CDN fails, try direct fetch
    if (!response.ok && targetUrl !== url) {
      console.warn(`[Image Proxy] Failed to fetch from ${targetUrl} (${response.status}), trying fallback to ${url}`);
      try {
        const fallbackResponse = await fetch(url, {
           headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
            'Referer': '' 
          }
        });
        if (fallbackResponse.ok) {
          response = fallbackResponse;
        }
      } catch (e) {
        console.error('[Image Proxy] Fallback failed:', e);
      }
    }

    if (!response.ok) {
      return new NextResponse(`Failed to fetch image: ${response.status}`, { status: response.status });
    }

    const contentType = response.headers.get('content-type') || 'application/octet-stream';
    const buffer = await response.arrayBuffer();

    // Cache control
    const headers = new Headers();
    headers.set('Content-Type', contentType);
    // Cache for 1 year
    headers.set('Cache-Control', 'public, max-age=31536000, immutable');
    // Add CORS headers just in case
    headers.set('Access-Control-Allow-Origin', '*');
    headers.set('Access-Control-Allow-Methods', 'GET, OPTIONS');

    return new NextResponse(buffer, {
      headers
    });
  } catch (error) {
    console.error('Image proxy error:', error);
    return new NextResponse('Internal Server Error', { status: 500 });
  }
}
