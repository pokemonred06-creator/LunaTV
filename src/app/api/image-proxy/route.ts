import { NextRequest, NextResponse } from 'next/server';
import dns from 'node:dns/promises';
import net from 'node:net';

import { getConfig } from '@/lib/config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Block private/internal IP ranges to prevent SSRF
const BLOCKED_RANGES_IPV4 = [
  '0.0.0.0/8',
  '10.0.0.0/8',
  '100.64.0.0/10',
  '127.0.0.0/8',
  '169.254.0.0/16',
  '172.16.0.0/12',
  '192.0.0.0/24',
  '192.0.2.0/24',
  '192.168.0.0/16',
  // '198.18.0.0/15', // Allowed for Clash FakeIP routes
  '224.0.0.0/4',
  '240.0.0.0/4',
];

function isIpInCidr(ip: string, cidr: string): boolean {
  const [range, bits = '32'] = cidr.split('/');
  const mask = ~(2 ** (32 - parseInt(bits, 10)) - 1);
  if (net.isIPv4(ip) && net.isIPv4(range)) {
    const ipLong =
      ip
        .split('.')
        .reduce((acc, octet) => (acc << 8) + parseInt(octet, 10), 0) >>> 0;
    const rangeLong =
      range
        .split('.')
        .reduce((acc, octet) => (acc << 8) + parseInt(octet, 10), 0) >>> 0;
    return (ipLong & mask) === (rangeLong & mask);
  }
  return false;
}

function isLocalIPv6(ip: string): boolean {
  const normalized = ip.toLowerCase();
  // Loopback
  if (normalized === '::1' || normalized === '0:0:0:0:0:0:0:1') return true;
  // Unique Local Addresses (ULA)
  if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true;
  // Link-local
  if (/^fe[89ab]/i.test(normalized)) return true;
  return false;
}

async function validateSafeUrl(urlStr: string): Promise<boolean> {
  try {
    const u = new URL(urlStr);
    if (!['http:', 'https:'].includes(u.protocol)) return false;
    const ipType = net.isIP(u.hostname);
    if (ipType === 4)
      return !BLOCKED_RANGES_IPV4.some((cidr) => isIpInCidr(u.hostname, cidr));
    if (ipType === 6) {
      const rawIp = u.hostname.replace(/\[|\]/g, '');
      return !isLocalIPv6(rawIp);
    }
    const addrs = await dns.lookup(u.hostname, { all: true, verbatim: true });
    return !addrs.some((a) => {
      if (a.family === 4)
        return BLOCKED_RANGES_IPV4.some((cidr) => isIpInCidr(a.address, cidr));
      if (a.family === 6) return isLocalIPv6(a.address);
      return false;
    });
  } catch {
    return false;
  }
}

async function fetchWithValidatedRedirects(
  initialUrl: string,
  init: RequestInit,
  maxHops = 5,
): Promise<Response> {
  let current = initialUrl;
  for (let hop = 0; hop <= maxHops; hop++) {
    if (!(await validateSafeUrl(current)))
      throw new Error(`SSRF Blocked: ${current}`);

    const res = await fetch(current, { ...init, redirect: 'manual' });
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location');
      if (!loc) return res;
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

  // Forward range header if present (for partial content requests)
  const rangeHeader = request.headers.get('range');
  if (rangeHeader) {
    upstreamHeaders['Range'] = rangeHeader;
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

    const responseHeaders = new Headers();
    responseHeaders.set('Access-Control-Allow-Origin', '*');
    responseHeaders.set('Access-Control-Allow-Methods', 'GET, OPTIONS');

    // Pass through relevant headers
    [
      'content-type',
      'content-length',
      'content-range',
      'accept-ranges',
      'cache-control',
      'expires',
      'etag',
      'last-modified',
    ].forEach((h) => {
      const v = upstreamRes.headers.get(h);
      if (v) responseHeaders.set(h, v);
    });

    // Cache images for 1 day if no cache-control is set
    if (!upstreamRes.headers.get('cache-control')) {
      responseHeaders.set('Cache-Control', 'public, max-age=86400');
    }

    return new NextResponse(upstreamRes.body, {
      status: upstreamRes.status,
      headers: responseHeaders,
    });
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
