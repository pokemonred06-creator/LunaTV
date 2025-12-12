import { NextRequest, NextResponse } from 'next/server';
import { getConfig } from '@/lib/config';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const url = request.nextUrl.searchParams.get('url');
  if (!url) {
    return new NextResponse('Missing url parameter', { status: 400 });
  }

  const config = await getConfig();
  let proxyUrl = url;

  // Simple substitution if proxy is configured
  // Note: Real-world implementation might need more complex logic
  if (config.SiteConfig.DoubanImageProxyType === 'custom' && config.SiteConfig.DoubanImageProxy) {
      if (url.includes('doubanio.com')) {
          // Attempt to replace host if it's a simple mirror
          // This is a naive implementation
          try {
              const u = new URL(url);
              const proxyBase = new URL(config.SiteConfig.DoubanImageProxy);
              // Construct new URL using proxy host
              // Example: https://img9.doubanio.com/... -> https://myproxy.com/...
              // OR https://myproxy.com/view/photo/...
              
              // Here we assume the proxy is a prefix or replacement. 
              // Let's assume it replaces the hostname.
              // u.protocol = proxyBase.protocol;
              // u.host = proxyBase.host;
              // proxyUrl = u.toString();
              
              // Or if it's a prefix service:
              proxyUrl = `${config.SiteConfig.DoubanImageProxy}${encodeURIComponent(url)}`;
          } catch (e) {
              console.error('Invalid proxy URL configuration', e);
          }
      }
  }

  try {
    const headers = new Headers();
    headers.set('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');
    // Add Referer to bypass hotlink protection if needed
    headers.set('Referer', 'https://movie.douban.com/');

    const response = await fetch(proxyUrl, { headers });

    if (!response.ok) {
        return new NextResponse(`Failed to fetch image: ${response.status} ${response.statusText}`, { status: response.status });
    }

    const contentType = response.headers.get('content-type') || 'image/jpeg';
    const buffer = await response.arrayBuffer();

    // Cache Control
    const cacheTTL = config.SiteConfig.ImageCacheTTL || 30; // Default 30 days
    const maxAgeSeconds = cacheTTL * 24 * 60 * 60;

    return new NextResponse(buffer, {
      headers: {
        'Content-Type': contentType,
        'Cache-Control': `public, max-age=${maxAgeSeconds}, immutable`,
      },
    });

  } catch (error) {
    console.error('Image proxy error:', error);
    return new NextResponse('Internal Server Error', { status: 500 });
  }
}