/** @jest-environment node */
/* global jest, test, expect, beforeEach, afterAll */
import dns from 'node:dns/promises';
import { once } from 'node:events';
import http from 'node:http';
import { fetch as rawFetch } from 'undici';

import { createGuardedAgent, guardedFetch } from '@/lib/guarded-fetch';
import { isBlockedRemoteIp } from '@/lib/request-security';
import {
  isBlockedIp,
  resolveSafeRelayUrl,
  validateSafeUrl,
} from '@/lib/ssrf-guard';

jest.mock('node:dns/promises', () => ({ lookup: jest.fn() }));
beforeEach(() => dns.lookup.mockReset());

const agents = [];
afterAll(async () => {
  await Promise.all(agents.map((a) => a.close()));
});

// A benign local listener detects any accidental connection to the rebound IP.
test('connection-time lookup blocks a host rebinding after a successful preflight', async () => {
  let requests = 0;
  const server = http.createServer((req, res) => {
    requests++;
    res.end('private');
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    dns.lookup
      .mockResolvedValueOnce([{ address: '1.1.1.1', family: 4 }])
      .mockResolvedValue([{ address: '127.0.0.1', family: 4 }]);
    const url = `http://rebind.invalid:${server.address().port}/`;
    expect(await validateSafeUrl(url)).toBe(true);
    await expect(guardedFetch(url)).rejects.toThrow();
    expect(requests).toBe(0);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test.each(['127.0.0.1', '[::ffff:7f00:1]', '169.254.169.254'])(
  'numeric destination %s cannot bypass DNS checks',
  async (address) => {
    await expect(guardedFetch(`http://${address}/`)).rejects.toThrow('SSRF');
    expect(dns.lookup).not.toHaveBeenCalled();
  },
);

test('mixed public/private DNS answers fail closed', async () => {
  dns.lookup.mockResolvedValue([
    { address: '1.1.1.1', family: 4 },
    { address: '::1', family: 6 },
  ]);
  await expect(guardedFetch('http://mixed.invalid')).rejects.toThrow();
});

test('implicit redirect following is forbidden', async () => {
  await expect(
    guardedFetch('http://example.com', { redirect: 'follow' }),
  ).rejects.toThrow('redirect');
});

test('media FakeIP policy stays separate from strict remote config policy', () => {
  expect(isBlockedIp('198.18.0.1')).toBe(false);
  expect(isBlockedRemoteIp('198.18.0.1')).toBe(true);
});

test('guarded agent preserves hostname and returns redirects without following', async () => {
  const hosts = [];
  const server = http.createServer((req, res) => {
    hosts.push(req.headers.host);
    res.writeHead(302, { location: 'http://127.0.0.2/private' });
    res.end();
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  // Inject a test-only policy allowing exactly this fixture listener.
  const agent = createGuardedAgent((ip) => ip !== '127.0.0.1');
  agents.push(agent);
  dns.lookup.mockResolvedValue([{ address: '127.0.0.1', family: 4 }]);
  try {
    const host = `fixture.invalid:${server.address().port}`;
    const response = await rawFetch(`http://${host}/`, {
      dispatcher: agent,
      redirect: 'manual',
    });
    expect(response.status).toBe(302);
    await response.body.cancel();
    expect(hosts).toEqual([host]);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});

test('non-HTTP relay receives a checked numeric address', async () => {
  dns.lookup.mockResolvedValue([{ address: '1.1.1.1', family: 4 }]);
  const result = await resolveSafeRelayUrl(
    'rtmp://stream.invalid/live/a',
    new Set(['rtmp:']),
    new Set([1935]),
  );
  expect(result.toString()).toBe('rtmp://1.1.1.1/live/a');
});

test('non-HTTP relay rejects rebinding between validation and pinning', async () => {
  dns.lookup
    .mockResolvedValueOnce([{ address: '1.1.1.1', family: 4 }])
    .mockResolvedValue([{ address: '127.0.0.1', family: 4 }]);
  await expect(
    resolveSafeRelayUrl(
      'rtmp://stream.invalid/live/a',
      new Set(['rtmp:']),
      new Set([1935]),
    ),
  ).rejects.toThrow('SSRF');
});
