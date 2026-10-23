export type LiveStreamType =
  'm3u8' | 'flv' | 'ts' | 'mp4' | 'audio' | 'unknown';

export function guessLiveStreamType(raw: string): LiveStreamType {
  try {
    const url = new URL(raw);
    if (['rtmp:', 'rtsp:', 'udp:', 'rtp:'].includes(url.protocol)) return 'ts';
    if (!['http:', 'https:'].includes(url.protocol)) return 'unknown';
    const path = url.pathname.toLowerCase();
    if (/\.m3u8?$|\/m3u8(?:\/|$)/.test(path)) return 'm3u8';
    if (/\.(flv|xs)$/.test(path)) return 'flv';
    if (/\.(mp4|m4v|mov|webm|ogv)$/.test(path)) return 'mp4';
    if (/\.(mp3|aac|m4a|ogg|wav|flac)$/.test(path)) return 'audio';
    if (/huya|douyu/.test(url.hostname + path)) return 'flv';
    return 'ts';
  } catch {
    return 'unknown';
  }
}

export function detectLiveStreamType(
  bytes: Uint8Array,
  contentType = '',
): LiveStreamType {
  // Payload signatures take precedence over often incorrect gateway headers.
  const text = new TextDecoder().decode(bytes.slice(0, 1024)).trimStart();
  if (text.startsWith('#EXTM3U')) return 'm3u8';
  if (bytes[0] === 0x46 && bytes[1] === 0x4c && bytes[2] === 0x56) return 'flv';
  for (const stride of [188, 192, 204]) {
    for (
      let offset = 0;
      offset < stride && offset + stride * 2 < bytes.length;
      offset++
    ) {
      if (
        bytes[offset] === 0x47 &&
        bytes[offset + stride] === 0x47 &&
        bytes[offset + stride * 2] === 0x47
      )
        return 'ts';
    }
  }
  if (
    bytes.length >= 8 &&
    new TextDecoder().decode(bytes.slice(4, 8)) === 'ftyp'
  )
    return 'mp4';
  if (
    bytes[0] === 0x1a &&
    bytes[1] === 0x45 &&
    bytes[2] === 0xdf &&
    bytes[3] === 0xa3
  )
    return 'mp4';
  if (/^(ID3|fLaC|OggS|RIFF)/.test(text)) return 'audio';
  if (/^\s*(?:<!doctype\s+html|<html|\{)/i.test(text)) return 'unknown';
  const mime = contentType.toLowerCase();
  if (mime.includes('mpegurl')) return 'm3u8';
  if (mime.includes('flv')) return 'flv';
  if (/mp2t|mpegts|video\/ts/.test(mime)) return 'ts';
  if (/video\/(mp4|webm|ogg|quicktime)/.test(mime)) return 'mp4';
  if (mime.startsWith('audio/')) return 'audio';
  return 'unknown';
}

export function liveStreamMimeType(type: LiveStreamType, rawUrl = ''): string {
  const path = (() => {
    try {
      return new URL(rawUrl).pathname.toLowerCase();
    } catch {
      return '';
    }
  })();
  if (type === 'm3u8') return 'application/x-mpegURL';
  if (type === 'flv') return 'video/x-flv';
  if (type === 'ts') return 'video/mp2t';
  if (type === 'mp4')
    return path.endsWith('.webm')
      ? 'video/webm'
      : path.endsWith('.ogv')
        ? 'video/ogg'
        : 'video/mp4';
  if (type === 'audio') {
    const extension = path.split('.').pop() || '';
    return (
      (
        {
          aac: 'audio/aac',
          m4a: 'audio/mp4',
          ogg: 'audio/ogg',
          wav: 'audio/wav',
          flac: 'audio/flac',
        } as Record<string, string>
      )[extension] || 'audio/mpeg'
    );
  }
  return 'application/octet-stream';
}

export function rewriteLiveManifest(
  text: string,
  base: string,
  sourceKey?: string | null,
  channelId?: string | null,
  subtitleTrack = false,
  authorizeUrl: (url: string) => string = (url) => url,
): string {
  const proxy = (
    uri: string,
    manifest = false,
    subtitles = subtitleTrack,
    segment = false,
  ) => {
    if (/^(data:|skd:)/i.test(uri)) return uri;
    const absolute = new URL(uri, base).toString();
    const params = new URLSearchParams({ url: absolute });
    if (sourceKey) params.set('moontv-source', sourceKey);
    if (channelId) params.set('moontv-channel', channelId);
    if (subtitles) params.set('moontv-track', 'subtitles');
    // Use manifest semantics for extensionless variant/rendition URLs.
    const type = manifest || /\.m3u8?(?:\?|$)/i.test(absolute) ? 'm3u8' : 'ts';
    const extension =
      type === 'm3u8'
        ? 'm3u8'
        : subtitles && segment
          ? 'vtt'
          : new URL(absolute).pathname.match(
              /\.(ts|mp4|m4s|aac|key|vtt)$/i,
            )?.[1] || 'ts';
    return authorizeUrl(`/api/proxy/${type}.${extension}?${params}`);
  };
  let variant = false;
  return text
    .split(/\r?\n/)
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed) return line;
      if (trimmed.startsWith('#')) {
        if (trimmed.startsWith('#EXT-X-STREAM-INF:')) variant = true;
        const isManifest =
          /^#EXT-X-(?:MEDIA|I-FRAME-STREAM-INF|RENDITION-REPORT):/.test(
            trimmed,
          );
        return line.replace(
          /\bURI="([^"]+)"/g,
          (_, uri: string) =>
            `URI="${proxy(uri, isManifest, subtitleTrack || (isManifest && /\bTYPE=SUBTITLES(?:,|$)/.test(trimmed)))}"`,
        );
      }
      const rewritten = proxy(trimmed, variant, subtitleTrack, !variant);
      variant = false;
      return rewritten;
    })
    .join('\n');
}
