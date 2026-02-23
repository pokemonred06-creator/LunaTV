import { NextRequest, NextResponse } from 'next/server';
import dns from 'node:dns/promises';
import net from 'node:net';

import { getConfig } from '@/lib/config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Some IPTV/VOD providers serve HLS on non-standard ports (e.g. :777). We still
// keep SSRF protections (public IP-only), but allow a small, configurable port
// set for legitimate streams.
const DEFAULT_ALLOWED_PORTS = [
  80, 88, 443, 777, 999, 4022, 8000, 8080, 8443, 8880, 8888, 8899, 9000, 35455,
];
function buildAllowedPorts(): Set<number> {
  const ports = new Set<number>(DEFAULT_ALLOWED_PORTS);
  const raw = process.env.PROXY_ALLOWED_PORTS;
  if (!raw) return ports;
  for (const part of raw.split(/[,\s]+/g)) {
    const n = Number(part.trim());
    if (!Number.isFinite(n)) continue;
    const p = Math.floor(n);
    if (p >= 1 && p <= 65535) ports.add(p);
  }
  return ports;
}
const ALLOWED_PORTS = buildAllowedPorts();

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
    if (u.username || u.password) return false;

    const port = u.port ? Number(u.port) : u.protocol === 'https:' ? 443 : 80;
    if (!ALLOWED_PORTS.has(port)) return false;

    const ipType = net.isIP(u.hostname);
    // Server is IPv4-only: reject literal IPv6 targets.
    if (ipType === 6) return false;
    if (ipType === 4) return !isBlockedIp(u.hostname);
    const addrs = await dns.lookup(u.hostname, { all: true, verbatim: true });
    if (!addrs.length) return false;

    // IPv4-only policy:
    // TOCTOU Fix: allow ONLY if ALL IPv4 answers are public.
    const ipv4Addrs = addrs.filter((a) => a.family === 4);
    if (!ipv4Addrs.length) return false;
    return ipv4Addrs.every((a) => !isBlockedIp(a.address));
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
      } catch (e: unknown) {
        // Explicitly type error argument
        const error = e as Error;
        throw new Error(`Invalid redirect: ${error.message}`, { cause: e });
      }
      continue;
    }
    return res;
  }
  throw new Error('Too many redirects');
}

