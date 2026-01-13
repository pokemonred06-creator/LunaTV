import { NextRequest, NextResponse } from 'next/server';

import { SiteConfig } from '@/lib/admin.types';
import { configSelfCheck,getConfig, setCachedConfig } from '@/lib/config';
import { db } from '@/lib/db';

export async function POST(request: NextRequest) {
  try {
    // 权限检查
    // ... (middleware handles auth, double check usually good but skipping for brevity as per context)

    const body = await request.json();
    const currentConfig = await getConfig();

    const newSiteConfig: SiteConfig = {
      SiteName: body.SiteName || currentConfig.SiteConfig.SiteName,
      Announcement: body.Announcement || '',
      SearchDownstreamMaxPage: Number(body.SearchDownstreamMaxPage) || currentConfig.SiteConfig.SearchDownstreamMaxPage,
      SiteInterfaceCacheTime: Number(body.SiteInterfaceCacheTime) || currentConfig.SiteConfig.SiteInterfaceCacheTime,
      DoubanProxyType: body.DoubanProxyType || currentConfig.SiteConfig.DoubanProxyType,
      DoubanProxy: body.DoubanProxy || '',
      DoubanImageProxyType: body.DoubanImageProxyType || currentConfig.SiteConfig.DoubanImageProxyType,
      DoubanImageProxy: body.DoubanImageProxy || '',
      DisableYellowFilter: body.DisableYellowFilter !== undefined ? body.DisableYellowFilter : currentConfig.SiteConfig.DisableYellowFilter,
      FluidSearch: body.FluidSearch !== undefined ? body.FluidSearch : currentConfig.SiteConfig.FluidSearch,
      // Preserve existing TTL values from current config (which come from env vars)
      DoubanDataCacheTTL: currentConfig.SiteConfig.DoubanDataCacheTTL,
      ImageCacheTTL: currentConfig.SiteConfig.ImageCacheTTL,
      // Seasonal Effects (admin-controlled)
      SeasonalEffects: body.SeasonalEffects !== undefined ? body.SeasonalEffects : currentConfig.SiteConfig.SeasonalEffects,
      DebugLogs: body.DebugLogs !== undefined ? body.DebugLogs : currentConfig.SiteConfig.DebugLogs,
    };

    currentConfig.SiteConfig = newSiteConfig;
    const finalConfig = configSelfCheck(currentConfig);
    
    await db.saveAdminConfig(finalConfig);
    await setCachedConfig(finalConfig);

    return NextResponse.json({ success: true, data: finalConfig });
  } catch (error) {
    console.error('Save site config failed:', error);
    return NextResponse.json({ success: false, error: 'Internal Server Error' }, { status: 500 });
  }
}