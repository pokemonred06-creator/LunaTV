import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth/server';
import { isOwnerUsername } from '@/lib/auth/shared';
import { resetConfig } from '@/lib/config';
import { isTrustedSameOriginRequest } from '@/lib/request-security';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  if (!isTrustedSameOriginRequest(request)) {
    return NextResponse.json({ error: 'Forbidden Origin' }, { status: 403 });
  }

  const authInfo = await getAuthInfoFromCookie(request);
  if (!authInfo?.username) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!isOwnerUsername(authInfo.username)) {
    return NextResponse.json({ error: '仅支持站长重置配置' }, { status: 403 });
  }

  try {
    await resetConfig();
    return NextResponse.json(
      { ok: true },
      {
        headers: {
          'Cache-Control': 'no-store',
        },
      },
    );
  } catch (error) {
    return NextResponse.json(
      {
        error: '重置管理员配置失败',
        details: (error as Error).message,
      },
      { status: 500 },
    );
  }
}
