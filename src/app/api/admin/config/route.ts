/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server';

import { getAuthSession } from '@/lib/auth/server';
import { getConfig } from '@/lib/config';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const authInfo = await getAuthSession();
    const username = authInfo?.username;
    console.log('[AdminConfig] AuthInfo:', JSON.stringify(authInfo));

    const config = await getConfig();

    if (!authInfo || !authInfo.username) {
      console.log('[AdminConfig] No AuthInfo or Username. Returning 401.');
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const result: any = {
      ...config,
    };

    // Trust the signed cookie role
    console.log('[AdminConfig] Trusting Cookie Role:', authInfo.role);
    if (authInfo.role === 'owner' || authInfo.role === 'admin') {
      result.Role = authInfo.role;
    } else {
      // Fallback to strict DB check if role is 'user' or missing
      if (config.UserConfig.Users) {
        const user = config.UserConfig.Users.find(
          (u) => u.username === username,
        );
        if (user && user.banned) {
          console.log('[AdminConfig] User is BANNED:', username);
          return NextResponse.json({ error: '用户被封禁' }, { status: 401 });
        }
      }
      result.Role = authInfo.role || 'user';
    }

    if (result.Role !== 'owner' && result.Role !== 'admin') {
      console.log('[AdminConfig] Insufficient Role:', result.Role);
      return NextResponse.json({ error: '权限不足' }, { status: 401 });
    }

    return NextResponse.json(result, {
      headers: {
        'Cache-Control': 'no-store', // 管理员配置不缓存
      },
    });
  } catch (error) {
    console.error('获取管理员配置失败:', error);
    return NextResponse.json(
      {
        error: '获取管理员配置失败',
        details: (error as Error).message,
      },
      { status: 500 },
    );
  }
}
