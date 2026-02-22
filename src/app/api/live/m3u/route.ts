import { NextRequest, NextResponse } from 'next/server';

import { getConfig } from '@/lib/config';
import { getCachedLiveChannels } from '@/lib/live';

export const runtime = 'nodejs';

function escapeM3uAttr(value: string) {
  return (value || '').replace(/\r?\n/g, ' ').replace(/"/g, "'").trim();
}

function sanitizeExtinfTitle(value: string) {
  // Many parsers (including OrionTV) split on the last comma. Avoid commas in titles.
  return (value || '').replace(/,/g, ' ').trim();
}

function guessProxyType(url: string): 'm3u8' | 'flv' | 'ts' {
  const lower = (url || '').toLowerCase();
  const isFlv =
    lower.includes('.flv') || lower.includes('.xs') || /huya|douyu/.test(lower);
  if (isFlv) return 'flv';

  const isHls =
    lower.includes('.m3u8') ||
    lower.includes('/m3u8') ||
    lower.includes('format=m3u8') ||
    lower.includes('type=m3u8') ||
    lower.includes('playlist.m3u') ||
    lower.includes('index.m3u');
  if (isHls) return 'm3u8';

  return 'ts';
}

function buildProxiedUrl(
  origin: string,
  upstream: string,
  sourceKey: string,
): string {
  const trimmed = (upstream || '').trim();
  if (!trimmed) return trimmed;

  // If already proxied (absolute or relative), normalize to an absolute URL.
  if (trimmed.includes('/api/proxy/')) {
    try {
      return new URL(trimmed, origin).toString();
    } catch {
      return trimmed;
    }
  }

  // Only proxy http(s) targets. Non-http schemes are left as-is.
  if (!/^https?:\/\//i.test(trimmed)) return trimmed;

  const type = guessProxyType(trimmed);
  const u = new URL(`/api/proxy/${type}`, origin);
  u.searchParams.set('url', trimmed);
  u.searchParams.set('moontv-source', sourceKey);
  return u.toString();
}

function buildProxiedLogo(
  origin: string,
  logoUrl: string,
  sourceKey: string,
): string {
  const trimmed = (logoUrl || '').trim();
  if (!trimmed) return '';
  if (trimmed.startsWith('/')) {
    try {
      return new URL(trimmed, origin).toString();
    } catch {
      return trimmed;
    }
  }

  // Proxy logos so TV clients don’t hit CORS/referrer restrictions.
  const u = new URL('/api/proxy/logo', origin);
  u.searchParams.set('url', trimmed);
  u.searchParams.set('moontv-source', sourceKey);
  return u.toString();
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const sourceKey = (searchParams.get('source') || '').trim();

  const config = await getConfig();
  const enabledSources = (config.LiveConfig || []).filter((s) => !s.disabled);
  const targets = sourceKey
    ? enabledSources.filter((s) => s.key === sourceKey)
    : enabledSources;

  if (!targets.length) {
    return new NextResponse('Live source not found', { status: 404 });
  }

  const origin = new URL(request.url).origin;
  const lines: string[] = [];

  // Aggregate EPG urls if available.
  const epgUrls: string[] = [];
  const cachedByKey = new Map<
    string,
    Awaited<ReturnType<typeof getCachedLiveChannels>>
  >();
  for (const s of targets) {
    const data = await getCachedLiveChannels(s.key);
    cachedByKey.set(s.key, data);
    if (data?.epgUrl) epgUrls.push(String(data.epgUrl));
  }
  const uniqEpg = Array.from(new Set(epgUrls.filter(Boolean)));

  if (uniqEpg.length) {
    lines.push(`#EXTM3U x-tvg-url="${escapeM3uAttr(uniqEpg.join(','))}"`);
  } else {
    lines.push('#EXTM3U');
  }

  const multiSource = targets.length > 1;
  for (const s of targets) {
    const data = cachedByKey.get(s.key);
    if (!data) continue;

    for (const ch of data.channels || []) {
      const title = (ch.name || '').trim() || 'Unknown';
      const group = (ch.group || '').trim() || 'Default';
      const groupTitle = multiSource ? `${s.name || s.key}/${group}` : group;

      const attrs: string[] = [];
      if (ch.tvgId) attrs.push(`tvg-id="${escapeM3uAttr(ch.tvgId)}"`);
      attrs.push(`tvg-name="${escapeM3uAttr(title)}"`);
      if (ch.logo) {
        const logo = buildProxiedLogo(origin, ch.logo, s.key);
        if (logo) attrs.push(`tvg-logo="${escapeM3uAttr(logo)}"`);
      }
      attrs.push(`group-title="${escapeM3uAttr(groupTitle)}"`);

      lines.push(`#EXTINF:-1 ${attrs.join(' ')},${sanitizeExtinfTitle(title)}`);
      lines.push(buildProxiedUrl(origin, ch.url, s.key));
    }
  }

  return new NextResponse(lines.join('\n'), {
    status: 200,
    headers: {
      'content-type': 'application/x-mpegURL; charset=utf-8',
      'cache-control': 'no-store',
      'Access-Control-Allow-Origin': '*',
    },
  });
}
