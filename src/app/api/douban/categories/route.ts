import { NextResponse } from 'next/server';

import { getConfig } from '@/lib/config';
import { fetchDoubanData } from '@/lib/douban';
import { DoubanItem, DoubanResult } from '@/lib/types';

interface DoubanCategoryApiResponse {
  total: number;
  items: Array<{
    id: string;
    title: string;
    card_subtitle: string;
    pic: {
      large: string;
      normal: string;
    };
    rating: {
      value: number;
    };
  }>;
}

export const runtime = 'nodejs';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);

  // 获取参数
  const kind = searchParams.get('kind') || 'movie';
  const category = searchParams.get('category');
  const type = searchParams.get('type');
  const pageLimit = parseInt(searchParams.get('limit') || '20');
  const pageStart = parseInt(searchParams.get('start') || '0');

  // 验证参数
  if (!kind || !category || !type) {
    return NextResponse.json(
      { error: '缺少必要参数: kind 或 category 或 type' },
      { status: 400 }
    );
  }

  if (!['tv', 'movie'].includes(kind)) {
    return NextResponse.json(
      { error: 'kind 参数必须是 tv 或 movie' },
      { status: 400 }
    );
  }

  if (pageLimit < 1 || pageLimit > 100) {
    return NextResponse.json(
      { error: 'pageSize 必须在 1-100 之间' },
      { status: 400 }
    );
  }

  if (pageStart < 0) {
    return NextResponse.json(
      { error: 'pageStart 不能小于 0' },
      { status: 400 }
    );
  }

  // 获取配置
  const config = await getConfig();
  const doubanProxyType = config.SiteConfig.DoubanProxyType;
  const doubanProxy = config.SiteConfig.DoubanProxy;

  let targetBaseUrl = `https://m.douban.com`;
  let useProxy = false;
  let finalProxyUrl = '';

  switch (doubanProxyType) {
    case 'cmliussss-cdn-tencent':
      targetBaseUrl = `https://m.douban.cmliussss.net`;
      break;
    case 'cmliussss-cdn-ali':
      targetBaseUrl = `https://m.douban.cmliussss.com`;
      break;
    case 'custom':
      useProxy = true;
      finalProxyUrl = doubanProxy;
      break;
    case 'direct':
    default:
      // Direct access from server
      break;
  }

  const doubanApiPath = `/rexxar/api/v2/subject/recent_hot/${kind}?start=${pageStart}&limit=${pageLimit}&category=${category}&type=${type}`;
  let target = `${targetBaseUrl}${doubanApiPath}`;

  // If using a custom proxy, append the original target URL to the proxy URL
  if (useProxy && finalProxyUrl) {
    target = `${finalProxyUrl}${encodeURIComponent(target)}`;
  }

  try {
    // 调用豆瓣 API
    const doubanData = await fetchDoubanData<DoubanCategoryApiResponse>(target);

    // 转换数据格式
    const list: DoubanItem[] = doubanData.items.map((item) => ({
      id: item.id,
      title: item.title,
      poster: item.pic?.normal || item.pic?.large || '',
      rate: item.rating?.value ? item.rating.value.toFixed(1) : '',
      year: item.card_subtitle?.match(/(\d{4})/)?.[1] || '',
    }));

    const response: DoubanResult = {
      code: 200,
      message: '获取成功',
      list: list,
    };

    const cacheTime = config.SiteConfig.SiteInterfaceCacheTime || 7200; // Use SiteInterfaceCacheTime
    return NextResponse.json(response, {
      headers: {
        'Cache-Control': `public, max-age=${cacheTime}, s-maxage=${cacheTime}`,
        'CDN-Cache-Control': `public, s-maxage=${cacheTime}`,
        'Vercel-CDN-Cache-Control': `public, s-maxage=${cacheTime}`,
        'Netlify-Vary': 'query',
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: '获取豆瓣数据失败', details: (error as Error).message },
      { status: 500 }
    );
  }
}
