/* global jest, test, expect, beforeEach, afterEach */
import Hls from 'hls.js';

import { getVideoResolutionFromM3u8 } from '@/lib/utils';

jest.mock('hls.js', () => ({
  __esModule: true,
  default: jest.fn(),
}));

const originalFetch = global.fetch;
let loadSource;

beforeEach(() => {
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    headers: { get: () => 'application/vnd.apple.mpegurl' },
    text: async () => '#EXTM3U\n#EXTINF:10,\nsegment.ts',
  });
  loadSource = jest.fn();
  Hls.Events = {
    FRAG_LOADING: 'loading',
    FRAG_LOADED: 'loaded',
    ERROR: 'error',
  };
  Hls.mockImplementation(() => ({
    on: (event, callback) => {
      // Stop after the URL reaches the decoder; no provider or media fetch needed.
      if (event === Hls.Events.ERROR) {
        queueMicrotask(() =>
          callback(event, { fatal: true, type: 'test-stop' }),
        );
      }
    },
    loadSource,
    attachMedia: jest.fn(),
    destroy: jest.fn(),
  }));
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  global.fetch = originalFetch;
  jest.restoreAllMocks();
});

test('quality probing and HLS loading retain the same registered VOD source', async () => {
  const mediaUrl = 'https://media.example/quality-source-test.m3u8';
  const sourceId = 'test-vod-source';

  await expect(
    getVideoResolutionFromM3u8(mediaUrl, { sourceId }),
  ).rejects.toThrow('test-stop');

  expect(global.fetch).toHaveBeenCalledTimes(1);
  expect(loadSource).toHaveBeenCalledTimes(1);
  const probeUrl = new URL(global.fetch.mock.calls[0][0], 'http://localhost');
  const decoderUrl = new URL(loadSource.mock.calls[0][0], 'http://localhost');
  for (const proxyUrl of [probeUrl, decoderUrl]) {
    expect(proxyUrl.pathname).toBe('/api/proxy/m3u8');
    expect(proxyUrl.searchParams.get('url')).toBe(mediaUrl);
    expect(proxyUrl.searchParams.get('moontv-vod-source')).toBe(sourceId);
    expect(proxyUrl.searchParams.has('moontv-source')).toBe(false);
  }
});
