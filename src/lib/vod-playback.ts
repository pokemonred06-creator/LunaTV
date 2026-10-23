/** Keep VOD permissions separate from live playlist source permissions. */
export function getVodProxyUrl(raw: string, source: string): string {
  if (!/^https?:\/\//i.test(raw)) return raw;
  let upstream: URL;
  try {
    upstream = new URL(raw);
  } catch {
    // Let the player/probe failover handle malformed provider URLs.
    return raw;
  }
  if (upstream.pathname.startsWith('/api/proxy/')) return raw;
  const extension = upstream.pathname
    .match(/\.(mp4|m4v|mov|webm|ogg|ogv|flv|ts)$/i)?.[1]
    ?.toLowerCase();
  const type =
    extension === 'flv' || extension === 'ts'
      ? extension
      : extension
        ? 'mp4'
        : 'm3u8';
  const query = new URLSearchParams({
    url: raw,
    'moontv-vod-source': source,
  });
  return `/api/proxy/${type}?${query}`;
}
