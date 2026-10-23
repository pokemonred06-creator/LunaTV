import type { NextRequest } from 'next/server';
import dns from 'node:dns/promises';
import net from 'node:net';

import { BLOCKED_RANGES_IPV6 } from '@/lib/ssrf-guard';

const ALLOWED_REMOTE_PROTOCOLS = new Set(['http:', 'https:']);
const BLOCKED_RANGES_IPV4 = [
  '0.0.0.0/8',
  '10.0.0.0/8',
  '100.64.0.0/10',
  '127.0.0.0/8',
  '169.254.0.0/16',
  '172.16.0.0/12',
  '192.0.0.0/24',
  '192.0.2.0/24',
  '192.168.0.0/16',
  '198.18.0.0/15',
  '198.51.100.0/24',
  '203.0.113.0/24',
  '224.0.0.0/4',
  '240.0.0.0/4',
];

function isIpInCidr(ip: string, cidr: string): boolean {
  const [range, bits = '32'] = cidr.split('/');
  const prefixBits = Number.parseInt(bits, 10);
  if (!Number.isFinite(prefixBits) || !net.isIPv4(ip) || !net.isIPv4(range)) {
    return false;
  }

  const mask = ~(2 ** (32 - prefixBits) - 1);
  const ipLong = ip
    .split('.')
    .reduce((acc, octet) => (acc << 8) + Number.parseInt(octet, 10), 0);
  const rangeLong = range
    .split('.')
    .reduce((acc, octet) => (acc << 8) + Number.parseInt(octet, 10), 0);

  return (ipLong & mask) === (rangeLong & mask);
}

function isBlockedIpv4(ip: string): boolean {
  return BLOCKED_RANGES_IPV4.some((cidr) => isIpInCidr(ip, cidr));
}

// Include IPv4 ranges so hexadecimal IPv4-mapped IPv6 addresses are checked
// against the same policy as their IPv4 equivalents.
const blockedAddresses = new net.BlockList();
for (const cidr of BLOCKED_RANGES_IPV4) {
  const [address, prefix] = cidr.split('/');
  blockedAddresses.addSubnet(address, Number(prefix), 'ipv4');
}
for (const cidr of BLOCKED_RANGES_IPV6) {
  const [address, prefix] = cidr.split('/');
  blockedAddresses.addSubnet(address, Number(prefix), 'ipv6');
}

function isBlockedIpv6(ip: string): boolean {
  return blockedAddresses.check(ip, 'ipv6');
}

export function isBlockedRemoteIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    return isBlockedIpv4(ip);
  }
  if (net.isIPv6(ip)) {
    return isBlockedIpv6(ip);
  }
  return true;
}

export async function assertSafeRemoteUrl(rawUrl: string): Promise<URL> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error('Invalid URL');
  }

  if (!ALLOWED_REMOTE_PROTOCOLS.has(parsed.protocol)) {
    throw new Error('Only HTTP(S) URLs are allowed');
  }
  if (parsed.username || parsed.password) {
    throw new Error('Credentialed URLs are not allowed');
  }

  const hostname = parsed.hostname.trim().toLowerCase().replace(/\[|\]/g, '');
  if (!hostname || hostname === 'localhost') {
    throw new Error('Local destinations are not allowed');
  }
  if (net.isIP(hostname) && isBlockedRemoteIp(hostname)) {
    throw new Error('Private network destinations are not allowed');
  }

  const records = await dns.lookup(hostname, { all: true });
  if (records.length === 0) {
    throw new Error('Unable to resolve remote host');
  }
  if (records.some((record) => isBlockedRemoteIp(record.address))) {
    throw new Error('Private network destinations are not allowed');
  }

  return parsed;
}

export function isTrustedSameOriginRequest(request: NextRequest): boolean {
  const origin = request.headers.get('origin');
  if (!origin) {
    return true;
  }

  try {
    const originUrl = new URL(origin);
    const requestUrl = new URL(request.url);
    return (
      originUrl.protocol === requestUrl.protocol &&
      originUrl.host === requestUrl.host
    );
  } catch {
    return false;
  }
}
