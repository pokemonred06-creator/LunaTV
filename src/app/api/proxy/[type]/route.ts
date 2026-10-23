import { NextRequest, NextResponse } from 'next/server';
import { spawn } from 'node:child_process';

import { getConfig } from '@/lib/config';
import { guardedFetch } from '@/lib/guarded-fetch';
import { getCachedLiveChannels } from '@/lib/live';
import {
  detectLiveStreamType,
  guessLiveStreamType,
  liveStreamMimeType,
  rewriteLiveManifest,
} from '@/lib/live-stream';
import {
  inspectStreamResponse,
  readLiveManifest,
} from '@/lib/live-stream-body';
import { authorizeMediaRequest, signMediaUrl } from '@/lib/media-auth';
import { safeImageResponse } from '@/lib/safe-image';
import { resolveSafeRelayUrl, validateSafeProxyUrl } from '@/lib/ssrf-guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Some IPTV/VOD providers serve HLS on non-standard ports (e.g. :777). We still
// keep SSRF protections (public IP-only), but allow a small, configurable port
// set for legitimate streams.
const DEFAULT_ALLOWED_PORTS = [
  80, 88, 98, 443, 554, 777, 999, 1111, 1935, 2096, 4022, 5000, 5004, 6610,
  8000, 8080, 8081, 8082, 8443, 8880, 8888, 8899, 9000, 9999, 14311, 18080,
  22226, 25455, 35455,
];

const HTTP_PROXY_PROTOCOLS = new Set(['http:', 'https:']);
const FFMPEG_RELAY_PROTOCOLS = new Set(['rtmp:', 'rtsp:', 'udp:', 'rtp:']);
const MAX_ACTIVE_FFMPEG_RELAYS = Math.max(
  1,
  Math.floor(Number(process.env.FFMPEG_RELAY_LIMIT || 4)),
);
let activeFfmpegRelays = 0;

