import { NextRequest, NextResponse } from 'next/server';

import { getAuthSession } from '@/lib/auth/server';
import { getOwnerUsername } from '@/lib/auth/shared';
import { getConfig } from '@/lib/config';
import { getPlaybackTelemetrySnapshot } from '@/lib/playback-telemetry';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const authInfo = await getAuthSession();
    const username = authInfo?.username;
    if (!username) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const ownerUsername = getOwnerUsername();
    const config = await getConfig();
    const isOwner = ownerUsername && username === ownerUsername;
    const isAdmin = config.UserConfig.Users.some(
      (u) => u.username === username && u.role === 'admin' && !u.banned,
    );

    if (!isOwner && !isAdmin) {
      return NextResponse.json({ error: '权限不足' }, { status: 403 });
    }

    const windowMinutesRaw = Number(
      request.nextUrl.searchParams.get('windowMinutes') || 60,
    );
    return NextResponse.json(getPlaybackTelemetrySnapshot(windowMinutesRaw), {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    console.error('[AdminPlaybackTelemetry] failed:', error);
    return NextResponse.json(
      { error: '获取播放遥测指标失败' },
      { status: 500 },
    );
  }
}
