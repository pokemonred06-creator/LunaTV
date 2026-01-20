import { NextRequest, NextResponse } from 'next/server';

import { AdminConfigResult } from '@/lib/admin.types';
import { getAuthInfoFromCookie } from '@/lib/auth/server';
import { getConfig } from '@/lib/config';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const storageType = process.env.NEXT_PUBLIC_STORAGE_TYPE || 'localstorage';

  const authInfo = getAuthInfoFromCookie(request);
  if (!authInfo || !authInfo.username) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const username = authInfo.username;

  try {
    const config = await getConfig();
    const result: AdminConfigResult = {
      Role: 'user', // Default to 'user'
      Config: config,
    };

    // In localstorage mode, username is hardcoded to 'admin' in login route.
    // So we should check if the authenticated username matches 'admin' or process.env.USERNAME
    if (result.Config.SiteConfig.SiteName && username === 'admin') {
      result.Role = 'owner';
    } else if (username === process.env.USERNAME) {
      result.Role = 'owner';
    } else {
      const user = config.UserConfig.Users.find((u) => u.username === username);
      if (user && user.role === 'owner' && !user.banned) {
        result.Role = 'owner';
      } else if (user && user.role === 'user' && !user.banned) {
        result.Role = 'user';
      } else {
        return NextResponse.json(
          { error: '权限不足或用户不存在' },
          { status: 401 },
        );
      }
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
