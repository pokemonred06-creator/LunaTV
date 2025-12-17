import { NextRequest, NextResponse } from 'next/server';
import { getConfig } from '@/lib/config';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const url = request.nextUrl.searchParams.get('url');
  if (!url) {
    return new NextResponse('Missing url parameter', { status: 400 });
  }

  // 1. SSRF Protect: Allowlist domains
  try {
    const targetUrl = new URL(url);
    const allowedDomains = ['doubanio.com', 'douban.com', 'img1.doubanio.com', 'img2.doubanio.com', 'img3.doubanio.com', 'img9.doubanio.com'];
    
    // Add logic to allow custom proxy hosts if needed, but for now strict allowlist is safer.
    // Since the original code logic was specifically targeting Douban images, this is appropriate.
    // If the user uses a custom image proxy in settings, the frontend usually constructs that URL directly
    // and might not hit this internal proxy unless configured to "Server Proxy".
    
    if (!allowedDomains.some(d => targetUrl.hostname.endsWith(d))) {
       // Check if it matches the configured proxy if available? 
       // For security, let's start strict.
       return new NextResponse('Forbidden Domain', { status: 403 });
    }
  } catch (e) {
    return new NextResponse('Invalid URL', { status: 400 });
  }

  const config = await getConfig();
  let proxyUrl = url;

  // Simple substitution if proxy is configured (Keep existing logic but ensure safety)
  if (config.SiteConfig.DoubanImageProxyType === 'custom' && config.SiteConfig.DoubanImageProxy) {
      if (url.includes('doubanio.com')) {
          try {
              // Safe construction already present in previous code, but let's keep it simple
              proxyUrl = `${config.SiteConfig.DoubanImageProxy}${encodeURIComponent(url)}`;
          } catch (e) {
              console.error('Invalid proxy URL configuration', e);
          }
      }
  }

  try {
    const headers = new Headers();
    headers.set('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');
    headers.set('Referer', 'https://movie.douban.com/');

    const response = await fetch(proxyUrl, { headers });

    if (!response.ok) {
        return new NextResponse(`Failed to fetch image: ${response.status} ${response.statusText}`, { status: response.status });
    }

    const contentType = response.headers.get('content-type') || 'image/jpeg';
    
    // 2. OOM Fix: Zero-copy streaming
    const cacheTTL = config.SiteConfig.ImageCacheTTL || 30; 
    const maxAgeSeconds = cacheTTL * 24 * 60 * 60;

    return new NextResponse(response.body, {
      headers: {
        'Content-Type': contentType,
        'Cache-Control': `public, max-age=${maxAgeSeconds}, immutable`,
      },
      status: response.status
    });

  } catch (error) {
    console.error('Image proxy error:', error);
    return new NextResponse('Internal Server Error', { status: 500 });
  }
}