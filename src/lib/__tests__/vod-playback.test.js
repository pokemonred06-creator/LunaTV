/* global test, expect */
import { getVodProxyUrl } from '@/lib/vod-playback';

test.each([
  ['https://media.example/index.m3u8?token=a&b=2', 'm3u8'],
  ['https://media.example/playlist', 'm3u8'],
  ['https://media.example/movie.mp4?token=secret', 'mp4'],
  ['https://media.example/movie.webm', 'mp4'],
  ['https://media.example/movie.m4v', 'mp4'],
  ['https://media.example/movie.mov', 'mp4'],
  ['https://media.example/movie.flv', 'flv'],
  ['https://media.example/movie.ts', 'ts'],
])('proxies %s with its real VOD source and media type', (upstream, type) => {
  const result = new URL(
    getVodProxyUrl(upstream, 'vod-source'),
    'https://site.example',
  );
  expect(result.pathname).toBe(`/api/proxy/${type}`);
  expect(result.searchParams.get('url')).toBe(upstream);
  expect(result.searchParams.get('moontv-vod-source')).toBe('vod-source');
  expect(result.searchParams.has('moontv-source')).toBe(false);
});

test.each([
  '',
  'https://',
  '/api/proxy/m3u8?url=upstream&moontv-vod-source=source&media-sign=signed',
  'https://site.example/api/proxy/m3u8?url=upstream&media-sign=signed',
])('preserves existing media URLs: %s', (url) => {
  expect(getVodProxyUrl(url, 'vod-source')).toBe(url);
});
