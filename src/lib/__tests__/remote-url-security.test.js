/** @jest-environment node */
/* global jest, test, expect, beforeEach */
import dns from 'node:dns/promises';

import { assertSafeRemoteUrl } from '@/lib/request-security';
import { validateSafeProxyUrl, validateSafeUrl } from '@/lib/ssrf-guard';

jest.mock('node:dns/promises', () => ({ lookup: jest.fn() }));
beforeEach(() => {
  dns.lookup.mockReset();
  dns.lookup.mockResolvedValue([
    { address: '2606:4700:4700::1111', family: 6 },
  ]);
});

test.each([
  '::ffff:127.0.0.1',
  '::ffff:7f00:1',
  '::ffff:a00:1',
  '::ffff:a9fe:a9fe',
  '::ffff:c0a8:1',
  '::',
  '::1',
  'fe90::1',
  'febf::1',
  'fd00::1',
  'ff02::1',
  '2001:db8::1',
])(
  'both URL guards reject internal/reserved IPv6 address %s',
  async (address) => {
    const url = `http://[${address}]/`;
    expect(await validateSafeUrl(url)).toBe(false);
    await expect(assertSafeRemoteUrl(url)).rejects.toThrow();
  },
);

test('both guards reject a hostname resolving to mapped private IPv6', async () => {
  dns.lookup.mockResolvedValue([{ address: '::ffff:7f00:1', family: 6 }]);
  expect(await validateSafeUrl('https://example.com')).toBe(false);
  await expect(assertSafeRemoteUrl('https://example.com')).rejects.toThrow();
});

test('empty DNS answers fail closed', async () => {
  dns.lookup.mockResolvedValue([]);
  expect(await validateSafeUrl('https://example.com')).toBe(false);
  await expect(assertSafeRemoteUrl('https://example.com')).rejects.toThrow();
});

test('public IPv6 addresses remain usable', async () => {
  const url = 'https://[2606:4700:4700::1111]/';
  expect(await validateSafeUrl(url)).toBe(true);
  await expect(assertSafeRemoteUrl(url)).resolves.toBeInstanceOf(URL);
});

test('strict remote policy retains mapped benchmark-range blocking', async () => {
  await expect(
    assertSafeRemoteUrl('http://[::ffff:c612:1]/'),
  ).rejects.toThrow();
});

test.each([98, 2096, 14311])(
  'approved stream port %s retains private-address and credential protection',
  async (port) => {
    const protocols = new Set(['http:', 'https:']);
    const ports = new Set([port]);
    expect(
      await validateSafeProxyUrl(
        `https://example.com:${port}/live`,
        protocols,
        ports,
      ),
    ).toBe(true);
    for (const target of [
      `http://127.0.0.1:${port}/live`,
      `http://192.168.50.8:${port}/live`,
      `https://user:password@example.com:${port}/live`,
      'https://example.com:65530/live',
    ]) {
      expect(await validateSafeProxyUrl(target, protocols, ports)).toBe(false);
    }
  },
);
