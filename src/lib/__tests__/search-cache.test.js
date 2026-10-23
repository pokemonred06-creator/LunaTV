/** @jest-environment node */
/* global jest, test, expect, beforeEach, afterEach */
jest.mock('@/lib/config', () => ({
  getCacheTime: jest.fn().mockResolvedValue(600),
}));
jest.mock('@/lib/db', () => ({ db: { get: jest.fn(), set: jest.fn() } }));

let cache;
let db;
beforeEach(async () => {
  jest.resetModules();
  jest.useFakeTimers();
  cache = await import('@/lib/search-cache');
  db = (await import('@/lib/db')).db;
});
afterEach(() => {
  jest.clearAllTimers();
  jest.useRealTimers();
});

test.each([
  ['search', 1000],
  ['detail', 500],
])(
  '%s cache enforces its limit during bursts and persistent backfills',
  async (kind, limit) => {
    const read = (id) =>
      kind === 'search'
        ? cache.getCachedSearchPage('source', id, 1)
        : cache.getCachedDetail('source', id);
    const write = (id) =>
      kind === 'search'
        ? cache.setCachedSearchPage('source', id, 1, 'ok', [{ id }])
        : cache.setCachedDetail('source', id, 'ok', [{ id }]);

    for (let i = 0; i <= limit; i++) await write(String(i));
    db.get.mockClear();
    expect(await read(String(limit))).toMatchObject({
      data: [{ id: String(limit) }],
    });
    expect(db.get).not.toHaveBeenCalled();
    expect(await read('0')).toBeNull();
    expect(db.get).toHaveBeenCalledTimes(1);

    db.get.mockImplementation(async (key) => ({
      status: 'ok',
      data: [{ id: key }],
      expiresAt: Date.now() + 600000,
    }));
    for (let i = 0; i <= limit; i++) await read(`backfill-${i}`);
    db.get.mockClear();
    await read(`backfill-${limit}`);
    expect(db.get).not.toHaveBeenCalled();
    await read('backfill-0');
    expect(db.get).toHaveBeenCalledTimes(1);
  },
);

test('expired persistent entries are not returned', async () => {
  db.get.mockResolvedValue({
    status: 'ok',
    data: [],
    expiresAt: Date.now() - 1,
  });
  expect(await cache.getCachedSearchPage('source', 'movie', 1)).toBeNull();
  expect(await cache.getCachedDetail('source', '1')).toBeNull();
});
