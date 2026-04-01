import { hashPassword, isPasswordHash } from './password';

type CredentialStorage = {
  userPwdKey?: (user: string) => string;
  client?: {
    get?: (key: string) => Promise<unknown>;
    set?: (key: string, value: unknown) => Promise<unknown>;
  };
  data?: Record<string, unknown>;
  save?: () => void;
};

function getCredentialKey(
  storage: CredentialStorage,
  username: string,
): string {
  return typeof storage.userPwdKey === 'function'
    ? storage.userPwdKey(username)
    : `u:${username}:pwd`;
}

export async function getStoredUserPasswordHash(
  storage: unknown,
  username: string,
): Promise<string | null> {
  const adapter = storage as CredentialStorage | null;
  if (!adapter) return null;

  const key = getCredentialKey(adapter, username);

  if (typeof adapter.client?.get === 'function') {
    const value = await adapter.client.get(key);
    const normalized = typeof value === 'string' ? value : null;
    if (!normalized) return null;
    return isPasswordHash(normalized) ? normalized : hashPassword(normalized);
  }

  if (adapter.data && typeof adapter.data[key] === 'string') {
    const value = adapter.data[key] as string;
    return isPasswordHash(value) ? value : hashPassword(value);
  }

  return null;
}

export async function setStoredUserPasswordHash(
  storage: unknown,
  username: string,
  passwordHash: string,
): Promise<void> {
  const adapter = storage as CredentialStorage | null;
  if (!adapter || !isPasswordHash(passwordHash)) {
    throw new Error('Invalid password hash snapshot');
  }

  const key = getCredentialKey(adapter, username);

  if (typeof adapter.client?.set === 'function') {
    await adapter.client.set(key, passwordHash);
    return;
  }

  if (adapter.data) {
    adapter.data[key] = passwordHash;
    if (typeof adapter.save === 'function') adapter.save();
    return;
  }

  throw new Error('Storage adapter does not support credential snapshots');
}
