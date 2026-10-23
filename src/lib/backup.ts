import { randomUUID } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { gzip } from 'node:zlib';
import { z } from 'zod';

import type { AdminConfig } from '@/lib/admin.types';
import { getOwnerUsername } from '@/lib/auth/shared';
import { configSelfCheck, setCachedConfig } from '@/lib/config';
import { ServerCrypto } from '@/lib/crypto';
import { db } from '@/lib/db';
import { isPasswordHash } from '@/lib/password';
import {
  getStoredUserPasswordHash,
  setStoredUserPasswordHash,
} from '@/lib/storage-credentials';
import type { IStorage } from '@/lib/types';

export const MAX_BACKUP_JSON_BYTES = 64 * 1024 * 1024;
const gzipAsync = promisify(gzip);
const strings = z.array(z.string());
const name = z
  .string()
  .min(1)
  .refine((s) => !/[:*?[\]\r\n\0]/.test(s), 'Invalid username');
const source = z.object({
  key: z.string().min(1),
  name: z.string(),
  from: z.enum(['config', 'custom']).optional(),
  disabled: z.boolean().optional(),
});
const configSchema = z
  .object({
    ConfigFile: z.string(),
    ConfigSubscription: z.object({
      URL: z.string(),
      AutoUpdate: z.boolean(),
      LastCheck: z.string(),
    }),
    SiteConfig: z
      .object({
        SiteName: z.string(),
        Announcement: z.string(),
        SearchDownstreamMaxPage: z.number().finite(),
        SiteInterfaceCacheTime: z.number().finite(),
        DoubanProxyType: z.enum([
          'direct',
          'custom',
          'cors-proxy-zwei',
          'cmliussss-cdn-tencent',
          'cmliussss-cdn-ali',
        ]),
        DoubanProxy: z.string(),
        DoubanImageProxyType: z.enum([
          'direct',
          'custom',
          'cmliussss-cdn-tencent',
          'cmliussss-cdn-ali',
        ]),
        DoubanImageProxy: z.string(),
        DisableYellowFilter: z.boolean(),
        FluidSearch: z.boolean(),
        DoubanDataCacheTTL: z.number().finite().optional(),
        ImageCacheTTL: z.number().finite().optional(),
        DebugLogs: z.boolean().optional(),
        SeasonalEffects: z
          .object({
            enabled: z.boolean(),
            season: z.enum([
              'auto',
              'spring',
              'summer',
              'autumn',
              'winter',
              'off',
            ]),
            intensity: z.enum(['light', 'normal', 'heavy']),
          })
          .optional(),
      })
      .passthrough(),
    UserConfig: z.object({
      Users: z.array(
        z
          .object({
            username: name,
            role: z.enum(['owner', 'admin', 'user']),
            banned: z.boolean(),
            enabledApis: strings.optional(),
            enabledLives: strings.optional(),
            tags: strings.optional(),
            disableYellowFilter: z.boolean().optional(),
          })
          .passthrough(),
      ),
      Tags: z
        .array(
          z.object({
            name: z.string(),
            color: z.string().optional(),
            enabledApis: strings.optional(),
            enabledLives: strings.optional(),
          }),
        )
        .optional(),
    }),
    SourceConfig: z.array(
      source
        .extend({ api: z.string(), detail: z.string().optional() })
        .passthrough(),
    ),
    LiveConfig: z
      .array(
        source
          .extend({
            url: z.string(),
            ua: z.string().optional(),
            epg: z.string().optional(),
            channelNumber: z.number().finite().optional(),
          })
          .passthrough(),
      )
      .default([]),
    CustomCategories: z
      .array(
        z.object({
          name: z.string(),
          type: z.enum(['movie', 'tv']),
          query: z.string(),
          from: z.enum(['config', 'custom']).optional(),
          disabled: z.boolean().optional(),
        }),
      )
      .default([]),
  })
  .passthrough();
