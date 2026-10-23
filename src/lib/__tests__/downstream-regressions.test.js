/** @jest-environment node */
/* global jest, test, expect, beforeEach, afterEach */
import { getConfig } from '@/lib/config';
import { getDetailFromApi, searchFromApi } from '@/lib/downstream';
import { getCachedSearchPage, setCachedDetail } from '@/lib/search-cache';

jest.mock('@/lib/config', () => ({
  API_CONFIG: {
    search: { path: '?q=', pagePath: '?q={query}&page={page}', headers: {} },
    detail: { headers: {} },
  },
  getConfig: jest.fn(),
}));
jest.mock('@/lib/search-cache', () => ({
  getCachedSearchPage: jest.fn(),
  setCachedSearchPage: jest.fn(),
  getCachedDetail: jest.fn(),
  setCachedDetail: jest.fn(),
}));
jest.mock('@/lib/utils', () => ({ cleanHtmlTags: (s) => s }));

const site = { key: 'test', name: 'Test', api: 'https://example.com' };
const originalFetch = global.fetch;
const originalProxy = process.env.GO_PROXY_URL;
beforeEach(() => {
  jest.useFakeTimers();
  jest.resetAllMocks();
  delete process.env.GO_PROXY_URL;
  getConfig.mockResolvedValue({ SiteConfig: { SearchDownstreamMaxPage: 2 } });
});
afterEach(() => {
  global.fetch = originalFetch;
  if (originalProxy === undefined) delete process.env.GO_PROXY_URL;
  else process.env.GO_PROXY_URL = originalProxy;
  jest.useRealTimers();
});

test('repeated multi-page searches do not mutate cached first-page results', async () => {
  const firstPage = Object.freeze([{ id: '1' }]);
  getCachedSearchPage.mockImplementation(async (_source, _query, page) => ({
    status: 'ok',
    data: page === 1 ? firstPage : [{ id: '2' }],
    pageCount: page === 1 ? 2 : undefined,
  }));
  for (let i = 0; i < 3; i++) {
    await expect(searchFromApi(site, 'movie')).resolves.toEqual([
      { id: '1' },
      { id: '2' },
    ]);
  }
  expect(firstPage).toEqual([{ id: '1' }]);
});

test('cancellation during a cache read skips network requests', async () => {
  const controller = new AbortController();
  getCachedSearchPage.mockImplementation(async () => {
    controller.abort();
    return null;
  });
  global.fetch = jest.fn();
  await expect(
    searchFromApi(site, 'movie', { signal: controller.signal }),
  ).resolves.toEqual([]);
  expect(global.fetch).not.toHaveBeenCalled();
});

test.each([
  ['JSON', site, 'json', 15000, 3],
  ['HTML', { ...site, detail: 'https://example.com' }, 'text', 10000, 1],
])(
  '%s detail deadlines include stalled response bodies',
  async (_label, api, method, deadline, attempts) => {
    const signals = [];
    global.fetch = jest.fn(async (_url, { signal }) => {
      signals.push(signal);
      return {
        ok: true,
        status: 200,
        [method]: () =>
          new Promise((_resolve, reject) => {
            signal.addEventListener(
              'abort',
              () => reject(new DOMException('aborted', 'AbortError')),
              { once: true },
            );
          }),
      };
    });
    const result = getDetailFromApi(api, '1');
    const assertion = expect(result).rejects.toThrow();
    await jest.advanceTimersByTimeAsync(deadline * attempts + 1);
    await assertion;
    expect(signals).toHaveLength(attempts);
    expect(signals.every((signal) => signal.aborted)).toBe(true);
    expect(setCachedDetail).not.toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(0);
  },
);

test('failed HTML detail fetches clean up their timers', async () => {
  global.fetch = jest.fn().mockRejectedValue(new Error('offline'));
  await expect(
    getDetailFromApi({ ...site, detail: site.api }, '1'),
  ).rejects.toThrow('offline');
  expect(jest.getTimerCount()).toBe(0);
});

test('malformed proxy JSON falls back to a direct detail response', async () => {
  process.env.GO_PROXY_URL = 'http://proxy.example';
  const warning = jest.spyOn(console, 'warn').mockImplementation(() => {});
  global.fetch = jest
    .fn()
    .mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError('invalid JSON');
      },
    })
    .mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ list: [{ vod_name: 'Movie', vod_content: '' }] }),
    });
  try {
    await expect(getDetailFromApi(site, '1')).resolves.toMatchObject({
      id: '1',
      title: 'Movie',
    });
    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(setCachedDetail).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);
  } finally {
    warning.mockRestore();
  }
});
