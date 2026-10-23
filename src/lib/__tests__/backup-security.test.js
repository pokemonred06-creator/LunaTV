/** @jest-environment node */
/* global jest, test, expect, beforeEach */
import { NextRequest } from 'next/server';
import { randomBytes } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';

import { captureBackup, restoreBackup, validateBackup } from '@/lib/backup';
import { configSelfCheck, setCachedConfig } from '@/lib/config';
import { ServerCrypto } from '@/lib/crypto';
import { db } from '@/lib/db';

import { POST as exportData } from '@/app/api/admin/data_migration/export/route';
import { POST as importData } from '@/app/api/admin/data_migration/import/route';

jest.mock('server-only', () => ({}));
jest.mock('@/lib/auth/server', () => ({
  getAuthInfoFromCookie: async () => ({
    username: process.env.USERNAME || 'admin',
  }),
}));
jest.mock('node:fs/promises', () => ({
  mkdir: jest.fn(),
  writeFile: jest.fn(),
  rm: jest.fn(),
}));
jest.mock('@/lib/config', () => ({
  configSelfCheck: jest.fn((config) => config),
  setCachedConfig: jest.fn(),
}));
jest.mock('@/lib/db', () => ({
  db: {
    getAdminConfig: jest.fn(),
    getAllUsers: jest.fn(),
    getAllPlayRecords: jest.fn(),
    getAllFavorites: jest.fn(),
    getSearchHistory: jest.fn(),
    getAllSkipConfigs: jest.fn(),
    clearAllData: jest.fn(),
    saveAdminConfig: jest.fn(),
    registerUser: jest.fn(),
    addSearchHistory: jest.fn(),
    setSkipConfig: jest.fn(),
    storage: {
      setPlayRecord: jest.fn(),
      setFavorite: jest.fn(),
      client: { get: jest.fn() },
    },
  },
}));
const adminConfig = () => ({
  ConfigFile: '',
  ConfigSubscription: { URL: '', AutoUpdate: false, LastCheck: '' },
  SiteConfig: {
    SiteName: 'Original',
    Announcement: '',
    SearchDownstreamMaxPage: 1,
    SiteInterfaceCacheTime: 60,
    DoubanProxyType: 'direct',
    DoubanProxy: '',
    DoubanImageProxyType: 'direct',
    DoubanImageProxy: '',
    DisableYellowFilter: false,
    FluidSearch: false,
  },
  UserConfig: { Users: [{ username: 'viewer', role: 'user', banned: false }] },
  SourceConfig: [],
  LiveConfig: [],
  CustomCategories: [],
});
const data = () => ({
  data: {
    adminConfig: adminConfig(),
    userData: { viewer: { searchHistory: ['new', 'old'] } },
  },
});
beforeEach(() => {
  jest.clearAllMocks();
  db.getAdminConfig.mockResolvedValue(adminConfig());
  db.getAllUsers.mockResolvedValue(['viewer']);
  db.getAllPlayRecords.mockResolvedValue({});
  db.getAllFavorites.mockResolvedValue({});
  db.getSearchHistory.mockResolvedValue(['original']);
  db.getAllSkipConfigs.mockResolvedValue({});
  db.storage.client.get.mockResolvedValue(null);
  mkdir.mockResolvedValue(undefined);
  writeFile.mockResolvedValue(undefined);
  rm.mockResolvedValue(undefined);
});
test('large backup encryption round-trips while auth token limits remain small', async () => {
  const payload = randomBytes(24000).toString('base64');
  const encrypted = await ServerCrypto.encrypt(
    payload,
    'backup-password',
    0,
    'backup',
  );
  expect(encrypted.length).toBeGreaterThan(8192);
  expect(
    await ServerCrypto.decrypt(encrypted, 'backup-password', 'backup'),
  ).toBe(payload);
  expect(await ServerCrypto.decrypt(encrypted, 'backup-password')).toBeNull();
  expect(
    await ServerCrypto.decrypt(encrypted, 'wrong-password', 'backup'),
  ).toBeNull();
  await expect(
    ServerCrypto.encrypt(payload, 'backup-password'),
  ).rejects.toThrow('size limit');
});
test.each([
  (value) => {
    value.data.adminConfig.SourceConfig = [null];
  },
  (value) => {
    value.data.adminConfig.UserConfig.Users = [null];
  },
  (value) => {
    value.data.userData.viewer.searchHistory = [null];
  },
  (value) => {
    value.data.userData.viewer.playRecords = { bad: {} };
  },
  (value) => {
    value.data.userData.viewer.skipConfigs = { bad: {} };
  },
  (value) => {
    value.data.userData.viewer.passwordHash = 'invalid';
  },
])('rejects invalid nested backup data before touching storage', (mutate) => {
  const value = data();
  mutate(value);
  expect(() => validateBackup(value)).toThrow();
  expect(db.clearAllData).not.toHaveBeenCalled();
});
test('writes protected recovery data first, then restores without mutating search order', async () => {
  const backup = validateBackup(data());
  await restoreBackup(backup, 'backup-password');
  expect(writeFile.mock.invocationCallOrder[0]).toBeLessThan(
    db.clearAllData.mock.invocationCallOrder[0],
  );
  expect(writeFile).toHaveBeenCalledWith(
    expect.stringContaining('/data/recovery/before-import-'),
    expect.any(String),
    { mode: 0o600, flag: 'wx', flush: true },
  );
  expect(
    await ServerCrypto.decrypt(
      writeFile.mock.calls[0][1],
      'backup-password',
      'backup',
    ),
  ).toEqual(expect.any(String));
  expect(
    db.addSearchHistory.mock.calls.filter(([name]) => name === 'viewer'),
  ).toEqual([
    ['viewer', 'old'],
    ['viewer', 'new'],
  ]);
  expect(backup.data.userData.viewer.searchHistory).toEqual(['new', 'old']);
  expect(rm).toHaveBeenCalled();
});
test('a recovery-file failure leaves existing data untouched', async () => {
  writeFile.mockRejectedValueOnce(new Error('disk full'));
  await expect(restoreBackup(validateBackup(data()), 'pw')).rejects.toThrow(
    'disk full',
  );
  expect(db.clearAllData).not.toHaveBeenCalled();
});
test('rolls back a partially written import and retains its recovery archive', async () => {
  db.addSearchHistory.mockRejectedValueOnce(new Error('write failed'));
  await expect(restoreBackup(validateBackup(data()), 'pw')).rejects.toThrow(
    'original data restored',
  );
  expect(db.clearAllData).toHaveBeenCalledTimes(2);
  expect(setCachedConfig).toHaveBeenLastCalledWith(
    expect.objectContaining({
      SiteConfig: expect.objectContaining({ SiteName: 'Original' }),
    }),
  );
  expect(rm).not.toHaveBeenCalled();
});
test('retains recovery data when the storage outage prevents rollback', async () => {
  db.saveAdminConfig
    .mockRejectedValueOnce(new Error('offline'))
    .mockRejectedValueOnce(new Error('offline'));
  await expect(restoreBackup(validateBackup(data()), 'pw')).rejects.toThrow(
    'Restore and rollback failed',
  );
  expect(rm).not.toHaveBeenCalled();
});
test('snapshots configuration-only users as well as credential-bearing users', async () => {
  db.getAllUsers.mockResolvedValue([]);
  expect((await captureBackup()).data.userData.viewer).toBeDefined();
  expect(configSelfCheck).not.toHaveBeenCalled();
});

