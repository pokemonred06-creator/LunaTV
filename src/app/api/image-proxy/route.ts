import { NextRequest, NextResponse } from 'next/server';
import dns from 'node:dns/promises';
import net from 'node:net';

import { getConfig } from '@/lib/config';

// 1. Force Node Runtime (Required for 'dns' and 'net' modules)
export const runtime = 'nodejs';

// 2. Configuration & Limits
const CONFIG = {
  TIMEOUT_MS: 8_000,
  MAX_BYTES: 10 * 1024 * 1024, // 10MB Limit
  UA: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121 Safari/537.36',
};

const BLOCKED_HOSTS = new Set(['localhost', '0.0.0.0', '::1']);
const BLOCKED_TLDS = ['.local', '.internal', '.corp'];

// --- Helper: Private IP Validation (Dependency-Free) ---

function isPrivateIPv4(ip: string) {
  const parts = ip.split('.').map((x) => Number(x));
  if (
    parts.length !== 4 ||
    parts.some((n) => Number.isNaN(n) || n < 0 || n > 255)
  )
    return true;

  const [a, b] = parts;

  // 0.0.0.0/8 (Current network)
  if (a === 0) return true;
  // 10.0.0.0/8 (Private)
  if (a === 10) return true;
  // 127.0.0.0/8 (Loopback)
  if (a === 127) return true;
  // 169.254.0.0/16 (Link-local)
  if (a === 169 && b === 254) return true;
  // 192.168.0.0/16 (Private)
  if (a === 192 && b === 168) return true;
  // 172.16.0.0/12 (Private)
  if (a === 172 && b >= 16 && b <= 31) return true;
  // 100.64.0.0/10 (Carrier Grade NAT)
  if (a === 100 && b >= 64 && b <= 127) return true;

  return false;
}

function isPrivateIPv6(ip: string) {
  const normalized = ip.toLowerCase();
  // Loopback / Unspecified
  if (normalized === '::1' || normalized === '::') return true;
  // Link-local (fe80::/10)
  if (
    normalized.startsWith('fe8') ||
    normalized.startsWith('fe9') ||
    normalized.startsWith('fea') ||
    normalized.startsWith('feb')
  )
    return true;
  // Unique Local (fc00::/7)
  if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true;
  return false;
}

function isBlockedHostname(hostnameRaw: string) {
  const hostname = hostnameRaw.toLowerCase().replace(/\.$/, '');
  if (BLOCKED_HOSTS.has(hostname)) return true;
  if (BLOCKED_TLDS.some((tld) => hostname.endsWith(tld))) return true;
  return false;
}

// --- Helper: DNS SSRF Check ---

async function assertNoSSRF(urlObj: URL) {
  const hostname = urlObj.hostname;

  // 1. Block String Matches
  if (isBlockedHostname(hostname)) throw new Error('SSRF_BLOCKED_HOST');

  // 2. Block Direct IP Literals
  const ipType = net.isIP(hostname);
  if (ipType === 4) {
    if (isPrivateIPv4(hostname)) throw new Error('SSRF_PRIVATE_IP');
    return;
  }
  if (ipType === 6) {
    if (isPrivateIPv6(hostname)) throw new Error('SSRF_PRIVATE_IP');
    return;
  }

  // 3. DNS Resolution (The core protection)
  // We resolve the hostname to check if it resolves to a private IP behind the scenes.
  try {
    const records = await dns.lookup(hostname, { all: true, verbatim: true });
    if (!records.length) throw new Error('SSRF_DNS_EMPTY');

    for (const r of records) {
      if (r.family === 4 && isPrivateIPv4(r.address))
        throw new Error('SSRF_PRIVATE_IP_RESOLVED');
      if (r.family === 6 && isPrivateIPv6(r.address))
        throw new Error('SSRF_PRIVATE_IP_RESOLVED');
    }
  } catch (e) {
    throw new Error('SSRF_DNS_FAILED');
  }
}

// --- Helper: Timeout Wrapper ---

function withTimeout(ms: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return { signal: controller.signal, clear: () => clearTimeout(timer) };
}

// --- Main Handler ---

