/** @jest-environment node */
/* global jest, test, expect, afterEach */
import { processImageUrl } from '@/lib/utils';

const coverUrl =
  'https://img9.doubanio.com/view/photo/s_ratio_poster/public/p123.jpg';
const originalWindow = Object.getOwnPropertyDescriptor(global, 'window');
const originalStorage = Object.getOwnPropertyDescriptor(global, 'localStorage');

afterEach(() => {
  if (originalWindow) Object.defineProperty(global, 'window', originalWindow);
  else delete global.window;
  if (originalStorage)
    Object.defineProperty(global, 'localStorage', originalStorage);
  else delete global.localStorage;
});

test('processes a play-page Douban cover during SSR without browser globals', () => {
  delete global.window;
  delete global.localStorage;

  expect(processImageUrl(coverUrl)).toBe(
    'https://img.doubanio.cmliussss.net/view/photo/s_ratio_poster/public/p123.jpg',
  );
});

test('uses runtime image proxy settings in the browser', () => {
  global.localStorage = { getItem: jest.fn(() => null) };
  global.window = {
    location: { protocol: 'https:' },
    RUNTIME_CONFIG: { DOUBAN_IMAGE_PROXY_TYPE: 'server' },
  };

  expect(processImageUrl(coverUrl)).toBe(
    `/api/image-proxy?url=${encodeURIComponent(coverUrl)}`,
  );
});

test('preserves saved image proxy preferences ahead of runtime defaults', () => {
  global.localStorage = {
    getItem: jest.fn((key) =>
      key === 'doubanImageProxyType' ? 'direct' : null,
    ),
  };
  global.window = {
    location: { protocol: 'https:' },
    RUNTIME_CONFIG: { DOUBAN_IMAGE_PROXY_TYPE: 'server' },
  };

  expect(processImageUrl(coverUrl)).toBe(coverUrl);
});
