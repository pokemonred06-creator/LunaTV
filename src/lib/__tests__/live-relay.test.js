/** @jest-environment node */
/* global jest, test, expect */
import { EventEmitter } from 'node:events';

jest.mock('node:child_process', () => ({ spawn: jest.fn() }));
jest.mock('node:fs/promises', () => ({
  mkdtemp: jest.fn(),
  readFile: jest.fn(),
  rm: jest.fn().mockResolvedValue(undefined),
}));

test('counts a starting relay once and admits two simultaneous compatibility sessions', async () => {
  const { spawn } = await import('node:child_process');
  const { mkdtemp, readFile } = await import('node:fs/promises');
  const children = [];
  spawn.mockImplementation(() => {
    const child = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = jest.fn();
    children.push(child);
    return child;
  });
  let directory = 0;
  mkdtemp.mockImplementation(async () => `/tmp/relay-test-${++directory}`);
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  readFile.mockImplementation(async () => {
    await gate;
    return '#EXTM3U\n#EXTINF:2,\nsegment-0.ts';
  });
  const { getLiveRelay, readLiveRelay } = await import('@/lib/live-relay');
  const one = getLiveRelay(
    JSON.stringify(['viewer', 'allowed', 'one']),
    'http://127.0.0.1/input',
    '',
  );
  await Promise.resolve();
  await Promise.resolve();
  const two = getLiveRelay('two', 'http://127.0.0.1/input', '');
  await Promise.resolve();
  await Promise.resolve();
  await expect(
    getLiveRelay('three', 'http://127.0.0.1/input', ''),
  ).rejects.toThrow('busy');
  release();
  const ids = await Promise.all([one, two]);
  expect(new Set(ids).size).toBe(2);
  expect(children).toHaveLength(2);
  expect(
    await readLiveRelay(ids[0], 'index.m3u8', 'other-user', ['allowed']),
  ).toBeNull();
  expect(
    await readLiveRelay(ids[0], 'index.m3u8', 'viewer', ['restricted']),
  ).toBeNull();
  expect(
    await readLiveRelay(ids[0], 'index.m3u8', 'viewer', ['allowed']),
  ).toContain('#EXTM3U');
  globalThis.__lunatvLiveRelays.clear();
  globalThis.__lunatvPendingRelays.clear();
  clearInterval(globalThis.__lunatvRelayCleanup);
});
