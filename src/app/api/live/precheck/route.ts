import { NextRequest, NextResponse } from 'next/server';

import { getConfig } from '@/lib/config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function ok(type: string) {
  return NextResponse.json({ success: true, type });
}
function bad(msg: string, status = 400) {
  return NextResponse.json(
    { success: false, error: msg, type: 'unknown' },
    { status },
  );
}

function resolveUrl(raw: string) {
  try {
    const u = new URL(raw);
    if (
      u.protocol !== 'http:' &&
      u.protocol !== 'https:' &&
      u.protocol !== 'rtmp:' &&
      u.protocol !== 'rtsp:' &&
      u.protocol !== 'udp:' &&
      u.protocol !== 'rtp:'
    ) {
      return null;
    }
    return u;
  } catch {
    return null;
  }
}

function guessByPath(u: URL): string {
  const path = u.pathname.toLowerCase();
  const full = `${u.pathname}${u.search}`.toLowerCase();
  if (
    path.includes('.flv') ||
    path.includes('.xs') ||
    full.includes('douyu') ||
    full.includes('huya')
  ) {
    return 'flv';
  }
  if (
    path.includes('.m3u8') ||
    path.includes('playlist.m3u8') ||
    path.includes('index.m3u') ||
    path.includes('/m3u8')
  ) {
    return 'm3u8';
  }
  if (/\/(rtp|udp)\//i.test(full)) return 'ts';
  if (/\.(mp4|m4v|mov|webm|ogv)$/i.test(path)) return 'mp4';
  if (/\.(mp3|aac|m4a|ogg|wav|flac)$/i.test(path)) return 'audio';
  return 'ts';
}

function shouldSkipActiveProbe(u: URL): boolean {
  const host = u.hostname.toLowerCase();
  const path = u.pathname.toLowerCase();
  const full = `${u.pathname}${u.search}`.toLowerCase();

  // These live gateways are highly stateful and can return anti-hotlink 403s
  // when probed too aggressively. Use deterministic URL heuristics instead.
  if (
    host.includes('jdshipin.com') ||
    host.includes('douzhicloud.site') ||
    host.includes('zxyxndc.top')
  ) {
    return true;
  }

  if (
    full.includes('huya') ||
    full.includes('douyu') ||
    path.endsWith('.php')
  ) {
    return true;
  }

  return false;
}

function isLikelyTs(buf: Uint8Array): boolean {
  if (buf.length < 376) return false;
  let hits = 0;
  for (let i = 0; i + 188 < buf.length && i < 188; i++) {
    if (buf[i] === 0x47 && buf[i + 188] === 0x47) hits++;
    if (hits >= 2) return true;
  }
  return false;
}

async function probeType(u: URL, sourceUa?: string): Promise<string> {
  const timeout = AbortSignal.timeout(7000);
  const headers: Record<string, string> = {
    Range: 'bytes=0-65535',
    'User-Agent':
      sourceUa ||
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    Accept: '*/*',
  };
  const raw = u.toString().toLowerCase();
  if (raw.includes('huya') || raw.includes('douzhicloud')) {
    headers['Referer'] = 'https://www.huya.com/';
    headers['Origin'] = 'https://www.huya.com';
  } else if (raw.includes('douyin')) {
    headers['Referer'] = 'https://live.douyin.com/';
    headers['Origin'] = 'https://live.douyin.com';
  } else {
    headers['Referer'] = u.origin + '/';
    headers['Origin'] = u.origin;
  }

  const res = await fetch(u.toString(), {
    headers,
    redirect: 'follow',
    cache: 'no-store',
    signal: timeout,
  });
  if (!res.ok) return guessByPath(u);

  const contentType = (res.headers.get('content-type') || '').toLowerCase();
  if (
    contentType.includes('mpegurl') ||
    contentType.includes('x-mpegurl') ||
    contentType.includes('vnd.apple.mpegurl')
  ) {
    return 'm3u8';
  }
  if (contentType.includes('video/x-flv') || contentType.includes('/flv')) {
    return 'flv';
  }
  if (
    contentType.includes('mp2t') ||
    contentType.includes('mpegts') ||
    contentType.includes('video/ts')
  ) {
    return 'ts';
  }

  const ab = await res.arrayBuffer();
  const bytes = new Uint8Array(ab);
  const headText = new TextDecoder().decode(bytes.slice(0, 4096));
  if (headText.includes('#EXTM3U')) return 'm3u8';
  if (
    bytes.length >= 3 &&
    bytes[0] === 0x46 &&
    bytes[1] === 0x4c &&
    bytes[2] === 0x56
  ) {
    return 'flv';
  }
  if (isLikelyTs(bytes)) return 'ts';

  return guessByPath(u);
}

export async function GET(req: NextRequest) {
  const urlParam = req.nextUrl.searchParams.get('url') || '';
  const sourceKey = req.nextUrl.searchParams.get('moontv-source') || '';
  const u = resolveUrl(urlParam);
  if (!u) return bad('Invalid URL');

  const scheme = u.protocol.replace(':', '').toLowerCase();
  if (['rtmp', 'rtsp', 'udp', 'rtp'].includes(scheme)) {
    return bad(`Unsupported protocol: ${scheme}`, 422);
  }

  try {
    let sourceUa: string | undefined;
    if (sourceKey) {
      const config = await getConfig();
      const source = config.LiveConfig?.find(
        (s: { key: string; ua?: string }) => s.key === sourceKey,
      );
      sourceUa = source?.ua;
    }
    if (shouldSkipActiveProbe(u)) {
      return ok(guessByPath(u));
    }
    const detected = await probeType(u, sourceUa);
    return ok(detected);
  } catch {
    return ok(guessByPath(u));
  }
}
