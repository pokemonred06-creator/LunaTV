import { createClient, RedisClientType } from 'redis';
import 'server-only';

import type { AdminConfig } from './admin.types';
import {
  Favorite,
  IAdminStorage,
  ICacheStorage,
  ISkipStorage,
  IStorage,
  PlayRecord,
  SkipConfig,
} from './types';

export class RedisStorage
  implements IStorage, IAdminStorage<AdminConfig>, ISkipStorage, ICacheStorage
{
  private client: RedisClientType;

  constructor() {
    this.client = createClient({ url: process.env.REDIS_URL });
    this.client.connect().catch(console.error);
  }

  // --- Core (IStorage) ---

  async getPlayRecord(
    userName: string,
    key: string,
  ): Promise<PlayRecord | null> {
    const data = await this.client.get(`record:${userName}:${key}`);
    return data ? JSON.parse(data) : null;
  }

  async setPlayRecord(
    userName: string,
    key: string,
    record: PlayRecord,
  ): Promise<void> {
    await this.client.set(`record:${userName}:${key}`, JSON.stringify(record));
  }

  async getAllPlayRecords(
    userName: string,
  ): Promise<Record<string, PlayRecord>> {
    // Basic implementation using keys scan - simplified for now
    // In production, might want a set of keys per user to avoid scan
    const keys = await this.client.keys(`record:${userName}:*`);
    const result: Record<string, PlayRecord> = {};
    for (const k of keys) {
      const val = await this.client.get(k);
      if (val) {
        const shortKey = k.replace(`record:${userName}:`, '');
        result[shortKey] = JSON.parse(val);
      }
    }
    return result;
  }

  async deletePlayRecord(userName: string, key: string): Promise<void> {
    await this.client.del(`record:${userName}:${key}`);
  }

  async getFavorite(userName: string, key: string): Promise<Favorite | null> {
    const data = await this.client.get(`fav:${userName}:${key}`);
    return data ? JSON.parse(data) : null;
  }

  async setFavorite(
    userName: string,
    key: string,
    favorite: Favorite,
  ): Promise<void> {
    await this.client.set(`fav:${userName}:${key}`, JSON.stringify(favorite));
  }

  async getAllFavorites(userName: string): Promise<Record<string, Favorite>> {
    const keys = await this.client.keys(`fav:${userName}:*`);
    const result: Record<string, Favorite> = {};
    for (const k of keys) {
      const val = await this.client.get(k);
      if (val) {
        const shortKey = k.replace(`fav:${userName}:`, '');
        result[shortKey] = JSON.parse(val);
      }
    }
    return result;
  }

  async deleteFavorite(userName: string, key: string): Promise<void> {
    await this.client.del(`fav:${userName}:${key}`);
  }

  async registerUser(userName: string, pass: string): Promise<void> {
    await this.client.set(`u:${userName}:pwd`, pass);
  }

  async verifyUser(userName: string, pass: string): Promise<boolean> {
    const stored = await this.client.get(`u:${userName}:pwd`);
    return stored === pass;
  }

  async checkUserExist(userName: string): Promise<boolean> {
    const exists = await this.client.exists(`u:${userName}:pwd`);
    return exists > 0;
  }

  async changePassword(userName: string, newPass: string): Promise<void> {
    await this.client.set(`u:${userName}:pwd`, newPass);
  }

  async deleteUser(userName: string): Promise<void> {
    const keys = await this.client.keys(`u:${userName}:*`);
    // Also delete records/favs
    const recKeys = await this.client.keys(`record:${userName}:*`);
    const favKeys = await this.client.keys(`fav:${userName}:*`);
    const allKeys = [...keys, ...recKeys, ...favKeys];
    if (allKeys.length > 0) {
      await this.client.del(allKeys);
    }
  }

  async getSearchHistory(userName: string): Promise<string[]> {
    const data = await this.client.get(`sh:${userName}`);
    return data ? JSON.parse(data) : [];
  }

  async addSearchHistory(userName: string, keyword: string): Promise<void> {
    const key = `sh:${userName}`;
    let history = await this.getSearchHistory(userName);
    history = history.filter((k) => k !== keyword);
    history.unshift(keyword);
    history = history.slice(0, 20);
    await this.client.set(key, JSON.stringify(history));
  }

  async deleteSearchHistory(userName: string, keyword?: string): Promise<void> {
    const key = `sh:${userName}`;
    if (!keyword) {
      await this.client.del(key);
    } else {
      let history = await this.getSearchHistory(userName);
      history = history.filter((k) => k !== keyword);
      await this.client.set(key, JSON.stringify(history));
    }
  }

  // --- Admin (IAdminStorage) ---

  async getAdminConfig(): Promise<AdminConfig | null> {
    const data = await this.client.get('admin:config');
    return data ? JSON.parse(data) : null;
  }

  async setAdminConfig(config: AdminConfig): Promise<void> {
    await this.client.set('admin:config', JSON.stringify(config));
  }

  async getAllUsers(): Promise<string[]> {
    // This is expensive with KEYS, but acceptable for admin use
    const keys = await this.client.keys('u:*:pwd');
    return keys
      .map((k) => {
        const match = k.match(/^u:(.+?):pwd$/);
        return match ? match[1] : '';
      })
      .filter((u) => u);
  }

  // --- Skip (ISkipStorage) ---

  async getSkipConfig(
    userName: string,
    source: string,
    id: string,
  ): Promise<SkipConfig | null> {
    const data = await this.client.get(`skip:${userName}:${source}+${id}`);
    return data ? JSON.parse(data) : null;
  }

  async setSkipConfig(
    userName: string,
    source: string,
    id: string,
    config: SkipConfig,
  ): Promise<void> {
    await this.client.set(
      `skip:${userName}:${source}+${id}`,
      JSON.stringify(config),
    );
  }

  async deleteSkipConfig(
    userName: string,
    source: string,
    id: string,
  ): Promise<void> {
    await this.client.del(`skip:${userName}:${source}+${id}`);
  }

  async getAllSkipConfigs(
    userName: string,
  ): Promise<Record<string, SkipConfig>> {
    const keys = await this.client.keys(`skip:${userName}:*`);
    const result: Record<string, SkipConfig> = {};
    for (const k of keys) {
      const val = await this.client.get(k);
      if (val) {
        // key is skip:user:source+id
        const shortKey = k.replace(`skip:${userName}:`, '');
        result[shortKey] = JSON.parse(val);
      }
    }
    return result;
  }

  // --- Cache (ICacheStorage) ---

  async clearAllData(): Promise<void> {
    await this.client.flushDb();
  }

  async get(key: string): Promise<unknown> {
    const val = await this.client.get(key);
    try {
      return val ? JSON.parse(val) : null;
    } catch {
      return val;
    }
  }

  async set(key: string, value: unknown, ttl?: number): Promise<void> {
    const valStr = typeof value === 'string' ? value : JSON.stringify(value);
    if (ttl) {
      await this.client.set(key, valStr, { EX: ttl });
    } else {
      await this.client.set(key, valStr);
    }
  }
}
