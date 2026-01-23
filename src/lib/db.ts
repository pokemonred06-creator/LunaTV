import 'server-only';

import type { AdminConfig } from './admin.types';
import { KvrocksStorage } from './kvrocks.db';
import { FileStorage } from './local.db';
import { RedisStorage } from './redis.db';
import {
  Favorite,
  IAdminStorage,
  ICacheStorage,
  ISkipStorage,
  PlayRecord,
  SkipConfig,
  WithCapabilities,
} from './types';
import { UpstashRedisStorage } from './upstash.db';

// 1. Singleton Type for Next.js Hot Reload
declare global {
  var __dbManager: DbManager | undefined;
}

// 2. Storage & Capability Configuration
type IExtendedStorage = WithCapabilities<AdminConfig>;

// Use <unknown> here to decouple keys from specific config types
type CapabilityKeys = keyof (IAdminStorage<unknown> &
  ISkipStorage &
  ICacheStorage);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyFn = (...args: any[]) => any;
type FnOf<T> = Extract<NonNullable<T>, AnyFn>;

const StorageTypes = {
  LOCAL: 'localstorage',
  REDIS: 'redis',
  UPSTASH: 'upstash',
  KVROCKS: 'kvrocks',
} as const;

type StorageType = (typeof StorageTypes)[keyof typeof StorageTypes];

const CURRENT_STORAGE_TYPE =
  (process.env.NEXT_PUBLIC_STORAGE_TYPE as StorageType) || StorageTypes.LOCAL;

// 3. Fail-Fast Validation (Production Safety)
if (
  process.env.NODE_ENV === 'production' &&
  !Object.values(StorageTypes).includes(CURRENT_STORAGE_TYPE)
) {
  throw new Error(
    `[DbManager] Fatal: Invalid STORAGE_TYPE '${process.env.NEXT_PUBLIC_STORAGE_TYPE}'. Allowed: ${Object.values(StorageTypes).join(', ')}`,
  );
}

// 4. Utility
export function generateStorageKey(source: string, id: string): string {
  return `${source}+${id}`;
}

export class DbManager {
  private storage: IExtendedStorage;

  private constructor() {
    this.storage = this.createStorageFactory();
  }

  // 5. Singleton Accessor (Next.js Safe)
  public static getInstance(): DbManager {
    if (process.env.NODE_ENV !== 'production') {
      if (!globalThis.__dbManager) {
        globalThis.__dbManager = new DbManager();
      }
      return globalThis.__dbManager;
    }
    // In production, standard singleton is fine
    if (!globalThis.__dbManager) {
      globalThis.__dbManager = new DbManager();
    }
    return globalThis.__dbManager;
  }

  private createStorageFactory(): IExtendedStorage {
    console.log(`[DbManager] Initializing storage: ${CURRENT_STORAGE_TYPE}`);
    switch (CURRENT_STORAGE_TYPE) {
      case StorageTypes.REDIS:
        return new RedisStorage();
      case StorageTypes.UPSTASH:
        return new UpstashRedisStorage();
      case StorageTypes.KVROCKS:
        return new KvrocksStorage();
      case StorageTypes.LOCAL:
      default:
        return new FileStorage();
    }
  }

  /**
   * Safe optional method caller.
   * - Constrained to `CapabilityKeys` to prevent misuse on core methods.
   * - Uses `.apply(this.storage)` so adapter methods can access their own `this` (e.g. redis client).
   * - Handles `Partial<>` type inference correctly.
   */
  private async callIfImplemented<K extends CapabilityKeys>(
    method: K,
    ...args: Parameters<FnOf<IExtendedStorage[K]>>
  ): Promise<Awaited<ReturnType<FnOf<IExtendedStorage[K]>>> | null> {
    const fn = this.storage[method] as unknown;

    if (typeof fn === 'function') {
      return (fn as AnyFn).apply(this.storage, args);
    }

    return null;
  }

  // ==============================
  // Core (Direct Passthrough)
  // ==============================

  async getPlayRecord(
    userName: string,
    source: string,
    id: string,
  ): Promise<PlayRecord | null> {
    const key = generateStorageKey(source, id);
    return this.storage.getPlayRecord(userName, key);
  }

