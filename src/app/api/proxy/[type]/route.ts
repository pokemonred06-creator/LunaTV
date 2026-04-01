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

const TRANSPARENT_GIF_1X1 = Uint8Array.from([
  71, 73, 70, 56, 57, 97, 1, 0, 1, 0, 128, 0, 0, 0, 0, 0, 255, 255, 255, 33,
  249, 4, 1, 0, 0, 1, 0, 44, 0, 0, 0, 0, 1, 0, 1, 0, 0, 2, 2, 68, 1, 0, 59,
]);
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
    if (!ALLOWED_PORTS.has(port)) {
      console.warn('[Proxy SSRF] Blocked Port:', port, urlStr);
      return false;
    }

    const ipType = net.isIP(u.hostname);
    if (ipType === 6) return !isBlockedIp(u.hostname);
    if (ipType === 4) {
      const blocked = isBlockedIp(u.hostname);
      if (blocked) console.warn('[Proxy SSRF] Blocked IP:', u.hostname, urlStr);
      return !blocked;
    }
    const addrs = await dns.lookup(u.hostname, { all: true, verbatim: true });
    if (!addrs.length) {
      console.warn('[Proxy SSRF] Empty DNS result:', u.hostname, urlStr);
      return false;
    }

    const allPublic = addrs.every((a) => {
      if (a.family !== 4 && a.family !== 6) return false;
      return !isBlockedIp(a.address);
    });
    if (!allPublic) {
      console.warn(
        '[Proxy SSRF] Blocked resolved address:',
        addrs.map((a) => a.address),
        urlStr,
      );
    }
    return allPublic;
  } catch (err) {
    console.warn('[Proxy SSRF] Validation Error:', err, urlStr);
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
    const safe = await validateSafeUrl(current);
    if (!safe) {
      console.warn(`[Proxy] SSRF block at hop ${hop}: ${current}`);
      throw new Error(`SSRF Blocked: ${current}`);
    }

    console.log(`[Proxy] Hop ${hop}: Fetching ${current}`);
    const res = await fetch(current, { ...init, redirect: 'manual' });
    console.log(`[Proxy] Hop ${hop} Status: ${res.status}`);

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

function isHuyaLikeUrl(urlStr: string): boolean {
  const lower = urlStr.toLowerCase();
  return (
    lower.includes('huya') ||
    lower.includes('jdshipin.com') ||
    lower.includes('douzhicloud.site') ||
    lower.includes('zxyxndc.top')
  );
}

function withLiveCacheBuster(urlStr: string): string {
  try {
    const u = new URL(urlStr);
    const lower = u.toString().toLowerCase();
    if (
      lower.includes('jdshipin.com') ||
      lower.includes('zxyxndc.top') ||
      lower.includes('/huya/')
    ) {
      u.searchParams.set('_mt', String(Date.now()));
      u.searchParams.set('_mr', String(Math.floor(Math.random() * 1_000_000)));
      return u.toString();
    }
    return urlStr;
  } catch {
    return urlStr;
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

    const raw = target.toString().toLowerCase();
    if (raw.includes('huya') || raw.includes('douzhicloud')) {
      headers['Referer'] = 'https://www.huya.com/';
      // Some FLV gateways reject cross-site Origin; omit for live FLV.
      if (type !== 'flv') headers['Origin'] = 'https://www.huya.com';
    } else if (raw.includes('douyin')) {
      headers['Referer'] = 'https://live.douyin.com/';
      if (type !== 'flv') headers['Origin'] = 'https://live.douyin.com';
    } else {
      headers['Referer'] = target.origin + '/';
      if (type !== 'flv') headers['Origin'] = target.origin;
    }

    return headers;
  };

  let activeUrl = upstreamUrl;
  let upstreamHeaders: Record<string, string> = buildHeaders(activeUrl);
  const httpFallbackUrl = toHttpFallbackUrl(urlParam);
  let triedHttpFallback = false;

  const isLiveStream = type === 'flv';
  const timeoutMs = type === 'm3u8' ? 15000 : 20000;
  const liveConnectTimeoutMs = 12000;
  const liveConnectRetries = 2;

  const fetchUpstream = (
    targetUrl: string,
    headers: Record<string, string>,
    retries: number = isLiveStream ? liveConnectRetries : 2,
  ) => {
    const finalTarget =
      isLiveStream && isHuyaLikeUrl(targetUrl)
        ? withLiveCacheBuster(targetUrl)
        : targetUrl;
    return fetchWithRetries(
      finalTarget,
      {
        headers,
        cache: 'no-store',
        ...(isLiveStream ? { signal: request.signal } : {}),
      },
      5,
      retries,
      isLiveStream ? liveConnectTimeoutMs : timeoutMs,
    );
  };

  const retryTransient403 = async (
    current: Response,
    headers: Record<string, string>,
    label: string,
  ): Promise<Response> => {
    if (
      !isLiveStream ||
      current.status !== 403 ||
      !isHuyaLikeUrl(current.url || activeUrl.toString())
    ) {
      return current;
    }

    let latest = current;
    for (let i = 1; i <= 6; i++) {
      const wait = 180 + Math.floor(Math.random() * 260);
      await new Promise((resolve) => setTimeout(resolve, wait));
      try {
        await latest.body?.cancel();
      } catch {
        // ignore
      }
      latest = await fetchUpstream(activeUrl.toString(), headers, 0);
      console.log(
        `[Proxy] ${label} transient-403 retry ${i}/6 status=${latest.status}`,
      );
      if (latest.ok || latest.status !== 403) {
        return latest;
      }
    }
    return latest;
  };

  try {
    let upstreamRes: Response;
    try {
      console.log(
        `[Proxy] Fetching ${type}: ${activeUrl.toString().substring(0, 150)}`,
      );
      upstreamRes = await fetchUpstream(activeUrl.toString(), upstreamHeaders);
      console.log(
        `[Proxy] Upstream Status: ${upstreamRes.status} for ${activeUrl.hostname}`,
      );
      upstreamRes = await retryTransient403(
        upstreamRes,
        upstreamHeaders,
        'Base',
      );
    } catch (err: unknown) {
      const error = err as Error;
      console.error(
        `[Proxy] Fetch Error: ${error.message} for ${activeUrl.hostname}`,
      );
      // Some providers have broken TLS chains from container trust stores,
      // but still serve valid HTTP streams. Retry once over HTTP.
      if (!httpFallbackUrl) throw err;
      triedHttpFallback = true;
      activeUrl = new URL(httpFallbackUrl);
      upstreamHeaders = buildHeaders(activeUrl);
      console.log(`[Proxy] Trying HTTP fallback: ${activeUrl.toString()}`);
      upstreamRes = await fetchUpstream(activeUrl.toString(), upstreamHeaders);
      console.log(`[Proxy] Upstream (Fallback) Status: ${upstreamRes.status}`);
      upstreamRes = await retryTransient403(
        upstreamRes,
        upstreamHeaders,
        'HTTP fallback',
      );
    }

    // Multi-stage retry for 403 rejections (often due to anti-hotlinking)
    if (upstreamRes.status === 403) {
      console.log(
        `[Proxy] Upstream 403, starting retry strategies for ${activeUrl.hostname}...`,
      );
      const retryStrategies: Record<string, string | undefined>[] = [
        // 1. Try without Referer/Origin
        { Referer: undefined, Origin: undefined },
        // 2. Try with Mobile UA (often has different/looser blocklists) + No Referer
        {
          'User-Agent':
            'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
          Referer: undefined,
          Origin: undefined,
        },
        // 3. Try spoofing Origin to match upstream origin
        {
          Origin: upstreamUrl.origin,
          Referer: upstreamUrl.origin + '/',
        },
      ];

      for (let i = 0; i < retryStrategies.length; i++) {
        const strategy = retryStrategies[i];
        const nextHeaders: Record<string, string> = { ...upstreamHeaders };
        for (const [k, v] of Object.entries(strategy)) {
          if (v === undefined) {
            delete nextHeaders[k];
          } else {
            nextHeaders[k] = v;
          }
        }

        console.log(
          `[Proxy] Retry Strategy ${i + 1}/${retryStrategies.length} for ${activeUrl.hostname}...`,
        );
        upstreamRes = await fetchUpstream(activeUrl.toString(), nextHeaders, 1);
        upstreamRes = await retryTransient403(
          upstreamRes,
          nextHeaders,
          `Strategy ${i + 1}`,
        );
        console.log(`[Proxy] Strategy ${i + 1} Status: ${upstreamRes.status}`);
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
      upstreamRes = await fetchUpstream(activeUrl.toString(), upstreamHeaders);
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
      upstreamRes = await fetchUpstream(activeUrl.toString(), upstreamHeaders);
    }

    if (!upstreamRes.ok) {
      if (type === 'logo') {
        return new NextResponse(TRANSPARENT_GIF_1X1, {
          status: 200,
          headers: {
            'content-type': 'image/gif',
            'cache-control': 'public, max-age=300',
            'Access-Control-Allow-Origin': '*',
          },
        });
      }

      const upstreamHost = activeUrl.hostname || 'unknown-host';
      const body =
        upstreamRes.status === 404
          ? `Upstream HTTP 404: source not found (${upstreamHost})`
          : `Upstream HTTP ${upstreamRes.status} (${upstreamHost})`;
      return new NextResponse(body, {
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

    const upstreamContentType = (
      upstreamRes.headers.get('content-type') || ''
    ).toLowerCase();
    const isM3u8ContentType =
      upstreamContentType.includes('mpegurl') ||
      upstreamContentType.includes('x-mpegurl') ||
      upstreamContentType.includes('vnd.apple.mpegurl');
    const isFlvContentType =
      upstreamContentType.includes('video/x-flv') ||
      upstreamContentType.includes('/flv');
    const isTsContentType =
      upstreamContentType.includes('video/mp2t') ||
      upstreamContentType.includes('mpegts') ||
      upstreamContentType.includes('/mp2t') ||
      upstreamContentType.includes('/ts');

    if (type === 'flv' && isM3u8ContentType) {
      return new NextResponse('Type mismatch: upstream is m3u8, not flv', {
        status: 415,
        headers: {
          'x-moontv-actual-type': 'm3u8',
          'Access-Control-Allow-Origin': '*',
        },
      });
    }

    if (type === 'ts' && isFlvContentType) {
      return new NextResponse('Type mismatch: upstream is flv, not ts', {
        status: 415,
        headers: {
          'x-moontv-actual-type': 'flv',
          'Access-Control-Allow-Origin': '*',
        },
      });
    }

    // TS fallback: some IPTV sources are exposed via .php/ts routes but actually
    // return HLS playlists. Detect and rewrite to keep client playback stable.
    if (type === 'ts') {
      let upstreamPath = '';
      try {
        upstreamPath = new URL(upstreamRes.url).pathname.toLowerCase();
      } catch {
        upstreamPath = '';
      }
      const looksLikeManifestPath =
        upstreamPath.includes('.m3u8') ||
        upstreamPath.includes('/m3u8') ||
        upstreamPath.includes('playlist.m3u') ||
        upstreamPath.includes('index.m3u');
      if (isM3u8ContentType || looksLikeManifestPath) {
        const playlistProbe = upstreamRes.clone();
        const text = await playlistProbe.text();
        if (text.includes('#EXTM3U')) {
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
      }
    }

    // M3U8: rewrite segments
    if (type === 'm3u8') {
      if (isFlvContentType || isTsContentType) {
        return new NextResponse(
          `Type mismatch: upstream is ${isFlvContentType ? 'flv' : 'ts'}, not m3u8`,
          {
            status: 415,
            headers: {
              'x-moontv-actual-type': isFlvContentType ? 'flv' : 'ts',
              'Access-Control-Allow-Origin': '*',
            },
          },
        );
      }

      let upstreamPath = '';
      try {
        upstreamPath = new URL(upstreamRes.url).pathname.toLowerCase();
      } catch {
        upstreamPath = '';
      }
      const looksLikeManifestPath =
        upstreamPath.includes('.m3u8') ||
        upstreamPath.includes('/m3u8') ||
        upstreamPath.includes('playlist.m3u') ||
        upstreamPath.includes('index.m3u');
      if (!isM3u8ContentType && !looksLikeManifestPath) {
        return new NextResponse('Type mismatch: upstream is not m3u8', {
          status: 415,
          headers: {
            'x-moontv-actual-type': 'unknown',
            'Access-Control-Allow-Origin': '*',
          },
        });
      }

      const playlistProbe = upstreamRes.clone();
      const text = await playlistProbe.text();
      if (!text.includes('#EXTM3U')) {
        return new NextResponse('Type mismatch: invalid m3u8 payload', {
          status: 415,
          headers: {
            'x-moontv-actual-type': 'unknown',
            'Access-Control-Allow-Origin': '*',
          },
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
    responseHeaders.set('Access-Control-Allow-Headers', 'Range, Content-Type');
    responseHeaders.set(
      'Access-Control-Expose-Headers',
      'Content-Type, Content-Length, Content-Range, Accept-Ranges, Cache-Control, ETag',
    );
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
