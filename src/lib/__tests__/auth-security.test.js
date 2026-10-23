/** @jest-environment node */
/* global jest, test, expect, beforeEach */
import { NextRequest } from 'next/server';

import { calculateSignature, parseAndVerifyAuthCookie } from '@/lib/auth/edge';
import { getAuthInfoFromCookie } from '@/lib/auth/server';
import {
  getAvailableApiSites,
  getAvailableLiveSources,
  setCachedConfig,
} from '@/lib/config';

jest.mock('server-only', () => ({}));
jest.mock('@/lib/db', () => ({ db: {} }));

const config = () => ({
  SourceConfig: [{ key: 'vod' }],
  LiveConfig: [{ key: 'allowed' }, { key: 'restricted' }],
  UserConfig: {
    Users: [
      {
        username: 'viewer',
        role: 'user',
        banned: false,
        enabledLives: ['allowed'],
      },
      { username: 'blocked', role: 'user', banned: true },
    ],
  },
});
beforeEach(async () => {
  process.env.PASSWORD = 'test-secret';
  await setCachedConfig(config());
});

async function cookie(username, timestamp) {
  return JSON.stringify({
    username,
    role: 'user',
    timestamp,
    signature: await calculateSignature(username, 'user', timestamp),
  });
}
test.each([
  Date.now() - 366 * 86400000,
  Date.now() + 366 * 86400000,
  Infinity,
  1.5,
])('rejects signed invalid timestamp %s', async (timestamp) => {
  expect(
    await parseAndVerifyAuthCookie(await cookie('viewer', timestamp)),
  ).toBeNull();
});
test('accepts a current signed cookie and rejects signature tampering', async () => {
  const raw = await cookie('viewer', Date.now());
  expect(await parseAndVerifyAuthCookie(raw)).toMatchObject({
    username: 'viewer',
  });
  expect(
    await parseAndVerifyAuthCookie(raw.replace('viewer', 'someone')),
  ).toBeNull();
});
test.each(['blocked', 'deleted'])(
  'revokes existing sessions and sources for %s',
  async (username) => {
    const raw = await cookie(username, Date.now());
    const request = new NextRequest('https://site.example/api/search', {
      headers: { cookie: `auth=${encodeURIComponent(raw)}` },
    });
    expect(await getAuthInfoFromCookie(request)).toBeNull();
    expect(await getAvailableApiSites(username)).toEqual([]);
    expect(await getAvailableLiveSources(username)).toEqual([]);
  },
);
test('keeps a permitted user scoped to their assigned live sources', async () => {
  expect(await getAvailableLiveSources('viewer')).toEqual([{ key: 'allowed' }]);
});

test('revoked or empty tag assignments fail closed for both source types', async () => {
  const current = config();
  current.UserConfig.Users[0] = {
    username: 'viewer',
    banned: false,
    tags: ['revoked'],
  };
  await setCachedConfig(current);
  expect(await getAvailableApiSites('viewer')).toEqual([]);
  expect(await getAvailableLiveSources('viewer')).toEqual([]);
});
