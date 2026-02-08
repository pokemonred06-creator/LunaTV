/* eslint-disable @typescript-eslint/no-explicit-any */
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

import { AdminConfig } from './admin.types';
import {
  Favorite,
  IAdminStorage,
  ICacheStorage,
  ISkipStorage,
  IStorage,
  PlayRecord,
  SkipConfig,
} from './types';

// Password hashing configuration
const HASH_ITERATIONS = 100_000;
const HASH_KEYLEN = 64;
const HASH_DIGEST = 'sha512';
const SALT_LEN = 16;

/**
 * Hash a password with a random salt
 * Returns format: salt:hash (both hex encoded)
 */
function hashPassword(password: string): string {
  const salt = crypto.randomBytes(SALT_LEN).toString('hex');
  const hash = crypto
    .pbkdf2Sync(password, salt, HASH_ITERATIONS, HASH_KEYLEN, HASH_DIGEST)
    .toString('hex');
  return `${salt}:${hash}`;
}

/**
 * Verify a password against a stored hash
 * Also handles legacy plaintext passwords (auto-upgrade on verify)
 */
function verifyPassword(password: string, stored: string): boolean {
  // Check if stored value is a hashed password (contains colon separator)
  if (stored.includes(':')) {
    const [salt, hash] = stored.split(':');
    const verify = crypto
      .pbkdf2Sync(password, salt, HASH_ITERATIONS, HASH_KEYLEN, HASH_DIGEST)
      .toString('hex');
    // Timing-safe comparison
    if (hash.length !== verify.length) return false;
    return crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(verify));
  }
  // Legacy plaintext comparison (will be upgraded on changePassword)
  return stored === password;
}

