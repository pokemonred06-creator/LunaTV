/** @jest-environment node */
/* global jest, test, expect, beforeEach, afterEach */
import { searchFromApi } from '@/lib/downstream';
import { getCachedSearchPage, setCachedSearchPage } from '@/lib/search-cache';

jest.mock('@/lib/config', () => ({
  API_CONFIG: { search: { path: '?q=', headers: {} } },
  getConfig: jest
    .fn()
    .mockResolvedValue({ SiteConfig: { SearchDownstreamMaxPage: 1 } }),
}));
jest.mock('@/lib/search-cache', () => ({
  getCachedSearchPage: jest.fn().mockResolvedValue(null),
  setCachedSearchPage: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('@/lib/utils', () => ({ cleanHtmlTags: (s) => s }));

const site = { key: 'test', name: 'Test', api: 'https://example.com' };
const originalFetch = global.fetch;

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
});
afterEach(() => {
  global.fetch = originalFetch;
  jest.useRealTimers();
});

function stalledBody() {
  global.fetch = jest.fn(async (_url, init) => ({
    ok: true,
    json: () =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener(
          'abort',
          () => reject(new DOMException('aborted', 'AbortError')),
          { once: true },
        );
      }),
  }));
}

test('aborts a stalled response body after the upstream deadline', async () => {
  stalledBody();
  const result = searchFromApi(site, 'movie');
  await jest.advanceTimersByTimeAsync(8001);
  await expect(result).resolves.toEqual([]);
  expect(setCachedSearchPage).toHaveBeenCalledWith(
    'test',
    'movie',
    1,
    'timeout',
    [],
  );
  expect(jest.getTimerCount()).toBe(0);
});

test('user cancellation does not poison the upstream timeout cache', async () => {
  stalledBody();
  const controller = new AbortController();
  const result = searchFromApi(site, 'movie', { signal: controller.signal });
  await jest.advanceTimersByTimeAsync(1);
  controller.abort();
  await expect(result).resolves.toEqual([]);
  expect(setCachedSearchPage).not.toHaveBeenCalled();
  expect(jest.getTimerCount()).toBe(0);
});

test('already cancelled searches skip cache and network work', async () => {
  global.fetch = jest.fn();
  const controller = new AbortController();
  controller.abort();
  await expect(
    searchFromApi(site, 'movie', { signal: controller.signal }),
  ).resolves.toEqual([]);
  expect(getCachedSearchPage).not.toHaveBeenCalled();
  expect(global.fetch).not.toHaveBeenCalled();
});
