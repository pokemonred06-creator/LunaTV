export interface LivePlaylistChannel {
  id: string;
  tvgId: string;
  name: string;
  logo: string;
  group: string;
  url: string;
  headers?: Record<string, string>;
}

export function parseLivePlaylist(
  sourceKey: string,
  content: string,
  baseUrl?: string,
) {
  const channels: LivePlaylistChannel[] = [];
  let tvgUrl = '';
  let pending: Omit<LivePlaylistChannel, 'id' | 'url'> | null = null;
  const resolve = (raw: string) => {
    if (!raw) return '';
    try {
      return new URL(raw, baseUrl).toString();
    } catch {
      return raw;
    }
  };
  for (const rawLine of content.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.startsWith('#EXTM3U')) {
      tvgUrl = resolve(
        line
          .match(/(?:x-tvg-url|url-tvg|tvg-url)="([^"]*)"/)?.[1]
          .split(',')[0]
          .trim() || '',
      );
    } else if (line.startsWith('#EXTINF:')) {
      const attribute = (name: string) =>
        line.match(new RegExp(`${name}="([^"]*)"`))?.[1] || '';
      // A comma inside a quoted attribute is not the title delimiter.
      const title =
        line.match(/^#EXTINF:(?:[^",]|"[^"]*")*,(.*)$/)?.[1].trim() || '';
      pending = {
        tvgId: attribute('tvg-id'),
        name: title || attribute('tvg-name'),
        logo: attribute('tvg-logo'),
        group: attribute('group-title') || '无分组',
      };
    } else if (pending && line.startsWith('#EXTVLCOPT:')) {
      const option = line.slice('#EXTVLCOPT:'.length);
      const separator = option.indexOf('=');
      const name = option.slice(0, separator).toLowerCase();
      const header = (
        {
          'http-user-agent': 'User-Agent',
          'http-referrer': 'Referer',
          'http-referer': 'Referer',
          'http-origin': 'Origin',
        } as Record<string, string>
      )[name];
      if (header && separator >= 0)
        pending.headers = {
          ...pending.headers,
          [header]: option.slice(separator + 1),
        };
    } else if (pending && !line.startsWith('#')) {
      const [address, options] = line.split('|', 2);
      if (options)
        for (const [key, value] of new URLSearchParams(options)) {
          const header = (
            {
              'user-agent': 'User-Agent',
              referer: 'Referer',
              referrer: 'Referer',
              origin: 'Origin',
            } as Record<string, string>
          )[key.toLowerCase()];
          if (header) pending.headers = { ...pending.headers, [header]: value };
        }
      if (pending.name && address)
        channels.push({
          ...pending,
          id: `${sourceKey}-${channels.length}`,
          url: resolve(address),
        });
      pending = null;
    }
  }
  return { tvgUrl, channels };
}