const DATA_DIR = path.join(process.cwd(), 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

export class FileStorage
  implements IStorage, IAdminStorage<AdminConfig>, ISkipStorage, ICacheStorage
{
  private data: Record<string, any> = {};
  private loaded = false;

  constructor() {
    this.load();
  }

  private load() {
    try {
      if (fs.existsSync(DB_FILE)) {
        const content = fs.readFileSync(DB_FILE, 'utf-8');
        this.data = JSON.parse(content);
      } else {
        this.data = {};
      }
      this.loaded = true;
    } catch (error) {
      console.error('Failed to load local database:', error);
      this.data = {};
    }
  }

  private save() {
    try {
      const tempFile = `${DB_FILE}.tmp`;
      fs.writeFileSync(tempFile, JSON.stringify(this.data, null, 2));
      fs.renameSync(tempFile, DB_FILE);
    } catch (error) {
      console.error('Failed to save local database:', error);
    }
  }

  // Helper to ensure string
  private ensureString(val: any): string {
    return String(val);
  }

  // ---------- Play Records ----------
  private prKey(user: string, key: string) {
    return `u:${user}:pr:${key}`;
  }

  async getPlayRecord(
    userName: string,
    key: string,
  ): Promise<PlayRecord | null> {
    const val = this.data[this.prKey(userName, key)];
    return val ? (val as PlayRecord) : null;
  }

  async setPlayRecord(
    userName: string,
    key: string,
    record: PlayRecord,
  ): Promise<void> {
    this.data[this.prKey(userName, key)] = record;
    this.save();
  }

  async getAllPlayRecords(
    userName: string,
  ): Promise<{ [key: string]: PlayRecord }> {
    const prefix = `u:${userName}:pr:`;
    const result: Record<string, PlayRecord> = {};
    Object.keys(this.data).forEach((k) => {
      if (k.startsWith(prefix)) {
        const keyPart = k.replace(prefix, '');
        result[keyPart] = this.data[k] as PlayRecord;
      }
    });
    return result;
  }

  async deletePlayRecord(userName: string, key: string): Promise<void> {
    delete this.data[this.prKey(userName, key)];
    this.save();
  }

  // ---------- Favorites ----------
  private favKey(user: string, key: string) {
    return `u:${user}:fav:${key}`;
  }

  async getFavorite(userName: string, key: string): Promise<Favorite | null> {
    const val = this.data[this.favKey(userName, key)];
    return val ? (val as Favorite) : null;
  }

  async setFavorite(
    userName: string,
    key: string,
    favorite: Favorite,
  ): Promise<void> {
    this.data[this.favKey(userName, key)] = favorite;
    this.save();
  }

  async getAllFavorites(
    userName: string,
  ): Promise<{ [key: string]: Favorite }> {
    const prefix = `u:${userName}:fav:`;
    const result: Record<string, Favorite> = {};
    Object.keys(this.data).forEach((k) => {
      if (k.startsWith(prefix)) {
        const keyPart = k.replace(prefix, '');
        result[keyPart] = this.data[k] as Favorite;
      }
    });
    return result;
  }

  async deleteFavorite(userName: string, key: string): Promise<void> {
    delete this.data[this.favKey(userName, key)];
    this.save();
  }

  // ---------- Users ----------
  private userPwdKey(user: string) {
    return `u:${user}:pwd`;
  }

  async registerUser(userName: string, password: string): Promise<void> {
    this.data[this.userPwdKey(userName)] = hashPassword(password);
    this.save();
  }

  async verifyUser(userName: string, password: string): Promise<boolean> {
    const stored = this.data[this.userPwdKey(userName)];
    if (!stored) return false;

    const isValid = verifyPassword(password, stored);

    // Auto-upgrade legacy plaintext passwords to hashed on successful login
    if (isValid && !stored.includes(':')) {
      this.data[this.userPwdKey(userName)] = hashPassword(password);
      this.save();
    }

    return isValid;
  }

  async checkUserExist(userName: string): Promise<boolean> {
    return this.userPwdKey(userName) in this.data;
  }

  async changePassword(userName: string, newPassword: string): Promise<void> {
    this.data[this.userPwdKey(userName)] = hashPassword(newPassword);
    this.save();
  }

  async deleteUser(userName: string): Promise<void> {
    // Delete all keys starting with u:userName:
    const prefix = `u:${userName}:`;
    const keysToDelete = Object.keys(this.data).filter((k) =>
      k.startsWith(prefix),
    );
    keysToDelete.forEach((k) => delete this.data[k]);
    this.save();
  }

  // ---------- Search History ----------
  private shKey(user: string) {
    return `u:${user}:sh`;
  }

  async getSearchHistory(userName: string): Promise<string[]> {
    const val = this.data[this.shKey(userName)];
    return Array.isArray(val) ? (val as string[]) : [];
  }

  async addSearchHistory(userName: string, keyword: string): Promise<void> {
    const key = this.shKey(userName);
    let history = (this.data[key] || []) as string[];
    // Remove duplicates
    history = history.filter((k) => k !== keyword);
    // Add to front
    history.unshift(keyword);
    // Limit to 20
    history = history.slice(0, 20);
    this.data[key] = history;
    this.save();
  }

  async deleteSearchHistory(userName: string, keyword?: string): Promise<void> {
    const key = this.shKey(userName);
    if (!keyword) {
      delete this.data[key];
    } else {
      let history = (this.data[key] || []) as string[];
      history = history.filter((k) => k !== keyword);
      this.data[key] = history;
    }
    this.save();
  }

  async getAllUsers(): Promise<string[]> {
    return Object.keys(this.data)
      .filter((k) => k.endsWith(':pwd'))
      .map((k) => {
        const match = k.match(/^u:(.+?):pwd$/);
        return match ? match[1] : '';
      })
      .filter((u) => u);
  }

  // ---------- Admin Config ----------
  private adminConfigKey() {
    return 'admin:config';
  }

  async getAdminConfig(): Promise<AdminConfig | null> {
    const val = this.data[this.adminConfigKey()];
    return val ? (val as AdminConfig) : null;
  }

  async setAdminConfig(config: AdminConfig): Promise<void> {
    this.data[this.adminConfigKey()] = config;
    this.save();
  }

  // ---------- Skip Config ----------
  private skipConfigKey(user: string, source: string, id: string) {
    return `u:${user}:skip:${source}+${id}`;
  }

  async getSkipConfig(
    userName: string,
    source: string,
    id: string,
  ): Promise<SkipConfig | null> {
    const val = this.data[this.skipConfigKey(userName, source, id)];
    return val ? (val as SkipConfig) : null;
  }

  async setSkipConfig(
    userName: string,
    source: string,
    id: string,
    config: SkipConfig,
  ): Promise<void> {
    this.data[this.skipConfigKey(userName, source, id)] = config;
    this.save();
  }

  async deleteSkipConfig(
    userName: string,
    source: string,
    id: string,
  ): Promise<void> {
    delete this.data[this.skipConfigKey(userName, source, id)];
    this.save();
  }

  async getAllSkipConfigs(
    userName: string,
  ): Promise<{ [key: string]: SkipConfig }> {
    const prefix = `u:${userName}:skip:`;
    const result: Record<string, SkipConfig> = {};
    Object.keys(this.data).forEach((k) => {
      if (k.startsWith(prefix)) {
        const keyPart = k.replace(prefix, '');
        result[keyPart] = this.data[k] as SkipConfig;
      }
    });
    return result;
  }

  async clearAllData(): Promise<void> {
    this.data = {};
    this.save();
  }

  // ---------- Generic Cache ----------
  async get(key: string): Promise<any> {
    return this.data[key] || null;
  }

  async set(key: string, value: any, ttl?: number): Promise<void> {
    this.data[key] = value;
    this.save();
    // TTL is not implemented for local file storage in this simple version
  }
}
