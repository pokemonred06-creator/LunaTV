export function safeDecodeCookie(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * Handles potential double-encoding from proxies/browsers safely.
 * Only attempts second decode if URL-encoded pattern is detected.
 */
export function safeMaybeDoubleDecode(value: string): string {
  const once = safeDecodeCookie(value);
  if (/%[0-9A-Fa-f]{2}/.test(once)) {
    return safeDecodeCookie(once);
  }
  return once;
}
