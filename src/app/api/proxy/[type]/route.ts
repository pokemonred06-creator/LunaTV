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

function isIpInCidr(ip: string, cidr: string) {
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

async function validateSafeUrl(urlStr: string) {
  try {
    const u = new URL(urlStr);
    if (!['http:', 'https:'].includes(u.protocol)) return false;
    const ipType = net.isIP(u.hostname);
    if (ipType === 4)
      return !BLOCKED_RANGES_IPV4.some((cidr) => isIpInCidr(u.hostname, cidr));
    if (ipType === 6) return false;
    const addrs = await dns.lookup(u.hostname, { all: true, verbatim: true });
    return !addrs.some(
      (a) =>
        a.family === 6 ||
        BLOCKED_RANGES_IPV4.some((cidr) => isIpInCidr(a.address, cidr)),
    );
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

interface ProxyParams {
  params: Promise<{ type: string }>;
}

export async function GET(request: NextRequest, props: ProxyParams) {
  const params = await props.params;
  const { type } = params;
  const { searchParams } = new URL(request.url);
  const url = searchParams.get('url');
  const sourceKey = searchParams.get('moontv-source');
  const allowCORS = searchParams.get('allowCORS');

  if (!url) return new NextResponse('Missing url', { status: 400 });

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

  if (url.includes('huya') || url.includes('douzhicloud'))
    upstreamHeaders['Referer'] = 'https://www.huya.com/';
  if (url.includes('douyin'))
    upstreamHeaders['Referer'] = 'https://live.douyin.com/';

  try {
    const upstreamRes = await fetchWithValidatedRedirects(
      url,
      { headers: upstreamHeaders, cache: 'no-store' },
      5,
    );

    if (!upstreamRes.ok) {
      return new NextResponse(`Upstream Error: ${upstreamRes.status}`, {
        status: upstreamRes.status,
      });
    }

    const contentType = upstreamRes.headers.get('Content-Type') || '';
    const isPlaylist =
      type === 'm3u8' ||
      url.includes('.m3u8') ||
      contentType.includes('mpegurl') ||
      contentType.includes('application/x-mpegURL');

    if (isPlaylist) {
      const text = await upstreamRes.text();

      if (text.includes('#EXTM3U')) {
        console.log('[Proxy] Rewriting M3U8 for:', url);
        const finalUrl = upstreamRes.url;
        const baseUrl = finalUrl.substring(0, finalUrl.lastIndexOf('/') + 1);

        const rewriteUri = (uri: string) => {
          let absoluteUrl = uri;
          try {
            absoluteUrl = new URL(uri, baseUrl).toString();
          } catch {
            return uri;
          }

          const pType =
            absoluteUrl.includes('.m3u8') || absoluteUrl.includes('m3u8')
              ? 'm3u8'
              : 'ts';
          const search = new URLSearchParams();
          search.set('url', absoluteUrl);
          if (sourceKey) search.set('moontv-source', sourceKey);
          if (allowCORS) search.set('allowCORS', allowCORS || 'false');

          return `/api/proxy/${pType}?${search.toString()}`;
        };

        const modifiedM3u8 = text
          .split('\n')
          .map((line) => {
            const trimmed = line.trim();
            if (!trimmed) return line;

            if (!trimmed.startsWith('#')) {
              return rewriteUri(trimmed);
            }

            if (trimmed.startsWith('#') && trimmed.includes('URI="')) {
              return line.replace(
                /URI="([^"]+)"/g,
                (_, uri) => `URI="${rewriteUri(uri)}"`,
              );
            }

            return line;
          })
          .join('\n');

        return new NextResponse(modifiedM3u8, {
          status: 200,
          headers: {
            'Content-Type': 'application/vnd.apple.mpegurl',
            'Access-Control-Allow-Origin': '*',
            'Cache-Control': 'no-cache, no-store, must-revalidate',
          },
        });
      }
    }

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
    const errorMessage = e instanceof Error ? e.message : String(e);
    console.error('[Proxy Error]', errorMessage, url);
    const status = errorMessage.includes('SSRF') ? 403 : 500;
    return new NextResponse(errorMessage || 'Internal Proxy Error', { status });
  }
}
