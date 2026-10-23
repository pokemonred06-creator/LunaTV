import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth/server';
import { fetchDoubanData } from '@/lib/douban';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  try {
    // Verify authentication
    const authInfo = await getAuthInfoFromCookie(request);
    if (!authInfo || !authInfo.username) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    const type = searchParams.get('type') || 'movie'; // 'movie' or 'tv'

    if (!id) {
      return NextResponse.json({ error: '缺少 id 参数' }, { status: 400 });
    }

    if (!/^\d+$/.test(id)) {
      return NextResponse.json({ error: '无效的 id 格式' }, { status: 400 });
    }

    if (!['movie', 'tv'].includes(type)) {
      return NextResponse.json({ error: '无效的 type 参数' }, { status: 400 });
    }

    const target = `https://m.douban.com/rexxar/api/v2/${type}/${id}`;

    interface DoubanDetailResponse {
      intro?: string;
      summary?: string;
      card_subtitle?: string;
    }

    // Fetch and cache with 1 day TTL (1440 minutes)
    const data = await fetchDoubanData<DoubanDetailResponse>(target, 1440);

    return NextResponse.json({
      intro: data.intro || data.summary || '',
      subtitle: data.card_subtitle || '',
    });
  } catch (error) {
    console.error('获取豆瓣详情失败:', error);
    return NextResponse.json(
      { error: '获取豆瓣详情失败', details: (error as Error).message },
      { status: 500 },
    );
  }
}