async function fetchStream(url: string, headers: Record<string, string>) {
  const { signal, clear } = withTimeout(CONFIG.TIMEOUT_MS);
  try {
    return await fetch(url, {
      headers,
      signal,
      // Manual redirect handling is CRITICAL for SSRF protection.
      // We do not want fetch to automatically follow a redirect to 127.0.0.1.
      redirect: 'manual',
    });
  } finally {
    clear();
  }
}

export async function GET(request: NextRequest) {
  const urlParam = request.nextUrl.searchParams.get('url');
  if (!urlParam) return new NextResponse('Missing url', { status: 400 });

  let originalUrl: URL;
  try {
    originalUrl = new URL(urlParam);
  } catch {
    return new NextResponse('Invalid URL', { status: 400 });
  }

  if (!['http:', 'https:'].includes(originalUrl.protocol)) {
    return new NextResponse('Invalid protocol', { status: 400 });
  }

  // 1. SSRF Check: Original URL
  try {
    await assertNoSSRF(originalUrl);
  } catch (e) {
    console.warn(`[Proxy Block] SSRF attempt on input: ${urlParam}`);
    return new NextResponse('Access denied', { status: 403 });
  }

  const config = await getConfig();
  let target = originalUrl.toString();

  // 2. Rewrite Logic (Douban Specific)
  if (target.includes('doubanio.com')) {
    const { DoubanImageProxyType, DoubanImageProxy } = config.SiteConfig;

    if (DoubanImageProxyType === 'custom' && DoubanImageProxy) {
      try {
        const proxyBase = new URL(DoubanImageProxy);
        // Robust query param handling: preserve existing, add url
        proxyBase.searchParams.set('url', originalUrl.toString());
        target = proxyBase.toString();
      } catch {
        // Fallback if config is invalid
        target = originalUrl.toString();
      }
    } else if (DoubanImageProxyType?.startsWith('cmliussss')) {
      target = target.replace(
        /img\d+\.doubanio\.com/i,
        'img.doubanio.cmliussss.net',
      );
    }
  }

  // 3. SSRF Check: Target URL (Re-check if changed)
  if (target !== originalUrl.toString()) {
    try {
      const targetUrlObj = new URL(target);
      await assertNoSSRF(targetUrlObj);
    } catch (e) {
      console.warn(`[Proxy Block] SSRF attempt on target: ${target}`);
      return new NextResponse('Access denied', { status: 403 });
    }
  }

  // 4. Fetch
  const fetchHeaders: Record<string, string> = {
    'User-Agent': CONFIG.UA,
    Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
  };

  try {
    let res = await fetchStream(target, fetchHeaders);

    // 5. Fallback Logic
    // If proxy fail (4xx/5xx) AND we modified the URL, try original
    if (!res.ok && target !== originalUrl.toString()) {
      res = await fetchStream(originalUrl.toString(), fetchHeaders);
    }

    // 6. Security Checks on Response

    // Block redirects (3xx)
    if (res.status >= 300 && res.status < 400) {
      return new NextResponse('Upstream redirects are blocked', {
        status: 502,
      });
    }

    if (!res.ok) {
      return new NextResponse(`Upstream error: ${res.status}`, {
        status: res.status,
      });
    }

    // Validate Content-Type
    const contentType =
      res.headers.get('content-type') || 'application/octet-stream';
    if (!contentType.toLowerCase().startsWith('image/')) {
      return new NextResponse('Invalid content type', { status: 415 });
    }

    // Validate Content-Length
    const len = res.headers.get('content-length');
    if (len && Number(len) > CONFIG.MAX_BYTES) {
      return new NextResponse('Image too large', { status: 413 });
    }

    if (!res.body) {
      return new NextResponse('No content', { status: 502 });
    }

    // 7. Stream Response
    const headers = new Headers();
    headers.set('Content-Type', contentType);
    headers.set(
      'Cache-Control',
      'public, max-age=86400, stale-while-revalidate=86400',
    );
    headers.set('Access-Control-Allow-Origin', '*');

    return new NextResponse(res.body, { status: 200, headers });
  } catch (err) {
    console.error('[Image Proxy] Error:', err);
    return new NextResponse('Internal Server Error', { status: 500 });
  }
}