async function fetchWithRetries(
  initialUrl: string,
  init: RequestInit,
  maxHops = 5,
  retries = 2,
  perAttemptTimeoutMs = 12000,
) {
  let lastErr: unknown = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const timeoutController = new AbortController();
    const timeoutId = setTimeout(
      () => timeoutController.abort(),
      perAttemptTimeoutMs,
    );
    const parentSignal = init.signal;
    let onAbort: (() => void) | null = null;
    if (parentSignal) {
      onAbort = () => timeoutController.abort();
      parentSignal.addEventListener('abort', onAbort, { once: true });
    }

    try {
      return await fetchWithValidatedRedirects(
        initialUrl,
        {
          ...init,
          signal: timeoutController.signal,
        },
        maxHops,
      );
    } catch (err) {
      lastErr = err;
      if (attempt >= retries) throw err;
      await new Promise((resolve) => setTimeout(resolve, 150 * (attempt + 1)));
    } finally {
      clearTimeout(timeoutId);
      if (parentSignal && onAbort) {
        parentSignal.removeEventListener('abort', onAbort);
      }
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('Fetch failed');
}

function proxyTypeForUrl(url: string): string {
  const path = new URL(url).pathname.toLowerCase();
  if (path.endsWith('.m3u8')) return 'm3u8';
  return 'ts'; // .ts, .aac, .key, etc. → stream directly
}

function toHttpFallbackUrl(urlStr: string): string | null {
  try {
    const u = new URL(urlStr);
    if (u.protocol !== 'https:') return null;
    u.protocol = 'http:';
    if (u.port === '443') u.port = '';
    return u.toString();
  } catch {
    return null;
  }
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

  const buildHeaders = (target: URL): Record<string, string> => {
    const headers: Record<string, string> = {
      'User-Agent': ua,
      Accept: '*/*',
    };

    if (request.headers.get('range'))
      headers['Range'] = request.headers.get('range')!;

    const raw = target.toString();
    if (raw.includes('huya') || raw.includes('douzhicloud'))
      headers['Referer'] = 'https://www.huya.com/';
    else if (raw.includes('douyin'))
      headers['Referer'] = 'https://live.douyin.com/';
    else headers['Referer'] = target.origin + '/';

    return headers;
  };

  let activeUrl = upstreamUrl;
  let upstreamHeaders: Record<string, string> = buildHeaders(activeUrl);
  const httpFallbackUrl = toHttpFallbackUrl(urlParam);
  let triedHttpFallback = false;

  const isLiveStream = type === 'flv';
  const timeoutMs = type === 'm3u8' ? 15000 : 20000;

  try {
    let upstreamRes: Response;
    try {
      if (isLiveStream) {
        // FLV live streams: no timeout, no retries.
        // The connection must stay open until the client disconnects.
        upstreamRes = await fetchWithValidatedRedirects(
          activeUrl.toString(),
          {
            headers: upstreamHeaders,
            cache: 'no-store',
            signal: request.signal, // tied to client connection
          },
          5,
        );
      } else {
        upstreamRes = await fetchWithRetries(
          activeUrl.toString(),
          {
            headers: upstreamHeaders,
            cache: 'no-store',
          },
          5,
          2,
          timeoutMs,
        );
      }
    } catch {
      // Some providers have broken TLS chains from container trust stores,
      // but still serve valid HTTP streams. Retry once over HTTP.
      if (!httpFallbackUrl) throw new Error('Initial upstream fetch failed');
      triedHttpFallback = true;
      activeUrl = new URL(httpFallbackUrl);
      upstreamHeaders = buildHeaders(activeUrl);
      if (!isLiveStream) {
        upstreamRes = await fetchWithRetries(
          activeUrl.toString(),
          {
            headers: upstreamHeaders,
            cache: 'no-store',
          },
          5,
          2,
          timeoutMs,
        );
      } else {
        upstreamRes = await fetchWithValidatedRedirects(
          activeUrl.toString(),
          {
            headers: upstreamHeaders,
            cache: 'no-store',
            signal: request.signal,
          },
          5,
        );
      }
    }

    // Multi-stage retry for 403 rejections (often due to anti-hotlinking)
    if (upstreamRes.status === 403) {
      const retryStrategies: Record<string, string | undefined>[] = [
        // 1. Try without Referer
        { Referer: undefined },
        // 2. Try with Mobile UA (often has different/looser blocklists) + No Referer
        {
          'User-Agent':
            'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
          Referer: undefined,
        },
        // 3. Try spoofing Origin to match upstream origin
        {
          Origin: upstreamUrl.origin,
          Referer: upstreamUrl.origin + '/',
        },
      ];

      for (const strategy of retryStrategies) {
        const nextHeaders: Record<string, string> = { ...upstreamHeaders };
        for (const [k, v] of Object.entries(strategy)) {
          if (v === undefined) {
            delete nextHeaders[k];
          } else {
            nextHeaders[k] = v;
          }
        }

        if (!isLiveStream) {
          upstreamRes = await fetchWithRetries(
            activeUrl.toString(),
            {
              headers: nextHeaders,
              cache: 'no-store',
            },
            5,
            1,
            timeoutMs,
          );
        } else {
          upstreamRes = await fetchWithValidatedRedirects(
            activeUrl.toString(),
            {
              headers: nextHeaders,
              cache: 'no-store',
              signal: request.signal,
            },
            5,
          );
        }
        if (upstreamRes.ok) break;
      }
    }

    // If HTTPS responds with 5xx, try HTTP once before giving up.
    if (
      upstreamRes.status >= 500 &&
      !triedHttpFallback &&
      httpFallbackUrl &&
      activeUrl.protocol === 'https:'
    ) {
      triedHttpFallback = true;
      activeUrl = new URL(httpFallbackUrl);
      upstreamHeaders = buildHeaders(activeUrl);
      if (!isLiveStream) {
        upstreamRes = await fetchWithRetries(
          activeUrl.toString(),
          {
            headers: upstreamHeaders,
            cache: 'no-store',
          },
          5,
          2,
          timeoutMs,
        );
      } else {
        upstreamRes = await fetchWithValidatedRedirects(
          activeUrl.toString(),
          {
            headers: upstreamHeaders,
            cache: 'no-store',
            signal: request.signal,
          },
          5,
        );
      }
    }

    // If HTTPS responds with 403, try HTTP once before giving up.
    if (
      upstreamRes.status === 403 &&
      !triedHttpFallback &&
      httpFallbackUrl &&
      activeUrl.protocol === 'https:'
    ) {
      triedHttpFallback = true;
      activeUrl = new URL(httpFallbackUrl);
      upstreamHeaders = buildHeaders(activeUrl);
      if (!isLiveStream) {
        upstreamRes = await fetchWithRetries(
          activeUrl.toString(),
          {
            headers: upstreamHeaders,
            cache: 'no-store',
          },
          5,
          2,
          timeoutMs,
        );
      } else {
        // Live streams use client signal, no timeout
        upstreamRes = await fetchWithValidatedRedirects(
          activeUrl.toString(),
          {
            headers: upstreamHeaders,
            cache: 'no-store',
            signal: request.signal,
          },
          5,
        );
      }
    }

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
    if (type === 'm3u8') {
      const playlistProbe = upstreamRes.clone();
      const text = await playlistProbe.text();
      if (!text.includes('#EXTM3U')) {
        // Fallback to raw passthrough for non-standard sources
        // (some providers return unconventional manifests/content-types).
        const fallbackHeaders = new Headers();
        fallbackHeaders.set('Access-Control-Allow-Origin', '*');
        const ct =
          upstreamRes.headers.get('content-type') || 'application/octet-stream';
        fallbackHeaders.set('content-type', ct);
        const cl = upstreamRes.headers.get('content-length');
        if (cl) fallbackHeaders.set('content-length', cl);
        return new NextResponse(upstreamRes.body, {
          status: upstreamRes.status,
          headers: fallbackHeaders,
        });
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
          'content-type': 'application/vnd.apple.mpegurl',
          'cache-control': 'no-store',
          'Access-Control-Allow-Origin': '*',
        },
      });
    }

    // Default: stream body (flv, ts, etc.)
    const responseHeaders = new Headers();
    responseHeaders.set('Access-Control-Allow-Origin', '*');
    responseHeaders.set('Accept-Ranges', 'bytes');
    [
      'content-type',
      'content-length',
      'content-range',
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
    const isBlocked = error.message?.includes('SSRF Blocked');
    console.error('[Proxy Error]', error.message, urlParam);
    return new NextResponse(
      isAbort
        ? 'Upstream timeout'
        : isBlocked
          ? 'Blocked upstream target'
          : 'Proxy fetch failed',
      { status: isAbort ? 502 : isBlocked ? 403 : 502 },
    );
  }
}
