import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth/server';
import { getAvailableApiSites, getConfig } from '@/lib/config'; // Modified import
import { searchFromApi } from '@/lib/downstream';
import {
  converter as OPENCC_CONVERTER,
  shouldFilterItem,
} from '@/lib/yellow-filter';

export const runtime = 'nodejs';

function normalizeTitle(value: string): string {
  return OPENCC_CONVERTER(value)
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[·•・:：!！?？'"“”‘’()（）【】{}<>《》\-—_.,，。]/g, '');
}

// OrionTV 兼容接口
export async function GET(request: NextRequest) {
  const authInfo = await getAuthInfoFromCookie(request);
  if (!authInfo || !authInfo.username) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const rawQuery = searchParams.get('q');
  const query = rawQuery ? OPENCC_CONVERTER(rawQuery) : '';
  const resourceId = searchParams.get('resourceId');

  const config = await getConfig(); // Get config early
  const cacheTime = config.SiteConfig.SiteInterfaceCacheTime || 7200; // Use SiteInterfaceCacheTime

  if (!query || !resourceId) {
    return NextResponse.json(
      { results: [], result: null, error: '缺少必要参数: q 或 resourceId' },
      {
        headers: {
          'Cache-Control': `public, max-age=${cacheTime}, s-maxage=${cacheTime}`,
          'CDN-Cache-Control': `public, s-maxage=${cacheTime}`,
          'Vercel-CDN-Cache-Control': `public, s-maxage=${cacheTime}`,
          'Netlify-Vary': 'query',
        },
      },
    );
  }

  const apiSites = await getAvailableApiSites(authInfo.username);

  try {
    // 根据 resourceId 查找对应的 API 站点
    const targetSite = apiSites.find((site) => site.key === resourceId);
    if (!targetSite) {
      return NextResponse.json(
        {
          error: `未找到指定的视频源: ${resourceId}`,
          results: [],
          result: null,
        },
        { status: 404 },
      );
    }

    const results = await searchFromApi(targetSite, query);
    let result = results.filter((r) => r.title === query);
    if (result.length === 0) {
      const normalizedQuery = normalizeTitle(query);
      const fuzzy = results
        .map((item) => {
          const normalizedTitle = normalizeTitle(item.title);
          let score = 0;
          if (normalizedTitle === normalizedQuery) score = 100;
          else if (normalizedTitle.includes(normalizedQuery)) score = 80;
          else if (normalizedQuery.includes(normalizedTitle)) score = 60;
          return { item, score };
        })
        .filter((entry) => entry.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 5)
        .map((entry) => ({
          ...entry.item,
          // Orion 客户端会再次按 title === query 过滤，兼容性兜底
          title: query,
        }));

      if (fuzzy.length > 0) {
        result = fuzzy;
      }
    }
    if (!config.SiteConfig.DisableYellowFilter) {
      result = result.filter(
        (item: { title?: string; name?: string; type_name?: string }) =>
          !shouldFilterItem(item),
      );
    }

    if (result.length === 0) {
      return NextResponse.json(
        {
          error: '未找到结果',
          results: [],
          result: null,
        },
        { status: 404 },
      );
    } else {
      return NextResponse.json(
        { results: result, result },
        {
          headers: {
            'Cache-Control': `public, max-age=${cacheTime}, s-maxage=${cacheTime}`,
            'CDN-Cache-Control': `public, s-maxage=${cacheTime}`,
            'Vercel-CDN-Cache-Control': `public, s-maxage=${cacheTime}`,
            'Netlify-Vary': 'query',
          },
        },
      );
    }
  } catch (error) {
    return NextResponse.json(
      {
        error: '搜索失败',
        results: [],
        result: null,
      },
      { status: 500 },
    );
  }
}
