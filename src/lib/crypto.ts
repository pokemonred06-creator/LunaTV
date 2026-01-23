import { webcrypto } from 'node:crypto';
import 'server-only';

// --- Configuration & Constants ---

const cryptoObj = (globalThis.crypto ?? webcrypto) as unknown as Crypto;

const VERSION = 1;
const SUPPORTED_VERSIONS = new Set([1]);

// AES-GCM Constants
const SALT_LEN = 16;
const IV_LEN = 12;
const TAG_LEN = 16;

// Security Limits
const MAX_TOKEN_LENGTH = 8192; // 8KB limit prevents DoS via massive payloads
const MAX_TTL_SECONDS = 10 * 365 * 24 * 3600; // 10 years cap

// Iteration Control (Fail-Fast Logic)
const RAW_ITER = Number(process.env.AUTH_CRYPTO_ITERATIONS ?? 210_000);
// Enforce safe boundaries for PBKDF2 in production
const PBKDF2_ITERATIONS =
  Number.isFinite(RAW_ITER) && RAW_ITER >= 100_000 && RAW_ITER <= 2_000_000
    ? Math.trunc(RAW_ITER)
    : 210_000;

if (process.env.NODE_ENV === 'production' && PBKDF2_ITERATIONS < 150_000) {
  // Hard failure on boot if configuration is unsafe
  throw new Error(
    `Fatal: AUTH_CRYPTO_ITERATIONS too low (${PBKDF2_ITERATIONS})`,
  );
}

const PBKDF2_HASH = 'SHA-256';

// --- Helpers ---

const enc = new TextEncoder();
const dec = new TextDecoder();

function concatBytes(...chunks: Uint8Array[]): Uint8Array {
  return Buffer.concat(chunks);
}

function writeU64BE(value: bigint): Uint8Array {
  const buf = Buffer.allocUnsafe(8);
  buf.writeBigUInt64BE(value, 0);
  return buf;
}

function readU64BE(buf: Uint8Array): bigint {
  return Buffer.from(buf).readBigUInt64BE(0);
}

async function deriveKey(
  password: string,
  salt: Uint8Array,
): Promise<CryptoKey> {
  const baseKey = await cryptoObj.subtle.importKey(
    'raw',
    enc.encode(password),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  return cryptoObj.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt,
      iterations: PBKDF2_ITERATIONS,
      hash: PBKDF2_HASH,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any,
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

// --- Main Class ---

export class ServerCrypto {
  /**
   * Encrypts data into a URL-safe, tamper-proof token with embedded expiration.
   * Format: [Ver(1)][Expiry(8)][Salt(16)][IV(12)][Ciphertext+Tag]
   */
  static async encrypt(
    data: unknown,
    password: string,
    ttlSeconds: number = 0,
  ): Promise<string> {
    if (!password) throw new Error('ServerCrypto: Password is required');
    if (!Number.isFinite(ttlSeconds) || ttlSeconds < 0) {
      throw new Error('ServerCrypto: ttlSeconds must be a non-negative number');
    }
    if (ttlSeconds > MAX_TTL_SECONDS) {
      throw new Error('ServerCrypto: ttlSeconds too large');
    }

    const plain = typeof data === 'string' ? data : JSON.stringify(data);

    // 1. Metadata
    const salt = cryptoObj.getRandomValues(new Uint8Array(SALT_LEN));
    const iv = cryptoObj.getRandomValues(new Uint8Array(IV_LEN));
    const version = new Uint8Array([VERSION]);

    // 2. Expiry Math (BigInt Only)
    const now = BigInt(Date.now());
    const ttlMs = BigInt(Math.floor(ttlSeconds * 1000));
    const expiryMs = ttlSeconds > 0 ? now + ttlMs : 0n;
    const expiryBytes = writeU64BE(expiryMs);

    // 3. AAD Header
    const header = concatBytes(version, expiryBytes, salt, iv);

    // 4. Encrypt
    const key = await deriveKey(password, salt);
    const cipherBuf = await cryptoObj.subtle.encrypt(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { name: 'AES-GCM', iv, additionalData: header } as any, // Header bound to AAD
      key,
      enc.encode(plain),
    );

    const payload = concatBytes(header, new Uint8Array(cipherBuf));
    return Buffer.from(payload).toString('base64url');
  }

  static async decrypt<T = string>(
    token: string,
    password: string,
  ): Promise<T | null> {
    try {
      if (!token || !password) return null;

      // DoS Mitigation: Reject massive tokens immediately
      if (token.length > MAX_TOKEN_LENGTH) return null;

      const payload = Buffer.from(token, 'base64url');

      // Min Length Check (Header + Tag)
      const headerLen = 1 + 8 + SALT_LEN + IV_LEN;
      if (payload.length < headerLen + TAG_LEN) return null;

      // Dynamic Offset Parsing
      let offset = 0;

      const ver = payload[offset];
      offset += 1;
      if (!SUPPORTED_VERSIONS.has(ver)) return null;

      const expiryBytes = payload.subarray(offset, offset + 8);
      offset += 8;
      const expiryMs = readU64BE(expiryBytes);

      if (expiryMs > 0n && BigInt(Date.now()) > expiryMs) {
        return null; // Expired
      }

      const salt = payload.subarray(offset, offset + SALT_LEN);
      offset += SALT_LEN;

      const iv = payload.subarray(offset, offset + IV_LEN);
      offset += IV_LEN;

      // Split Header (AAD) & Ciphertext
      const header = payload.subarray(0, headerLen);
      const ciphertext = payload.subarray(headerLen);

      // Decrypt
      const key = await deriveKey(password, salt);
      const plainBuf = await cryptoObj.subtle.decrypt(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        { name: 'AES-GCM', iv, additionalData: header } as any,
        key,
        ciphertext,
      );

      const str = dec.decode(plainBuf);
      try {
        return JSON.parse(str) as T;
      } catch {
        return str as unknown as T;
      }
    } catch {
      return null;
    }
  }
}