const record = z.object({
  title: z.string(),
  source_name: z.string(),
  cover: z.string(),
  year: z.string(),
  index: z.number().finite(),
  total_episodes: z.number().finite(),
  play_time: z.number().finite(),
  total_time: z.number().finite(),
  save_time: z.number().finite(),
  search_title: z.string(),
  category: z.string().optional(),
});
const favorite = z.object({
  source_name: z.string(),
  total_episodes: z.number().finite(),
  title: z.string(),
  year: z.string(),
  cover: z.string(),
  save_time: z.number().finite(),
  search_title: z.string(),
  origin: z.enum(['vod', 'live']).optional(),
});
const skip = z.object({
  enable: z.boolean(),
  intro_time: z.number().finite(),
  outro_time: z.number().finite(),
});
const schema = z.object({
  timestamp: z.string().optional(),
  serverVersion: z.string().optional(),
  data: z.object({
    adminConfig: configSchema,
    userData: z.record(
      name,
      z.object({
        passwordHash: z.string().refine(isPasswordHash).nullable().optional(),
        password: z.string().optional(),
        playRecords: z.record(z.string(), record).default({}),
        favorites: z.record(z.string(), favorite).default({}),
        searchHistory: strings.default([]),
        skipConfigs: z
          .record(z.string().regex(/^[^+]+\+.+$/), skip)
          .default({}),
      }),
    ),
  }),
});
export type Backup = Omit<z.infer<typeof schema>, 'data'> & {
  data: {
    adminConfig: AdminConfig;
    userData: z.infer<typeof schema>['data']['userData'];
  };
};

function storage() {
  return (db as unknown as { storage: IStorage }).storage;
}

export function validateBackup(value: unknown): Backup {
  const backup = schema.parse(value);
  const adminConfig = configSelfCheck(backup.data.adminConfig as AdminConfig);
  return { ...backup, data: { ...backup.data, adminConfig } };
}

export async function captureBackup() {
  const config = await db.getAdminConfig();
  if (!config) throw new Error('Cannot snapshot existing configuration');
  const users = new Set([
    getOwnerUsername(),
    ...(await db.getAllUsers()),
    ...config.UserConfig.Users.map((user) => user.username),
  ]);
  const userData: Backup['data']['userData'] = Object.create(null);
  for (const username of users) {
    userData[username] = {
      passwordHash: await getStoredUserPasswordHash(storage(), username),
      playRecords: await db.getAllPlayRecords(username),
      favorites: await db.getAllFavorites(username),
      searchHistory: await db.getSearchHistory(username),
      skipConfigs: await db.getAllSkipConfigs(username),
    };
  }
  return {
    timestamp: new Date().toISOString(),
    data: { adminConfig: structuredClone(config), userData },
  };
}

async function applyBackup(backup: Pick<Backup, 'data'>) {
  await db.clearAllData();
  await db.saveAdminConfig(backup.data.adminConfig as AdminConfig);
  for (const [username, user] of Object.entries(backup.data.userData)) {
    if (user.passwordHash)
      await setStoredUserPasswordHash(storage(), username, user.passwordHash);
    else if (user.password) await db.registerUser(username, user.password);
    for (const [key, record] of Object.entries(user.playRecords))
      await storage().setPlayRecord(username, key, record);
    for (const [key, favorite] of Object.entries(user.favorites))
      await storage().setFavorite(username, key, favorite);
    for (const keyword of [...user.searchHistory].reverse())
      await db.addSearchHistory(username, keyword);
    for (const [key, config] of Object.entries(user.skipConfigs)) {
      const separator = key.indexOf('+');
      await db.setSkipConfig(
        username,
        key.slice(0, separator),
        key.slice(separator + 1),
        config,
      );
    }
  }
  await setCachedConfig(backup.data.adminConfig as AdminConfig);
}

let restoring = false;
export async function restoreBackup(backup: Backup, password: string) {
  if (restoring) throw new Error('Another restore is already in progress');
  restoring = true;
  try {
    const previous = await captureBackup();
    const json = JSON.stringify(previous);
    if (Buffer.byteLength(json) > MAX_BACKUP_JSON_BYTES)
      throw new Error('Recovery snapshot exceeds backup size limit');
    const compressed = await gzipAsync(json);
    const encrypted = await ServerCrypto.encrypt(
      compressed.toString('base64'),
      password,
      0,
      'backup',
    );
    const directory = path.join(process.cwd(), 'data', 'recovery');
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const recovery = path.join(directory, `before-import-${randomUUID()}.dat`);
    // A durable, password-protected recovery file must exist before any destructive write.
    await writeFile(recovery, encrypted, {
      mode: 0o600,
      flag: 'wx',
      flush: true,
    });
    try {
      await applyBackup(backup);
    } catch (error) {
      try {
        await applyBackup(previous);
      } catch {
        throw new Error(
          `Restore and rollback failed. Recover the original data from ${recovery} using the import password.`,
          { cause: error },
        );
      }
      throw new Error(
        `Restore failed; original data restored. Recovery copy: ${recovery}`,
        { cause: error },
      );
    }
    await rm(recovery).catch(() => {});
  } finally {
    restoring = false;
  }
}
