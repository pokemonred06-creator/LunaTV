/* eslint-disable @typescript-eslint/no-explicit-any */

import { NextRequest, NextResponse } from 'next/server';

import { AdminConfig } from '@/lib/admin.types';
import { getAuthInfoFromCookie } from '@/lib/auth/server';
import { isOwnerUsername } from '@/lib/auth/shared';
import { getAvailableApiSites, getConfig } from '@/lib/config';
import { searchFromApi } from '@/lib/downstream';
import {
  converter as OPENCC_CONVERTER,
  isBlocked,
  shouldFilterItem,
} from '@/lib/yellow-filter';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  try {
    // 从 cookie 获取用户信息
    const authInfo = await getAuthInfoFromCookie(request);
    if (!authInfo || !authInfo.username) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const config = await getConfig();
    const { searchParams } = new URL(request.url);
    const rawQuery = searchParams.get('q')?.trim();

    if (!rawQuery) {
      return NextResponse.json({ suggestions: [] });
    }

    // Convert Traditional to Simplified Chinese for best search results
    const query = OPENCC_CONVERTER(rawQuery);

    let applyFilter = !config.SiteConfig?.DisableYellowFilter;
    const isOwner = isOwnerUsername(authInfo.username);

    if (applyFilter) {
      if (isOwner) {
        applyFilter = false;
      } else {
        const users = config.UserConfig?.Users ?? [];
        const user = users.find((u) => u.username === authInfo.username);
        if (user?.disableYellowFilter) applyFilter = false;
      }
    }

    if (applyFilter && isBlocked(query)) {
      return NextResponse.json({ suggestions: [] });
    }

    // 生成建议
    const suggestions = await generateSuggestions(
      config,
      query,
      authInfo.username,
    );

    // 从配置中获取缓存时间，如果没有配置则使用默认值300秒（5分钟）
    const cacheTime = config.SiteConfig.SiteInterfaceCacheTime || 300;

    return NextResponse.json(
      { suggestions },
      {
        headers: {
          'Cache-Control': `public, max-age=${cacheTime}, s-maxage=${cacheTime}`,
          'CDN-Cache-Control': `public, s-maxage=${cacheTime}`,
          'Vercel-CDN-Cache-Control': `public, s-maxage=${cacheTime}`,
          'Netlify-Vary': 'query',
        },
      },
    );
  } catch (error) {
    console.error('获取搜索建议失败', error);
    return NextResponse.json({ error: '获取搜索建议失败' }, { status: 500 });
  }
}

async function generateSuggestions(
  config: AdminConfig,
  query: string,
  username: string,
): Promise<
  Array<{
    text: string;
    type: 'exact' | 'related' | 'suggestion';
    score: number;
  }>
> {
  const queryLower = query.toLowerCase();

  // 1. Try Bilibili suggestion API first (massively popular term dictionary supporting Chinese, Pinyin, and initials)
  try {
    const response = await fetch(
      `https://s.search.bilibili.com/main/suggest?term=${encodeURIComponent(query)}`,
      {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        },
        next: { revalidate: 60 },
      },
    );
    if (response.ok) {
      const data = await response.json();
      if (data.code === 0 && data.result && Array.isArray(data.result.tag)) {
        return data.result.tag.map((item: any, index: number) => ({
          text: item.value,
          type: index === 0 ? 'exact' : 'suggestion',
          score: 10 - index,
        }));
      }
    }
  } catch (error) {
    console.error('Bilibili suggest API error:', error);
  }

  // 2. Fallback to original downstream API logic
  const apiSites = await getAvailableApiSites(username);
  let realKeywords: string[] = [];

  if (apiSites.length > 0) {
    const firstSite = apiSites[0];
    const results = await searchFromApi(firstSite, query);

    realKeywords = Array.from(
      new Set(
        results
          .filter(
            (r: any) =>
              config.SiteConfig.DisableYellowFilter || !shouldFilterItem(r),
          )
          .map((r: any) => r.title)
          .filter(Boolean)
          .flatMap((title: string) => title.split(/[ -:：·、-]/))
          .filter(
            (w: string) => w.length > 1 && w.toLowerCase().includes(queryLower),
          ),
      ),
    ).slice(0, 8);
  }

  const realSuggestions = realKeywords.map((word) => {
    const wordLower = word.toLowerCase();
    const queryWords = queryLower.split(/[ -:：·、-]/);

    let score = 1.0;
    if (wordLower === queryLower) {
      score = 2.0;
    } else if (
      wordLower.startsWith(queryLower) ||
      wordLower.endsWith(queryLower)
    ) {
      score = 1.8;
    } else if (queryWords.some((qw) => wordLower.includes(qw))) {
      score = 1.5;
    }

    let type: 'exact' | 'related' | 'suggestion';
    if (score >= 2.0) {
      type = 'exact';
    } else if (score >= 1.5) {
      type = 'related';
    } else {
      type = 'suggestion';
    }

    return {
      text: word,
      type,
      score,
    };
  });

  const sortedSuggestions = realSuggestions.sort((a, b) => {
    if (a.score !== b.score) {
      return b.score - a.score;
    }
    const typePriority = { exact: 3, related: 2, suggestion: 1 };
    return typePriority[b.type] - typePriority[a.type];
  });

  return sortedSuggestions;
}
