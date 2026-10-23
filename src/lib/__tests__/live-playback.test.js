/** @jest-environment node */
/* global jest, test, expect, beforeEach */
import { NextRequest } from 'next/server';

import { getCachedLiveChannels } from '@/lib/live';
import { parseLivePlaylist } from '@/lib/live-playlist';
import {
  detectLiveStreamType,
  guessLiveStreamType,
  rewriteLiveManifest,
} from '@/lib/live-stream';
import { inspectStreamResponse } from '@/lib/live-stream-body';
import { validateSafeProxyUrl } from '@/lib/ssrf-guard';

import { GET as proxy } from '@/app/api/proxy/[type]/route';

jest.mock('@/lib/auth/server', () => ({
  getAuthInfoFromCookie: async () => ({
    username: 'viewer',
    timestamp: Date.now(),
  }),
  isActiveUsername: async () => true,
}));
jest.mock('@/lib/config', () => ({
  getAvailableLiveSources: async () => [{ key: 'source' }],
  getConfig: async () => ({
    LiveConfig: [{ key: 'source', ua: 'PlaylistPlayer' }],
  }),
}));
jest.mock('@/lib/live', () => ({ getCachedLiveChannels: jest.fn() }));
jest.mock('@/lib/ssrf-guard', () => ({ validateSafeProxyUrl: jest.fn() }));

beforeEach(() => {
  process.env.PROXY_SECRET = 'test-live-secret';
  getCachedLiveChannels.mockResolvedValue({ channels: [] });
  validateSafeProxyUrl.mockResolvedValue(true);
  global.fetch = jest.fn();
});

const upstream = (
  body,
  type = 'application/octet-stream',
  url = 'https://media.example/live.php',
) => {
  const response = new Response(body, { headers: { 'content-type': type } });
  Object.defineProperty(response, 'url', { value: url });
  return response;
};
const request = (type, url, extra = {}, headers = {}) => {
  const query = new URLSearchParams({
    url,
    'moontv-source': 'source',
    ...extra,
  });
  return proxy(
    new NextRequest(`http://site.example/api/proxy/${type}?${query}`, {
      headers,
    }),
    { params: Promise.resolve({ type }) },
  );
};

test('keeps channels with VLC directives, relative URLs, pipe headers and commas in titles', () => {
  const result = parseLivePlaylist(
    's',
    `#EXTM3U
#EXTINF:-1 tvg-name="Fallback, Name" group-title="News, HD",News, English
#EXTVLCOPT:http-user-agent=Custom Player
#EXTVLCOPT:http-referrer=https://allowed.example/
#KODIPROP:inputstream.adaptive.manifest_type=hls
channel?id=1|Origin=https%3A%2F%2Fallowed.example
#EXTINF:-1,Second
https://media.example/second.m3u8`,
    'https://media.example/list/playlist.m3u',
  );
  expect(result.tvgUrl).toBe('');
  expect(result.channels).toHaveLength(2);
  expect(result.channels[0]).toMatchObject({
    name: 'News, English',
    group: 'News, HD',
    url: 'https://media.example/list/channel?id=1',
    headers: {
      'User-Agent': 'Custom Player',
      Referer: 'https://allowed.example/',
      Origin: 'https://allowed.example',
    },
  });
});

test('explicit media formats take precedence over provider-name guesses', () => {
  expect(guessLiveStreamType('https://huya.example/play.m3u8?token=flv')).toBe(
    'm3u8',
  );
  expect(guessLiveStreamType('https://media.example/movie.mp4?token=a')).toBe(
    'mp4',
  );
  expect(guessLiveStreamType('https://media.example/radio.aac')).toBe('audio');
  expect(
    detectLiveStreamType(new TextEncoder().encode('#EXTM3U\n'), 'video/mp2t'),
  ).toBe('m3u8');
  expect(
    detectLiveStreamType(Uint8Array.from([70, 76, 86]), 'text/plain'),
  ).toBe('flv');
});

