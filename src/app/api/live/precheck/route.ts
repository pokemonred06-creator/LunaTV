import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function ok(type: string) {
  return NextResponse.json({ success: true, type });
}
function bad(msg: string, status = 400) {
  return NextResponse.json(
    { success: false, error: msg, type: 'unknown' },
    { status },
  );
}

function resolveUrl(raw: string) {
  try {
    const u = new URL(raw);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return u;
  } catch {
    return null;
  }
}

export async function GET(req: NextRequest) {
  const urlParam = req.nextUrl.searchParams.get('url') || '';
  const u = resolveUrl(urlParam);
  if (!u) return bad('Invalid URL');

  const path = u.pathname.toLowerCase();

  // Heuristic based on extension/path
  if (path.includes('.flv') || path.includes('.xs') || path.includes('douyu')) {
    return ok('flv');
  }
  if (path.includes('.m3u8') || path.includes('playlist.m3u8')) {
    return ok('m3u8');
  }

  // Fallback to unknown, client will try to guess
  return ok('unknown');
}
