/**
 * Shared SSRF (Server-Side Request Forgery) protection utilities.
 * Used by image-proxy and proxy routes to validate outbound URLs
 * against private/internal IP ranges before making upstream requests.
 */
import dns from 'node:dns/promises';
import net from 'node:net';

// Block private/internal IP ranges to prevent SSRF
export const BLOCKED_RANGES_IPV4 = [
  '0.0.0.0/8',
  '10.0.0.0/8',
  '100.64.0.0/10',
  '127.0.0.0/8',
  '169.254.0.0/16',
  '172.16.0.0/12',
  '192.0.0.0/24',
  '192.0.2.0/24',
  '192.168.0.0/16',
  // '198.18.0.0/15', // Allowed for Clash FakeIP routes
  '224.0.0.0/4',
  '240.0.0.0/4',
];

export const BLOCKED_RANGES_IPV6 = [
  '::/128',
  '::1/128',
  'fc00::/7',
  'fe80::/10',
  'ff00::/8',
  '2001:db8::/32',
];

// Pre-build a BlockList for efficient IP range checks
export const BLOCKLIST = new net.BlockList();
BLOCKED_RANGES_IPV4.forEach((cidr) => {
  const [range, bits] = cidr.split('/');
  BLOCKLIST.addSubnet(range, Number(bits), 'ipv4');
});
BLOCKED_RANGES_IPV6.forEach((cidr) => {
  const [range, bits] = cidr.split('/');
  BLOCKLIST.addSubnet(range, Number(bits), 'ipv6');
});

export function isBlockedIp(ip: string): boolean {
  const family = net.isIP(ip);
  if (family === 4) return BLOCKLIST.check(ip, 'ipv4');
  if (family === 6) return BLOCKLIST.check(ip, 'ipv6');
  return true; // Unknown format → block by default
}

/**
 * isIpInCidr: legacy helper kept for image-proxy which doesn't use BlockList.
 * Use isBlockedIp() for new code.
 */
export function isIpInCidr(ip: string, cidr: string): boolean {
  const [range, bits = '32'] = cidr.split('/');
  const mask = ~(2 ** (32 - parseInt(bits, 10)) - 1);
  if (net.isIPv4(ip) && net.isIPv4(range)) {
    const ipLong =
      ip
        .split('.')
        .reduce((acc, octet) => (acc << 8) + parseInt(octet, 10), 0) >>> 0;
    const rangeLong =
      range
        .split('.')
        .reduce((acc, octet) => (acc << 8) + parseInt(octet, 10), 0) >>> 0;
    return (ipLong & mask) === (rangeLong & mask);
  }
  return false;
}

export function isLocalIPv6(ip: string): boolean {
  return net.isIPv6(ip) && BLOCKLIST.check(ip, 'ipv6');
}

/**
 * Validates a URL is safe to fetch (not SSRF-able).
 * Used by image-proxy route.
 */
export async function validateSafeUrl(urlStr: string): Promise<boolean> {
  try {
    const u = new URL(urlStr);
    if (!['http:', 'https:'].includes(u.protocol)) return false;
    const cleanHost = u.hostname.replace(/\[|\]/g, '');
    const ipType = net.isIP(cleanHost);
    if (ipType === 4)
      return !BLOCKED_RANGES_IPV4.some((cidr) => isIpInCidr(cleanHost, cidr));
    if (ipType === 6) return !isLocalIPv6(cleanHost);
    const addrs = await dns.lookup(cleanHost, { all: true, verbatim: true });
    if (!addrs.length) return false;
    return !addrs.some((a) => {
      if (a.family === 4)
        return BLOCKED_RANGES_IPV4.some((cidr) => isIpInCidr(a.address, cidr));
      if (a.family === 6) return isLocalIPv6(a.address);
      return false;
    });
  } catch {
    return false;
  }
}

/**
 * Validates a URL is safe to proxy, with port allowlist and credential checks.
 * Used by proxy/[type] route.
 */
export async function validateSafeProxyUrl(
  urlStr: string,
  allowedProtocols: Set<string>,
  allowedPorts: Set<number> | null,
): Promise<boolean> {
  try {
    const u = new URL(urlStr);
    if (!allowedProtocols.has(u.protocol)) return false;
    if (u.username || u.password) return false;

    const port = getPortForUrl(u);
    if (port === null || !Number.isInteger(port)) {
      console.warn('[Proxy SSRF] Missing or invalid port:', urlStr);
      return false;
    }
    if (allowedPorts !== null && !allowedPorts.has(port)) {
      console.warn('[Proxy SSRF] Blocked Port:', port, urlStr);
      return false;
    }

    const cleanHost = u.hostname.replace(/\[|\]/g, '');
    if (!cleanHost || cleanHost.toLowerCase() === 'localhost') {
      console.warn('[Proxy SSRF] Blocked host:', cleanHost, urlStr);
      return false;
    }

    const ipType = net.isIP(cleanHost);
    if (ipType === 6) return !isBlockedIp(cleanHost);
    if (ipType === 4) {
      const blocked = isBlockedIp(cleanHost);
      if (blocked) console.warn('[Proxy SSRF] Blocked IP:', cleanHost, urlStr);
      return !blocked;
    }

    const addrs = await dns.lookup(cleanHost, { all: true, verbatim: true });
    if (!addrs.length) {
      console.warn('[Proxy SSRF] Empty DNS result:', cleanHost, urlStr);
      return false;
    }

    const allPublic = addrs.every((a) => {
      if (a.family !== 4 && a.family !== 6) return false;
      return !isBlockedIp(a.address);
    });
    if (!allPublic) {
      console.warn(
        '[Proxy SSRF] Blocked resolved address:',
        addrs.map((a) => a.address),
        urlStr,
      );
    }
    return allPublic;
  } catch (err) {
    console.warn('[Proxy SSRF] Validation Error:', err, urlStr);
    return false;
  }
}

function getPortForUrl(u: URL): number | null {
  if (u.port) return Number(u.port);
  if (u.protocol === 'https:') return 443;
  if (u.protocol === 'http:') return 80;
  if (u.protocol === 'rtmp:') return 1935;
  if (u.protocol === 'rtsp:') return 554;
  return null;
}

/** Resolve a relay destination once and pass only that checked address to FFmpeg. */
export async function resolveSafeRelayUrl(
  raw: string,
  protocols: Set<string>,
  ports: Set<number> | null,
): Promise<URL> {
  if (!(await validateSafeProxyUrl(raw, protocols, ports))) {
    throw new Error('SSRF blocked relay target');
  }
  const url = new URL(raw);
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  if (!net.isIP(hostname)) {
    const records = await dns.lookup(hostname, { all: true, verbatim: true });
    if (
      !records.length ||
      records.some((record) => isBlockedIp(record.address))
    ) {
      throw new Error('SSRF blocked relay address');
    }
    const selected =
      records.find((record) => record.family === 4) ?? records[0];
    url.hostname =
      selected.family === 6 ? `[${selected.address}]` : selected.address;
  }
  return url;
}
