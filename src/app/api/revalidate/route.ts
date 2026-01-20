import { revalidatePath, revalidateTag } from 'next/cache';
import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth/server';

export const runtime = 'nodejs';

// Config
const ALLOWED_TAGS = new Set(['live-channels']);
const ALLOWED_PREFIXES = ['live-channels:'];

// Utils
function normalizeTag(input: string) {
  // Trim and force lowercase for consistency (if your keys are case-insensitive)
  const t = input.trim();
  if (!t || t.length > 120) return null;
  if (!/^[a-zA-Z0-9:_-]+$/.test(t)) return null;
  return t;
}

function isAllowedTag(tag: string) {
  if (ALLOWED_TAGS.has(tag)) return true;
  return ALLOWED_PREFIXES.some((p) => tag.startsWith(p));
}

export async function POST(req: NextRequest) {
  try {
    // 1. CSRF / Origin Check (Best Effort)
    const origin = req.headers.get('origin');
    const host = req.headers.get('host');
    if (origin && host && !origin.includes(host)) {
      return NextResponse.json({ error: 'Forbidden Origin' }, { status: 403 });
    }

    // 2. Auth Check
    const auth = getAuthInfoFromCookie(req);

    // 401: Identity not established
    if (!auth?.username) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // 403: Identity known, but permission denied
    if (auth.role !== 'owner') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // 3. Input Validation
    const body = await req.json().catch(() => ({}));
    const rawTag = typeof body.tag === 'string' ? body.tag : '';
    const rawPath = typeof body.path === 'string' ? body.path : '';

    const tag = rawTag ? normalizeTag(rawTag) : null;
    const path = rawPath ? rawPath.trim() : null;

    if (!tag && !path) {
      return NextResponse.json({ error: 'Bad Request' }, { status: 400 });
    }

    // 4. Execution
    const results: { tag?: string; path?: string } = {};

    if (tag) {
      if (!isAllowedTag(tag)) {
        return NextResponse.json({ error: 'Invalid Tag' }, { status: 400 });
      }
      revalidateTag(tag);
      results.tag = tag;
    }

    if (path) {
      if (!path.startsWith('/')) {
        return NextResponse.json({ error: 'Invalid Path' }, { status: 400 });
      }
      revalidatePath(path);
      results.path = path;
    }

    return NextResponse.json(
      { ok: true, revalidated: results },
      {
        status: 200,
        headers: {
          'Cache-Control':
            'no-store, no-cache, must-revalidate, proxy-revalidate',
        },
      },
    );
  } catch (e) {
    console.error('[Revalidate] Error:', e);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 },
    );
  }
}
