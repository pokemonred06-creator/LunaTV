import { NextRequest, NextResponse } from 'next/server';
import dns from 'node:dns/promises';
import net from 'node:net';

import { getConfig } from '@/lib/config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

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
  '198.18.0.0/15',
  '224.0.0.0/4',
  '240.0.0.0/4',
];

const BLOCKED_RANGES_IPV6 = [
  '::/128',
  '::1/128',
  'fc00::/7',
  'fe80::/10',
  'ff00::/8',
  '2001:db8::/32',
];

const BLOCKLIST = new net.BlockList();
BLOCKED_RANGES_IPV4.forEach((cidr) => {
  const [range, bits] = cidr.split('/');
  BLOCKLIST.addSubnet(range, Number(bits), 'ipv4');
});
BLOCKED_RANGES_IPV6.forEach((cidr) => {
  const [range, bits] = cidr.split('/');
  BLOCKLIST.addSubnet(range, Number(bits), 'ipv6');
});

function isBlockedIp(ip: string): boolean {
  const family = net.isIP(ip);
  if (family === 4) return BLOCKLIST.check(ip, 'ipv4');
  if (family === 6) return BLOCKLIST.check(ip, 'ipv6');
  return true;
}

async function validateSafeUrl(urlStr: string) {
  try {
    const u = new URL(urlStr);
    if (!['http:', 'https:'].includes(u.protocol)) return false;
    const ipType = net.isIP(u.hostname);
    // Server is IPv4-only: reject literal IPv6 targets.
    if (ipType === 6) return false;
    if (ipType === 4) return !isBlockedIp(u.hostname);
    const addrs = await dns.lookup(u.hostname, { all: true, verbatim: true });
    if (!addrs.length) return false;

    // IPv4-only policy:
    // - allow when at least one public IPv4 exists
    // - reject if no IPv4 records are present
    const ipv4Addrs = addrs.filter((a) => a.family === 4);
    if (!ipv4Addrs.length) return false;
    return ipv4Addrs.some((a) => !isBlockedIp(a.address));
  } catch {
    return false;
  }
}

async function fetchWithValidatedRedirects(
  initialUrl: string,
  init: RequestInit,
  maxHops = 5,
) {
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

function proxyTypeForUrl(url: string): string {
  const path = new URL(url).pathname.toLowerCase();
  if (path.endsWith('.m3u8')) return 'm3u8';
  return 'ts'; // .ts, .aac, .key, etc. → stream directly
}

function rewriteM3U8(
  text: string,
  baseUrl: URL,
  proxyOrigin: string,
  sourceKey: string | null,
) {
  const out: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      // Handle #EXT-X-KEY or other URIs in tags
      if (trimmed.startsWith('#') && trimmed.includes('URI="')) {
        const rewritten = line.replace(/URI="([^"]+)"/g, (_, uri) => {
          try {
            const abs = new URL(uri, baseUrl);
            const pType = proxyTypeForUrl(abs.toString());
            const proxied = new URL(`/api/proxy/${pType}`, proxyOrigin);
            proxied.searchParams.set('url', abs.toString());
            if (sourceKey) proxied.searchParams.set('moontv-source', sourceKey);
            return `URI="${proxied.pathname}${proxied.search}"`;
          } catch {
            return `URI="${uri}"`;
          }
        });
        out.push(rewritten);
      } else {
        out.push(line);
      }
      continue;
    }

    try {
      const abs = new URL(trimmed, baseUrl);
      const pType = proxyTypeForUrl(abs.toString());
      const proxied = new URL(`/api/proxy/${pType}`, proxyOrigin);
      proxied.searchParams.set('url', abs.toString());
      if (sourceKey) proxied.searchParams.set('moontv-source', sourceKey);
      out.push(`${proxied.pathname}${proxied.search}`);
    } catch {
      out.push(line);
    }
  }
  return out.join('\n');
}

