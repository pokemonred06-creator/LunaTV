import { NextRequest, NextResponse } from 'next/server';

import type { SiteConfig } from '@/lib/admin.types';
import { getAuthInfoFromCookie } from '@/lib/auth/server';
import { isOwnerUsername } from '@/lib/auth/shared';
import { configSelfCheck, getConfig, setCachedConfig } from '@/lib/config';
import { db } from '@/lib/db';

export const runtime = 'nodejs';

const DOUBAN_PROXY_TYPES = [
  'direct',
  'custom',
  'cors-proxy-zwei',
  'cmliussss-cdn-tencent',
  'cmliussss-cdn-ali',
] as const;

const DOUBAN_IMAGE_PROXY_TYPES = [
  'direct',
  'custom',
  'cmliussss-cdn-tencent',
  'cmliussss-cdn-ali',
] as const;

function asOptionalNumber(value: unknown): number | undefined {
  if (value === '' || value === null || value === undefined) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function asOptionalBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function asOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function asOptionalChoice<T extends readonly string[]>(
  value: unknown,
  choices: T,
): T[number] | undefined {
  return typeof value === 'string' && choices.includes(value) ? value : undefined;
}

export async function POST(request: NextRequest) {
  try {
    const authInfo = await getAuthInfoFromCookie(request);
    if (!authInfo?.username) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const currentConfig = await getConfig();
    const isPrivileged =
      isOwnerUsername(authInfo.username) ||
      currentConfig.UserConfig.Users.some(
        (user) =>
          user.username === authInfo.username &&
          (user.role === 'owner' || user.role === 'admin') &&
          !user.banned,
      );

    if (!isPrivileged) {
      return NextResponse.json({ error: '权限不足' }, { status: 403 });
    }

    const body = await request.json();
    const currentSiteConfig = currentConfig.SiteConfig;

    const newSiteConfig: SiteConfig = {
      ...currentSiteConfig,
      SiteName: asOptionalString(body.SiteName) ?? currentSiteConfig.SiteName,
      Announcement:
        asOptionalString(body.Announcement) ?? currentSiteConfig.Announcement,
      SearchDownstreamMaxPage:
        asOptionalNumber(body.SearchDownstreamMaxPage) ??
        currentSiteConfig.SearchDownstreamMaxPage,
      SiteInterfaceCacheTime:
        asOptionalNumber(body.SiteInterfaceCacheTime) ??
        currentSiteConfig.SiteInterfaceCacheTime,
      DoubanProxyType:
        asOptionalChoice(body.DoubanProxyType, DOUBAN_PROXY_TYPES) ??
        currentSiteConfig.DoubanProxyType,
      DoubanProxy: asOptionalString(body.DoubanProxy) ?? currentSiteConfig.DoubanProxy,
      DoubanImageProxyType:
        asOptionalChoice(body.DoubanImageProxyType, DOUBAN_IMAGE_PROXY_TYPES) ??
        currentSiteConfig.DoubanImageProxyType,
      DoubanImageProxy:
        asOptionalString(body.DoubanImageProxy) ??
        currentSiteConfig.DoubanImageProxy,
      DisableYellowFilter:
        asOptionalBoolean(body.DisableYellowFilter) ??
        currentSiteConfig.DisableYellowFilter,
      FluidSearch:
        asOptionalBoolean(body.FluidSearch) ?? currentSiteConfig.FluidSearch,
      DebugLogs: asOptionalBoolean(body.DebugLogs) ?? currentSiteConfig.DebugLogs,
      SeasonalEffects:
        body.SeasonalEffects ?? currentSiteConfig.SeasonalEffects,
    };

    const finalConfig = configSelfCheck({
      ...currentConfig,
      SiteConfig: newSiteConfig,
    });

    await db.saveAdminConfig(finalConfig);
    await setCachedConfig(finalConfig);

    return NextResponse.json({ success: true, data: finalConfig });
  } catch (error) {
    console.error('保存基础配置失败:', error);
    return NextResponse.json(
      { error: '保存基础配置失败', details: (error as Error).message },
      { status: 500 },
    );
  }
}