test('export and multipart import round-trip a backup larger than the old token cap', async () => {
  const previousStorageType = process.env.NEXT_PUBLIC_STORAGE_TYPE;
  process.env.NEXT_PUBLIC_STORAGE_TYPE = 'redis';
  try {
    const config = adminConfig();
    config.ConfigFile = JSON.stringify({
      metadata: randomBytes(24000).toString('base64'),
    });
    db.getAdminConfig.mockResolvedValue(config);
    const exported = await exportData(
      new NextRequest('http://site.example/api/admin/data_migration/export', {
        method: 'POST',
        body: JSON.stringify({ password: 'backup-password' }),
      }),
    );
    expect(exported.status).toBe(200);
    const encrypted = await exported.text();
    expect(encrypted.length).toBeGreaterThan(8192);
    const request = (password) => {
      const form = new FormData();
      form.set('password', password);
      form.set('file', new File([encrypted], 'backup.dat'));
      return new NextRequest(
        'http://site.example/api/admin/data_migration/import',
        { method: 'POST', body: form },
      );
    };
    expect((await importData(request('wrong-password'))).status).toBe(400);
    expect(db.clearAllData).not.toHaveBeenCalled();
    expect((await importData(request('backup-password'))).status).toBe(200);
    expect(db.saveAdminConfig).toHaveBeenCalledWith(
      expect.objectContaining({ ConfigFile: config.ConfigFile }),
    );
  } finally {
    if (previousStorageType === undefined)
      delete process.env.NEXT_PUBLIC_STORAGE_TYPE;
    else process.env.NEXT_PUBLIC_STORAGE_TYPE = previousStorageType;
  }
});