interface ProxyParams {
  params: Promise<{ type: string }>;
}

export async function GET(request: NextRequest, props: ProxyParams) {
  const params = await props.params;
  const type = (params.type || '').toLowerCase();
  const { searchParams } = new URL(request.url);
  const urlParam = searchParams.get('url') || '';
  const sourceKey = searchParams.get('moontv-source');

  if (!urlParam) return new NextResponse('Missing url', { status: 400 });
  let upstreamUrl: URL;
  try {
    upstreamUrl = new URL(urlParam);
  } catch {
    return new NextResponse('Invalid url', { status: 400 });
  }

  const config = await getConfig();
  const sourceConfig = config.LiveConfig?.find(
    (s: { key: string; ua?: string }) => s.key === sourceKey,
  );
  const ua =
    sourceConfig?.ua ||
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

  const upstreamHeaders: Record<string, string> = {
    'User-Agent': ua,
    Accept: '*/*',
  };

  if (request.headers.get('range'))
    upstreamHeaders['Range'] = request.headers.get('range')!;

  if (urlParam.includes('huya') || urlParam.includes('douzhicloud'))
    upstreamHeaders['Referer'] = 'https://www.huya.com/';
  else if (urlParam.includes('douyin'))
    upstreamHeaders['Referer'] = 'https://live.douyin.com/';
  else if (!upstreamHeaders['Referer'])
    upstreamHeaders['Referer'] = upstreamUrl.origin + '/';

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 12000);

  try {
    const upstreamRes = await fetchWithValidatedRedirects(
      urlParam,
      {
        headers: upstreamHeaders,
        cache: 'no-store',
        signal: controller.signal,
      },
      5,
    );

    if (!upstreamRes.ok) {
      return new NextResponse(`Upstream HTTP ${upstreamRes.status}`, {
        status: upstreamRes.status,
      });
    }

    // LOGO: pipe body with cache headers
    if (type === 'logo') {
      const contentType = upstreamRes.headers.get('content-type') || 'image/*';
      return new NextResponse(upstreamRes.body, {
        status: 200,
        headers: {
          'content-type': contentType,
          'cache-control': 'public, max-age=86400',
          'Access-Control-Allow-Origin': '*',
        },
      });
    }

    // M3U8: rewrite segments
    if (type === 'm3u8' && urlParam.includes('.m3u8')) {
      const text = await upstreamRes.text();
      if (!text.includes('#EXTM3U')) {
        return new NextResponse(`Not an m3u8 playlist`, { status: 415 });
      }

      const proxiedUrl = new URL(request.url);
      const rewritten = rewriteM3U8(
        text,
        new URL(upstreamRes.url),
        proxiedUrl.origin,
        sourceKey,
      );
      return new NextResponse(rewritten, {
        status: 200,
        headers: {
          'content-type': 'application/vnd.apple.mpegurl; charset=utf-8',
          'cache-control': 'no-store',
          'Access-Control-Allow-Origin': '*',
        },
      });
    }

    // Default: stream body (flv, ts, etc.)
    const responseHeaders = new Headers();
    responseHeaders.set('Access-Control-Allow-Origin', '*');
    [
      'content-type',
      'content-length',
      'content-range',
      'accept-ranges',
      'cache-control',
      'expires',
      'etag',
    ].forEach((h) => {
      const v = upstreamRes.headers.get(h);
      if (v) responseHeaders.set(h, v);
    });

    return new NextResponse(upstreamRes.body, {
      status: upstreamRes.status,
      headers: responseHeaders,
    });
  } catch (e: unknown) {
    const error = e as Error;
    const isAbort = error.name === 'AbortError';
    console.error('[Proxy Error]', error.message, urlParam);
    return new NextResponse(
      isAbort ? 'Upstream timeout' : 'Proxy fetch failed',
      { status: isAbort ? 502 : 500 },
    );
  } finally {
    clearTimeout(timeoutId);
  }
}
