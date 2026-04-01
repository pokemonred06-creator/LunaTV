import crypto from 'crypto';

const HASH_ITERATIONS = 100_000;
const HASH_KEYLEN = 64;
const HASH_DIGEST = 'sha512';
const SALT_LEN = 16;

const LEGACY_HASH_RE = /^[0-9a-f]+:[0-9a-f]+$/i;

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(SALT_LEN).toString('hex');
  const hash = crypto
    .pbkdf2Sync(password, salt, HASH_ITERATIONS, HASH_KEYLEN, HASH_DIGEST)
    .toString('hex');
  return `${salt}:${hash}`;
}

export function isPasswordHash(value: string): boolean {
  return LEGACY_HASH_RE.test(value);
}

export function verifyStoredPassword(
  password: string,
  stored: string,
): boolean {
  if (isPasswordHash(stored)) {
    const [salt, hash] = stored.split(':');
    const verify = crypto
      .pbkdf2Sync(password, salt, HASH_ITERATIONS, HASH_KEYLEN, HASH_DIGEST)
      .toString('hex');
    if (hash.length !== verify.length) return false;
    return crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(verify));
  }

  return stored === password;
}
