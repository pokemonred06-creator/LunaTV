 
import { NextResponse } from 'next/server';

import { getConfig } from '@/lib/config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic'; // Disable Next.js caching

// Public endpoint - no auth required
// Returns seasonal effects config for all users
export async function GET() {
  try {
    const config = await getConfig();
    
    // Return seasonal effects config, with defaults if not set
    const seasonalEffects = config.SiteConfig.SeasonalEffects || {
      enabled: false,
      season: 'auto',
      intensity: 'normal',
    };
    
    console.log('[Seasonal Effects] Returning config:', seasonalEffects);
    
    return NextResponse.json(seasonalEffects, {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate', // Don't cache
      },
    });
  } catch (error) {
    console.error('获取季节特效配置失败:', error);
    // Return default config on error
    return NextResponse.json({
      enabled: false,
      season: 'auto',
      intensity: 'normal',
    });
  }
}
