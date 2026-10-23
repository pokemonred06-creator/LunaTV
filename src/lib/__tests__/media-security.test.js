/** @jest-environment node */
/* global jest, test, expect, beforeEach */
import { NextRequest } from 'next/server';

import { getAuthInfoFromCookie, isActiveUsername } from '@/lib/auth/server';
import { getAvailableLiveSources } from '@/lib/config';
import { getCachedLiveChannels } from '@/lib/live';
import { authorizeMediaRequest, signMediaUrl } from '@/lib/media-auth';
import { safeImageResponse } from '@/lib/safe-image';

import { GET as image } from '@/app/api/image-proxy/route';
import { GET as channels } from '@/app/api/live/channels/route';
import { GET as epg } from '@/app/api/live/epg/route';
import { GET as playlist } from '@/app/api/live/m3u/route';
import { GET as sources } from '@/app/api/live/sources/route';
import { GET as proxy } from '@/app/api/proxy/[type]/route';

jest.mock('@/lib/auth/server', () => ({
  getAuthInfoFromCookie: jest.fn(),
  isActiveUsername: jest.fn(),
}));
jest.mock('@/lib/config', () => ({
  getAvailableLiveSources: jest.fn(),
  getConfig: async () => ({ LiveConfig: [{ key: 'allowed' }] }),
}));
jest.mock('@/lib/live', () => ({ getCachedLiveChannels: jest.fn() }));
jest.mock('@/lib/ssrf-guard', () => ({
  validateSafeProxyUrl: async () => true,
  validateSafeUrl: async () => true,
}));

const request = (path) =>
  new NextRequest(new URL(path, 'https://site.example'));
const media =
  '/api/proxy/m3u8?url=https%3A%2F%2Fmedia.example%2Findex.m3u8&moontv-source=allowed';
beforeEach(() => {
  process.env.PROXY_SECRET = 'test-media-secret';
  getAuthInfoFromCookie.mockResolvedValue(null);
  isActiveUsername.mockResolvedValue(true);
  getAvailableLiveSources.mockResolvedValue([
    { key: 'allowed', name: 'Allowed' },
  ]);
  getCachedLiveChannels.mockResolvedValue({
    channels: [
      {
        id: 'one',
        name: 'One',
        url: 'https://media.example/index.m3u8',
        logo: '',
      },
    ],
    epgs: {},
  });
  global.fetch = jest.fn();
});
test('denies an unsigned anonymous media request before any upstream work', async () => {
  const response = await proxy(request(media), {
    params: Promise.resolve({ type: 'm3u8' }),
  });
  expect(response.status).toBe(401);
  expect(fetch).not.toHaveBeenCalled();
});
test('binds native playback signatures to target, path, user, and permissions', async () => {
  const signed = signMediaUrl(media, 'viewer');
  expect(await authorizeMediaRequest(request(signed))).toMatchObject({
    username: 'viewer',
  });
  for (const changed of [
    signed.replace('media.example', 'other.example'),
    signed.replace('/m3u8?', '/ts?'),
    signed.replace('media-user=viewer', 'media-user=admin'),
    signed.replace('moontv-source=allowed', 'moontv-source=restricted'),
  ]) {
    expect(await authorizeMediaRequest(request(changed))).toBeNull();
  }
  expect(
    await authorizeMediaRequest(
      request(signMediaUrl(media, 'viewer', Date.now() - 1000)),
    ),
  ).toBeNull();
  isActiveUsername.mockResolvedValue(false);
  expect(await authorizeMediaRequest(request(signed))).toBeNull();
  isActiveUsername.mockResolvedValue(true);
  getAvailableLiveSources.mockResolvedValue([]);
  expect(await authorizeMediaRequest(request(signed))).toBeNull();
});
test('signs variant manifests, encryption keys, and segments without cookies', async () => {
  fetch.mockResolvedValue(
    new Response(
      '#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="key.bin"\n#EXTINF:2,\nsegment.ts\n#EXT-X-STREAM-INF:BANDWIDTH=1000\nvariant.m3u8',
    ),
  );
  const response = await proxy(request(signMediaUrl(media, 'viewer')), {
    params: Promise.resolve({ type: 'm3u8' }),
  });
  expect(response.status).toBe(200);
  const text = await response.text();
  const links = [...text.matchAll(/(?:URI="|^)(\/api\/proxy\/[^"\n]+)/gm)].map(
    (match) => match[1],
  );
  expect(links).toHaveLength(3);
  for (const link of links)
    expect(await authorizeMediaRequest(request(link))).toMatchObject({
      username: 'viewer',
    });
});
test('requires login for playlist export and exports only assigned sources with signed media', async () => {
  expect((await playlist(request('/api/live/m3u'))).status).toBe(401);
  getAuthInfoFromCookie.mockResolvedValue({
    username: 'viewer',
    timestamp: Date.now(),
  });
  const response = await playlist(request('/api/live/m3u'));
  const text = await response.text();
  expect(text).toContain('media-sign=');
  expect(getCachedLiveChannels).toHaveBeenCalledWith('allowed');
  expect((await sources(request('/api/live/sources'))).status).toBe(200);
  for (const endpoint of [channels, epg]) {
    expect(
      (await endpoint(request('/api/live/channels?source=restricted&tvgId=1')))
        .status,
    ).toBe(403);
  }
});
test.each(['text/html', 'image/svg+xml', 'image/png'])(
  'rejects active content even with %s MIME',
  async (mime) => {
    const html = '<html><script>window.executed=true</script></html>';
    expect(
      (
        await safeImageResponse(
          new Response(html, { headers: { 'content-type': mime } }),
        )
      ).status,
    ).toBe(415);
    fetch.mockResolvedValue(
      new Response(html, { headers: { 'content-type': mime } }),
    );
    expect(
      (await image(request('/api/image-proxy?url=https://media.example/image')))
        .status,
    ).toBe(415);
    getAuthInfoFromCookie.mockResolvedValue({
      username: 'viewer',
      timestamp: Date.now(),
    });
    fetch.mockResolvedValue(
      new Response(html, { headers: { 'content-type': mime } }),
    );
    expect(
      (
        await proxy(request('/api/proxy/logo?url=https://media.example/logo'), {
          params: Promise.resolve({ type: 'logo' }),
        })
      ).status,
    ).toBe(415);
  },
);
test('serves raster image data with a fixed type and browser safeguards', async () => {
  const response = await safeImageResponse(
    new Response(Buffer.from('GIF89a1234567890'), {
      headers: { 'content-type': 'text/html' },
    }),
  );
  expect(response.status).toBe(200);
  expect(response.headers.get('content-type')).toBe('image/gif');
  expect(response.headers.get('x-content-type-options')).toBe('nosniff');
  expect(response.headers.get('content-security-policy')).toContain('sandbox');
});

test('checks a signed-in viewer source permission before fetching media', async () => {
  getAuthInfoFromCookie.mockResolvedValue({
    username: 'viewer',
    timestamp: Date.now(),
  });
  const response = await proxy(
    request(media.replace('moontv-source=allowed', 'moontv-source=restricted')),
    { params: Promise.resolve({ type: 'm3u8' }) },
  );
  expect(response.status).toBe(401);
  expect(fetch).not.toHaveBeenCalled();
});