const TRANSPARENT_GIF_1X1 = Uint8Array.from([
  71, 73, 70, 56, 57, 97, 1, 0, 1, 0, 128, 0, 0, 0, 0, 0, 255, 255, 255, 33,
  249, 4, 1, 0, 0, 1, 0, 44, 0, 0, 0, 0, 1, 0, 1, 0, 0, 2, 2, 68, 1, 0, 59,
]);
function buildAllowedPorts(): Set<number> | null {
  const raw = process.env.PROXY_ALLOWED_PORTS;
  if (raw === '*' || raw === 'all') return null;
  const ports = new Set<number>(DEFAULT_ALLOWED_PORTS);
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

// SSRF protection is provided by the shared ssrf-guard module (imported above).
// BLOCKLIST and isBlockedIp are re-exported from ssrf-guard for use below.

async function fetchWithValidatedRedirects(
  initialUrl: string,
  init: RequestInit,
  maxHops = 5,
  allowedPorts = ALLOWED_PORTS,
) {
  let current = initialUrl;
  for (let hop = 0; hop <= maxHops; hop++) {
    const safe = await validateSafeProxyUrl(
      current,
      HTTP_PROXY_PROTOCOLS,
      allowedPorts,
    );
    if (!safe) {
      console.warn(`[Proxy] SSRF block at hop ${hop}: ${current}`);
      throw new Error(`SSRF Blocked: ${current}`);
    }

    console.log(`[Proxy] Hop ${hop}: Fetching ${current}`);
    const res = await guardedFetch(current, { ...init, redirect: 'manual' });
    console.log(`[Proxy] Hop ${hop} Status: ${res.status}`);

    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location');
      if (!loc) return res;
      await res.body?.cancel();
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
  allowedPorts = ALLOWED_PORTS,
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
      if (parentSignal.aborted) timeoutController.abort();
      else parentSignal.addEventListener('abort', onAbort, { once: true });
    }

    try {
      const response = await fetchWithValidatedRedirects(
        initialUrl,
        {
          ...init,
          signal: timeoutController.signal,
        },
        maxHops,
        allowedPorts,
      );
      clearTimeout(timeoutId);
      // Keep client cancellation and an idle deadline active through body reads.
      const reader = response.body?.getReader();
      if (!reader) return response;
      const bodyAbortListener = onAbort;
      let finished = false;
      let idleTimer: ReturnType<typeof setTimeout> | undefined;
      const cleanup = () => {
        if (finished) return;
        finished = true;
        clearTimeout(idleTimer);
        if (parentSignal && bodyAbortListener)
          parentSignal.removeEventListener('abort', bodyAbortListener);
      };
      const stream = new ReadableStream<Uint8Array>({
        async pull(controller) {
          idleTimer = setTimeout(
            () => timeoutController.abort(),
            perAttemptTimeoutMs,
          );
          try {
            const { done, value } = await reader.read();
            clearTimeout(idleTimer);
            if (done) {
              cleanup();
              controller.close();
            } else controller.enqueue(value);
          } catch (error) {
            cleanup();
            controller.error(error);
          }
        },
        async cancel(reason) {
          cleanup();
          timeoutController.abort();
          await reader.cancel(reason).catch(() => {});
        },
      });
      const wrapped = new Response(stream, {
        status: response.status,
        headers: response.headers,
      });
      Object.defineProperty(wrapped, 'url', { value: response.url });
      // The stream owns this listener until completion/cancellation.
      onAbort = null;
      return wrapped;
    } catch (err) {
      lastErr = err;
      if (parentSignal?.aborted || attempt >= retries) throw err;
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

interface ProxyParams {
  params: Promise<{ type: string }>;
}

export async function GET(request: NextRequest, props: ProxyParams) {
  const access = await authorizeMediaRequest(request);
  if (!access) return new NextResponse('Unauthorized', { status: 401 });
  const params = await props.params;
  const type = (params.type || '')
    .toLowerCase()
    .replace(/\.(m3u8|ts|mp4|m4s|aac|key|vtt)$/, '');
  const { searchParams } = new URL(request.url);
  const urlParam = searchParams.get('url') || '';
  const sourceKey = searchParams.get('moontv-source');
  const channelId = searchParams.get('moontv-channel');
  const probeOnly = searchParams.get('probe') === '1';

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
  const registeredChannels =
    sourceConfig && sourceKey ? await getCachedLiveChannels(sourceKey) : null;
  const channel = registeredChannels?.channels.find((channel) =>
    channelId ? channel.id === channelId : channel.url === urlParam,
  );
  const requestAllowedPorts = ALLOWED_PORTS ? new Set(ALLOWED_PORTS) : null;
  // Only a registered playlist target may add its public port to this request.
  if (channel && requestAllowedPorts) {
    const registeredUrl = new URL(channel.url);
    if (registeredUrl.hostname === upstreamUrl.hostname && registeredUrl.port)
      requestAllowedPorts.add(Number(registeredUrl.port));
  }
  const ua =
    channel?.headers?.['User-Agent'] ||
    sourceConfig?.ua ||
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

  const upstreamScheme = upstreamUrl.protocol.replace(':', '').toLowerCase();
  const shouldUseFfmpegRelay = ['rtmp', 'rtsp', 'udp', 'rtp'].includes(
    upstreamScheme,
  );

  if (probeOnly && shouldUseFfmpegRelay)
    return NextResponse.json({
      success: true,
      type: 'ts',
      mimeType: 'video/mp2t',
    });

  if (shouldUseFfmpegRelay) {
    if (type !== 'ts') {
      return new NextResponse(
        `Type mismatch: upstream is ${upstreamScheme}, relay expects ts`,
        {
          status: 415,
          headers: {
            'Access-Control-Allow-Origin': '*',
          },
        },
      );
    }

    const safeRelayTarget = await resolveSafeRelayUrl(
      upstreamUrl.toString(),
      FFMPEG_RELAY_PROTOCOLS,
      requestAllowedPorts,
    ).catch(() => null);
    if (!safeRelayTarget) {
      return new NextResponse('Blocked upstream target', {
        status: 403,
        headers: {
          'Access-Control-Allow-Origin': '*',
        },
      });
    }

    if (activeFfmpegRelays >= MAX_ACTIVE_FFMPEG_RELAYS) {
      return new NextResponse('Too many active relay streams', {
        status: 429,
        headers: {
          'Access-Control-Allow-Origin': '*',
        },
      });
    }
    activeFfmpegRelays += 1;

    const ffmpegArgs = [
      '-loglevel',
      'error',
      '-nostdin',
      '-fflags',
      'nobuffer',
      ...(upstreamScheme === 'rtmp'
        ? ['-rtmp_tcurl', upstreamUrl.toString()]
        : []),
      '-i',
      safeRelayTarget.toString(),
      '-map',
      '0:v:0?',
      '-map',
      '0:a:0?',
      '-c',
      'copy',
      '-f',
      'mpegts',
      'pipe:1',
    ];
    const ffmpeg = spawn('ffmpeg', ffmpegArgs, {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let releasedRelaySlot = false;
    const releaseRelaySlot = () => {
      if (releasedRelaySlot) return;
      releasedRelaySlot = true;
      activeFfmpegRelays = Math.max(0, activeFfmpegRelays - 1);
    };

    request.signal.addEventListener(
      'abort',
      () => {
        ffmpeg.kill('SIGKILL');
      },
      { once: true },
    );

    const stderrChunks: Buffer[] = [];
    ffmpeg.stderr.on('data', (chunk: Buffer) => {
      if (stderrChunks.length < 8) stderrChunks.push(chunk);
    });

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        let streamSettled = false;
        const closeStream = () => {
          if (streamSettled) return;
          streamSettled = true;
          controller.close();
        };
        const errorStream = (error: Error) => {
          if (streamSettled) return;
          streamSettled = true;
          controller.error(error);
        };

        ffmpeg.stdout.on('data', (chunk: Buffer) => {
          if (!streamSettled) controller.enqueue(new Uint8Array(chunk));
        });
        ffmpeg.stdout.on('end', () => {
          closeStream();
        });
        ffmpeg.stdout.on('error', (error) => {
          errorStream(error);
        });
        ffmpeg.on('error', (error) => {
          releaseRelaySlot();
          errorStream(error);
        });
        ffmpeg.on('close', (code) => {
          releaseRelaySlot();
          if (code && code !== 0) {
            const stderrText = Buffer.concat(stderrChunks).toString() || '';
            errorStream(
              new Error(
                `ffmpeg relay failed (${upstreamScheme}): ${stderrText}`,
              ),
            );
          }
        });
      },
      cancel() {
        ffmpeg.kill('SIGKILL');
      },
    });

    return new NextResponse(stream, {
      status: 200,
      headers: {
        'content-type': 'video/mp2t',
        'cache-control': 'no-store',
        'Access-Control-Allow-Origin': '*',
        'Accept-Ranges': 'none',
      },
    });
  }

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

    for (const [name, value] of Object.entries(channel?.headers || {})) {
      if (
        ['User-Agent', 'Referer', 'Origin'].includes(name) &&
        !/[\r\n]/.test(value)
      )
        headers[name] = value;
    }
    return headers;
  };

  let activeUrl = upstreamUrl;
  let upstreamHeaders: Record<string, string> = buildHeaders(activeUrl);
  const httpFallbackUrl = toHttpFallbackUrl(urlParam);
  let triedHttpFallback = false;

  const isLiveStream =
    type === 'flv' || (type === 'ts' && !request.headers.has('range'));
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
        signal: request.signal,
      },
      5,
      retries,
      isLiveStream ? liveConnectTimeoutMs : timeoutMs,
      requestAllowedPorts,
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
        await upstreamRes.body?.cancel().catch(() => {});
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
      await upstreamRes.body?.cancel().catch(() => {});
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
      await upstreamRes.body?.cancel().catch(() => {});
      activeUrl = new URL(httpFallbackUrl);
      upstreamHeaders = buildHeaders(activeUrl);
      upstreamRes = await fetchUpstream(activeUrl.toString(), upstreamHeaders);
    }

    if (!upstreamRes.ok) {
      await upstreamRes.body?.cancel().catch(() => {});
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
      return safeImageResponse(upstreamRes);
    }

    const upstreamContentType = upstreamRes.headers.get('content-type') || '';
    // Only nonzero byte ranges begin mid-container. FFmpeg sends bytes=0-
    // for playlists too, including extensionless or image-disguised HLS.
    const range = request.headers.get('range');
    const isBinaryRange = !!range && !/^bytes=0-/i.test(range) && !probeOnly;
    const inspected = isBinaryRange
      ? { prefix: new Uint8Array(), body: upstreamRes.body! }
      : await inspectStreamResponse(upstreamRes);
    const detected = detectLiveStreamType(
      inspected.prefix,
      upstreamContentType,
    );
    const preview = new TextDecoder().decode(inspected.prefix).trimStart();
    if (
      !isBinaryRange &&
      (!inspected.prefix.length ||
        /^(?:<!doctype\s+html|<html|\{)/i.test(preview))
    ) {
      await inspected.body.cancel().catch(() => {});
      return new NextResponse('Source returned no playable media', {
        status: 415,
      });
    }

    const actualType =
      detected === 'unknown'
        ? guessLiveStreamType(upstreamRes.url || activeUrl.toString())
        : detected;
    if (probeOnly) {
      await inspected.body.cancel().catch(() => {});
      if (
        detected === 'unknown' &&
        /^(text\/html|application\/json)/i.test(upstreamContentType)
      )
        return NextResponse.json(
          {
            success: false,
            error: 'Source returned a web page instead of media',
            type: 'unknown',
          },
          { status: 415 },
        );
      return NextResponse.json({
        success: true,
        type: actualType,
        mimeType: upstreamContentType,
      });
    }
    if (actualType === 'm3u8') {
      const text = await readLiveManifest(inspected.body);
      if (!text.trimStart().startsWith('#EXTM3U'))
        return new NextResponse('Invalid HLS manifest', { status: 415 });
      const rewritten = rewriteLiveManifest(
        text,
        upstreamRes.url || activeUrl.toString(),
        sourceKey,
        channelId,
        searchParams.get('moontv-track') === 'subtitles',
        (url) => signMediaUrl(url, access.username, access.expires),
      );
      return new NextResponse(rewritten, {
        headers: {
          'content-type': 'application/vnd.apple.mpegurl',
          'cache-control': 'no-store',
          'Access-Control-Allow-Origin': '*',
        },
      });
    }
    if (
      ['m3u8', 'flv'].includes(type) &&
      actualType !== type &&
      detected !== 'unknown'
    ) {
      await inspected.body.cancel().catch(() => {});
      return new NextResponse(`Type mismatch: upstream is ${actualType}`, {
        status: 415,
        headers: { 'x-moontv-actual-type': actualType },
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

    responseHeaders.set(
      'content-type',
      searchParams.get('moontv-track') === 'subtitles'
        ? 'text/vtt'
        : liveStreamMimeType(actualType, activeUrl.toString()),
    );
    responseHeaders.set('x-content-type-options', 'nosniff');
    responseHeaders.set(
      'content-security-policy',
      "sandbox; default-src 'none'",
    );
    responseHeaders.set('cache-control', 'private, no-store');
    return new NextResponse(inspected.body, {
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