test('rewrites extensionless variants/renditions, encryption keys and init segments', () => {
  const result = rewriteLiveManifest(
    `#EXTM3U
#EXT-X-MEDIA:TYPE=AUDIO,URI="audio?id=1"
#EXT-X-STREAM-INF:BANDWIDTH=1000
variant?id=2
#EXT-X-KEY:METHOD=AES-128,URI="key"
#EXT-X-MAP:URI="init.mp4"
#EXTINF:2,
segment.ts`,
    'https://cdn.example/path/master.php',
    'source',
    'channel',
  );
  const lines = result.split('\n');
  expect(lines[1]).toContain('/api/proxy/m3u8.m3u8?');
  expect(lines[3]).toContain('/api/proxy/m3u8.m3u8?');
  expect(lines[4]).toContain('/api/proxy/ts.');
  expect(lines[5]).toContain('/api/proxy/ts.');
  expect(lines[7]).toContain('moontv-channel=channel');
  expect(decodeURIComponent(lines[3])).toContain(
    'https://cdn.example/path/variant?id=2',
  );
});

test('inspection replays all bytes including a chunk larger than its prefix', async () => {
  const bytes = Uint8Array.from({ length: 5000 }, (_, index) => index % 256);
  const inspected = await inspectStreamResponse(new Response(bytes));
  expect(inspected.prefix).toHaveLength(1024);
  expect(
    new Uint8Array(await new Response(inspected.body).arrayBuffer()),
  ).toEqual(bytes);
});

test('preserves WebVTT segment extensions for HLS subtitle decoders', async () => {
  const rewritten = rewriteLiveManifest(
    '#EXTM3U\n#EXTINF:2,\nsubtitle.vtt',
    'https://cdn.example/subtitles/index.m3u8',
    'source',
    'channel',
  );
  expect(rewritten).toContain('/api/proxy/ts.vtt?');
  fetch.mockResolvedValue(
    upstream('WEBVTT\n\n00:00.000 --> 00:02.000\nCaption\n', 'text/vtt'),
  );
  const response = await request(
    'ts.vtt',
    'https://cdn.example/subtitles/subtitle.vtt',
  );
  expect(response.status).toBe(200);
  expect(await response.text()).toContain('WEBVTT');
});

test('carries subtitle rendition context to image-disguised WebVTT segments', () => {
  const master = rewriteLiveManifest(
    '#EXTM3U\n#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",URI="captions.m3u8"',
    'https://cdn.example/master.m3u8',
    'source',
    'channel',
  );
  expect(master).toContain('moontv-track=subtitles');
  const captions = rewriteLiveManifest(
    '#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="caption.key"\n#EXTINF:2,\nimage.jpg',
    'https://cdn.example/captions.m3u8',
    'source',
    'channel',
    true,
  );
  expect(captions).toContain('/api/proxy/ts.vtt?');
  expect(captions).toContain('/api/proxy/ts.key?');
  expect(captions).toContain('moontv-track=subtitles');
});

test('detects and rewrites HLS served through a PHP endpoint with text/plain headers', async () => {
  fetch.mockResolvedValue(
    upstream(
      '#EXTM3U\n#EXTINF:2,\nsegment.ts\n',
      'text/plain',
      'https://cdn.example/path/live.php',
    ),
  );
  const response = await request('m3u8', 'https://media.example/live.php');
  expect(response.status).toBe(200);
  expect(response.headers.get('content-type')).toContain('mpegurl');
  expect(decodeURIComponent(await response.text())).toContain(
    'https://cdn.example/path/segment.ts',
  );
});

test('precheck uses registered headers and the registered public port', async () => {
  getCachedLiveChannels.mockResolvedValue({
    channels: [
      {
        id: 'channel',
        url: 'https://media.example:4430/live',
        headers: {
          Referer: 'https://provider.example/',
          'User-Agent': 'Required Player',
        },
      },
    ],
  });
  fetch.mockResolvedValue(
    upstream(Uint8Array.from([70, 76, 86, ...new Array(1100).fill(0)])),
  );
  const response = await request('ts', 'https://media.example:4430/live', {
    probe: '1',
    'moontv-channel': 'channel',
  });
  expect(await response.json()).toMatchObject({ success: true, type: 'flv' });
  expect(fetch.mock.calls[0][1].headers).toMatchObject({
    Referer: 'https://provider.example/',
    'User-Agent': 'Required Player',
  });
  expect(validateSafeProxyUrl.mock.calls.at(-1)[2].has(4430)).toBe(true);
});