  async savePlayRecord(
    userName: string,
    source: string,
    id: string,
    record: PlayRecord,
  ): Promise<void> {
    const key = generateStorageKey(source, id);
    await this.storage.setPlayRecord(userName, key, record);
  }

  async getAllPlayRecords(
    userName: string,
  ): Promise<Record<string, PlayRecord>> {
    return this.storage.getAllPlayRecords(userName);
  }

  async deletePlayRecord(
    userName: string,
    source: string,
    id: string,
  ): Promise<void> {
    const key = generateStorageKey(source, id);
    await this.storage.deletePlayRecord(userName, key);
  }

  async getFavorite(
    userName: string,
    source: string,
    id: string,
  ): Promise<Favorite | null> {
    const key = generateStorageKey(source, id);
    return this.storage.getFavorite(userName, key);
  }

  async saveFavorite(
    userName: string,
    source: string,
    id: string,
    favorite: Favorite,
  ): Promise<void> {
    const key = generateStorageKey(source, id);
    await this.storage.setFavorite(userName, key, favorite);
  }

  async getAllFavorites(userName: string): Promise<Record<string, Favorite>> {
    return this.storage.getAllFavorites(userName);
  }

  async deleteFavorite(
    userName: string,
    source: string,
    id: string,
  ): Promise<void> {
    const key = generateStorageKey(source, id);
    await this.storage.deleteFavorite(userName, key);
  }

  async isFavorited(
    userName: string,
    source: string,
    id: string,
  ): Promise<boolean> {
    const favorite = await this.getFavorite(userName, source, id);
    return favorite !== null;
  }

  async registerUser(userName: string, pass: string): Promise<void> {
    await this.storage.registerUser(userName, pass);
  }

  async verifyUser(userName: string, pass: string): Promise<boolean> {
    return this.storage.verifyUser(userName, pass);
  }

  async checkUserExist(userName: string): Promise<boolean> {
    return this.storage.checkUserExist(userName);
  }

  async changePassword(userName: string, newPass: string): Promise<void> {
    await this.storage.changePassword(userName, newPass);
  }

  async deleteUser(userName: string): Promise<void> {
    await this.storage.deleteUser(userName);
  }

  async getSearchHistory(userName: string): Promise<string[]> {
    return this.storage.getSearchHistory(userName);
  }

  async addSearchHistory(userName: string, keyword: string): Promise<void> {
    await this.storage.addSearchHistory(userName, keyword);
  }

  async deleteSearchHistory(userName: string, keyword?: string): Promise<void> {
    await this.storage.deleteSearchHistory(userName, keyword);
  }

  // ==============================
  // Capabilities (Optional)
  // ==============================

  async getAllUsers(): Promise<string[]> {
    return (await this.callIfImplemented('getAllUsers')) ?? [];
  }

  async getAdminConfig(): Promise<AdminConfig | null> {
    return this.callIfImplemented('getAdminConfig');
  }

  async saveAdminConfig(config: AdminConfig): Promise<void> {
    await this.callIfImplemented('setAdminConfig', config);
  }

  async getSkipConfig(
    userName: string,
    source: string,
    id: string,
  ): Promise<SkipConfig | null> {
    return this.callIfImplemented('getSkipConfig', userName, source, id);
  }

  async setSkipConfig(
    userName: string,
    source: string,
    id: string,
    config: SkipConfig,
  ): Promise<void> {
    await this.callIfImplemented('setSkipConfig', userName, source, id, config);
  }

  async deleteSkipConfig(
    userName: string,
    source: string,
    id: string,
  ): Promise<void> {
    await this.callIfImplemented('deleteSkipConfig', userName, source, id);
  }

  async getAllSkipConfigs(
    userName: string,
  ): Promise<Record<string, SkipConfig>> {
    return (await this.callIfImplemented('getAllSkipConfigs', userName)) ?? {};
  }

  async clearAllData(): Promise<void> {
    if (typeof this.storage.clearAllData === 'function') {
      await this.storage.clearAllData();
    } else {
      throw new Error(
        `Storage type '${CURRENT_STORAGE_TYPE}' does not support clearAllData`,
      );
    }
  }

  async get(key: string): Promise<unknown> {
    return this.callIfImplemented('get', key);
  }

  async set(key: string, value: unknown, ttl?: number): Promise<void> {
    await this.callIfImplemented('set', key, value, ttl);
  }
}

export const db = DbManager.getInstance();
