import { NextRequest, NextResponse } from 'next/server';

// 1. Force Node Runtime for predictable memory/timers
export const runtime = 'nodejs';

// 2. Operational Configuration
const ENABLED = process.env.ENABLE_CLIENT_LOGGING === 'true';
const MAX_PAYLOAD_SIZE = 50 * 1024; // 50KB limit (Stack traces can be large)
const RATE_LIMIT_WINDOW = 60 * 1000; // 1 Minute
const MAX_REQUESTS_PER_IP = 30; // 30 logs/min per IP

// 3. Memory-Safe Rate Limiter
// Using a Map with lazy pruning to prevent memory leaks
const ipHits = new Map<string, { count: number; resetAt: number }>();
let lastPruneTime = Date.now();

function checkRateLimit(ip: string): boolean {
  const now = Date.now();

  // Prune expired entries every 30 seconds to prevent memory leak
  if (now - lastPruneTime > 30_000) {
    for (const [key, val] of ipHits.entries()) {
      if (now > val.resetAt) ipHits.delete(key);
    }
    lastPruneTime = now;
  }

  const record = ipHits.get(ip);
  if (!record || now > record.resetAt) {
    ipHits.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW });
    return true;
  }

  if (record.count >= MAX_REQUESTS_PER_IP) return false;

  record.count++;
  return true;
}

// 4. Robust IP Extraction
function getClientIp(req: NextRequest): string {
  // Cloudflare / Vercel
  const cf = req.headers.get('cf-connecting-ip');
  if (cf) return cf;

  // Standard Proxies
  const xff = req.headers.get('x-forwarded-for');
  if (xff) return xff.split(',')[0].trim();

  // Fallback
  return req.headers.get('x-real-ip') || 'unknown';
}

// 5. Crash-Proof Serializer (Handles BigInt & Circular Refs)
function safeStringify(value: unknown): string {
  const seen = new WeakSet();
  return JSON.stringify(value, (key, val) => {
    // Handle BigInt (which crashes JSON.stringify)
    if (typeof val === 'bigint') return val.toString();

    // Handle Circular References
    if (typeof val === 'object' && val !== null) {
      if (seen.has(val)) return '[Circular]';
      seen.add(val);
    }
    return val;
  });
}

export async function POST(req: NextRequest) {
  // A. Feature Flag Gate
  if (!ENABLED) return new NextResponse(null, { status: 404 });

  // B. Origin Check (Best Effort CSRF)
  const origin = req.headers.get('origin');
  const host = req.headers.get('host');
  if (origin && host && !origin.includes(host)) {
    return new NextResponse(null, { status: 403 });
  }

  // C. Rate Limiting
  const ip = getClientIp(req);
  if (!checkRateLimit(ip)) {
    return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 });
  }

  // D. Early Size Check (Content-Length)
  const contentLength = Number(req.headers.get('content-length') || 0);
  if (contentLength > MAX_PAYLOAD_SIZE) {
    return NextResponse.json({ error: 'Payload too large' }, { status: 413 });
  }

  try {
    const body = await req.json().catch(() => ({}));

    // Normalize Level
    const validLevels = ['info', 'warn', 'error', 'debug'];
    const level = validLevels.includes(body.level) ? body.level : 'info';

    // Construct Log Entry
    const logEntry = {
      timestamp: body.timestamp || new Date().toISOString(),
      level,
      source: 'client-remote',
      // Truncate URL & Message to prevent massive log lines
      url: String(body.url || '').slice(0, 500),
      message: String(body.message || 'No message').slice(0, 2000),
      data: body.data || null,
      meta: {
        ip, // Remove if GDPR concern
        ua: req.headers.get('user-agent'),
      },
    };

    // Serialize & Output
    let output = safeStringify(logEntry);

    // Final Hard Cap on Log Line Size (prevent logging system DOS)
    if (output.length > MAX_PAYLOAD_SIZE) {
      output = output.slice(0, MAX_PAYLOAD_SIZE) + '...[TRUNCATED]';
    }

    if (level === 'error') console.error(output);
    else if (level === 'warn') console.warn(output);
    else console.log(output);

    return NextResponse.json({ success: true });
  } catch (err) {
    // Fail Open: Don't break the client if logging fails
    console.error('[Remote Log Internal Error]', err);
    return NextResponse.json({ success: false }, { status: 500 });
  }
}