test('arbitrary targets cannot borrow a registered channel port', async () => {
  getCachedLiveChannels.mockResolvedValue({
    channels: [{ id: 'channel', url: 'https://media.example:4430/live' }],
  });
  fetch.mockResolvedValue(upstream('#EXTM3U\n'));
  await request('ts', 'https://other.example:4430/live', {
    probe: '1',
    'moontv-channel': 'channel',
  });
  expect(validateSafeProxyUrl.mock.calls.at(-1)[2].has(4430)).toBe(false);
});

test('preserves binary HLS byte ranges and partial-response headers', async () => {
  const bytes = Uint8Array.from([9, 8, 7, 6]);
  const response = new Response(bytes, {
    status: 206,
    headers: {
      'content-type': 'application/octet-stream',
      'content-range': 'bytes 100-103/200',
    },
  });
  Object.defineProperty(response, 'url', {
    value: 'https://media.example/segment',
  });
  fetch.mockResolvedValue(response);
  const proxied = await request(
    'ts',
    response.url,
    {},
    { Range: 'bytes=100-103' },
  );
  expect(proxied.status).toBe(206);
  expect(proxied.headers.get('content-range')).toBe('bytes 100-103/200');
  expect(new Uint8Array(await proxied.arrayBuffer())).toEqual(bytes);
});

test('rewrites image-disguised HLS requested by FFmpeg with a zero-start range', async () => {
  fetch.mockResolvedValue(
    upstream(
      '#EXTM3U\n#EXTINF:8,\nstream_0.jpg?u=example\n',
      'image/jpeg',
      'https://cdn.example/channel/playlist.jpg',
    ),
  );
  const response = await request(
    'm3u8',
    'https://cdn.example/channel/playlist.jpg',
    {},
    { Range: 'bytes=0-' },
  );
  expect(response.status).toBe(200);
  expect(response.headers.get('content-type')).toContain('mpegurl');
  const text = await response.text();
  expect(text).toContain('/api/proxy/ts.ts?');
  expect(decodeURIComponent(text)).toContain(
    'https://cdn.example/channel/stream_0.jpg?u=example',
  );
});

test('a zero-start range cannot pass an HTML error page to the decoder', async () => {
  fetch.mockResolvedValue(upstream('<html>Unavailable</html>', 'text/html'));
  const response = await request(
    'ts',
    'https://media.example/live',
    {},
    {
      Range: 'bytes=0-',
    },
  );
  expect(response.status).toBe(415);
  expect(await response.text()).toBe('Source returned no playable media');
});

test('validates each redirect and releases its discarded body', async () => {
  let cancelled = false;
  const body = new ReadableStream({
    cancel() {
      cancelled = true;
    },
  });
  fetch
    .mockResolvedValueOnce(
      new Response(body, {
        status: 302,
        headers: { Location: 'https://cdn.example/live' },
      }),
    )
    .mockResolvedValueOnce(
      upstream('#EXTM3U\n', 'text/plain', 'https://cdn.example/live'),
    );
  const response = await request('ts', 'https://media.example/live', {
    probe: '1',
  });
  expect(response.status).toBe(200);
  expect(cancelled).toBe(true);
  expect(
    validateSafeProxyUrl.mock.calls.some(
      ([url]) => url === 'https://cdn.example/live',
    ),
  ).toBe(true);
});

test.each([98, 2096, 14311])(
  'follows a stream redirect to approved public port %s',
  async (port) => {
    const destination = `https://cdn.example:${port}/live.m3u8`;
    validateSafeProxyUrl.mockImplementation(async (url, protocols, ports) => {
      const target = new URL(url);
      return (
        protocols.has(target.protocol) && ports.has(Number(target.port || 443))
      );
    });
    fetch
      .mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: { Location: destination },
        }),
      )
      .mockResolvedValueOnce(upstream('#EXTM3U\n', 'text/plain', destination));

    const response = await request('ts', 'https://media.example/live', {
      probe: '1',
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      success: true,
      type: 'm3u8',
    });
    expect(fetch.mock.calls[1][0]).toBe(destination);
    expect(validateSafeProxyUrl.mock.calls.at(-1)[2].has(port)).toBe(true);
    expect(validateSafeProxyUrl.mock.calls.at(-1)[2].has(65530)).toBe(false);
  },
);
