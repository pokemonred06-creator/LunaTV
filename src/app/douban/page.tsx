'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useRef, useState } from 'react';

import { GetBangumiCalendarData } from '@/lib/bangumi.client';
import {
  getDoubanCategories,
  getDoubanList,
  getDoubanRecommends,
} from '@/lib/douban.client';
import { DoubanItem, DoubanResult } from '@/lib/types';

import DoubanCardSkeleton from '@/components/DoubanCardSkeleton';
import DoubanCustomSelector from '@/components/DoubanCustomSelector';
import DoubanSelector from '@/components/DoubanSelector';
import PageLayout from '@/components/PageLayout';
import VideoCard from '@/components/VideoCard';

// --- Types ---
interface CustomCategory {
  name: string;
  type: 'movie' | 'tv';
  query: string;
}

interface FilterState {
  primary: string;
  secondary: string;
  weekday: string;
  multiLevel: Record<string, string>;
}

// --- Helper: Centralized Data Fetching Logic ---
const fetchDoubanDataInternal = async (
  type: string,
  filters: FilterState,
  page: number,
  customCategories: CustomCategory[],
): Promise<DoubanResult> => {
  const pageLimit = 25;
  const pageStart = page * pageLimit;

  // 1. Custom Category Logic
  if (type === 'custom') {
    const selectedCategory = customCategories.find(
      (cat) => cat.type === filters.primary && cat.query === filters.secondary,
    );
    if (!selectedCategory) throw new Error('Category not found');

    return getDoubanList({
      tag: selectedCategory.query,
      type: selectedCategory.type,
      pageLimit,
      pageStart,
    });
  }

  // 2. Bangumi Calendar Logic
  if (type === 'anime' && filters.primary === '每日放送') {
    if (page > 0) return { code: 200, message: 'success', list: [] };

    const calendarData = await GetBangumiCalendarData();
    const weekdayData = calendarData.find(
      (item) => item.weekday.en === filters.weekday,
    );

    if (!weekdayData) throw new Error('Weekday data not found');

    return {
      code: 200,
      message: 'success',
      list: weekdayData.items.map((item) => ({
        id: item.id?.toString() || '',
        title: item.name_cn || item.name,
        poster:
          item.images?.large || item.images?.common || item.images?.grid || '',
        rate: item.rating?.score?.toFixed(1) || '',
        year: item.air_date?.split('-')?.[0] || '',
      })),
    };
  }

  // 3. Recommendation Logic
  if (
    type === 'anime' ||
    filters.primary === '全部' ||
    (type !== 'movie' && type !== 'tv' && type !== 'show')
  ) {
    const isAnime = type === 'anime';
    const isShow = type === 'show';
    const isTv = type === 'tv';

    let kind: 'movie' | 'tv' = isShow || isTv ? 'tv' : 'movie';
    if (isAnime && filters.primary === '番剧') kind = 'tv';

    let format = '';
    if (isShow) format = '综艺';
    if (isTv) format = '电视剧';
    if (isAnime && filters.primary === '番剧') format = '电视剧';

    const category = isAnime ? '动画' : filters.multiLevel.type || '';

    return getDoubanRecommends({
      kind,
      pageLimit,
      pageStart,
      category,
      format,
      region: filters.multiLevel.region || '',
      year: filters.multiLevel.year || '',
      platform: filters.multiLevel.platform || '',
      sort: filters.multiLevel.sort || '',
      label: filters.multiLevel.label || '',
    });
  }

  // 4. Standard Category Logic
  let reqKind: 'tv' | 'movie' = 'movie';
  let reqCategory = filters.primary;
  let reqType = filters.secondary;

  if (type === 'tv' || type === 'show') {
    reqKind = 'tv';
    reqCategory = type;
    reqType = filters.secondary;
  }

  return getDoubanCategories({
    kind: reqKind,
    category: reqCategory,
    type: reqType,
    pageLimit,
    pageStart,
  });
};

function DoubanPageClient() {
  const searchParams = useSearchParams();
  const type = searchParams.get('type') || 'movie';

  // State
  const [doubanData, setDoubanData] = useState<DoubanItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);

  // Page State & Ref (Ref used to prevent stale closure in loadMore)
  const [page, setPage] = useState(0);
  const pageRef = useRef(0);

  const [customCategories, setCustomCategories] = useState<CustomCategory[]>(
    [],
  );
  const [selectorsReady, setSelectorsReady] = useState(false);

  const [filters, setFilters] = useState<FilterState>({
    primary: '',
    secondary: '',
    weekday: '',
    multiLevel: {
      type: 'all',
      region: 'all',
      year: 'all',
      platform: 'all',
      label: 'all',
      sort: 'T',
    },
  });

  // Race Condition Guard
  const requestIdRef = useRef(0);
  const observerTarget = useRef<HTMLDivElement>(null);

  // Sync page ref
  useEffect(() => {
    pageRef.current = page;
  }, [page]);

  // 1. Initialize Runtime Config
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const win = window as unknown as {
        RUNTIME_CONFIG?: { CUSTOM_CATEGORIES?: CustomCategory[] };
      };
      const categories = win.RUNTIME_CONFIG?.CUSTOM_CATEGORIES;
      if (categories && categories.length > 0) {
        setCustomCategories(categories);
      }
    }
  }, []);

  // 2. Initialize Default Filters based on Type
  useEffect(() => {
    setSelectorsReady(false);
    setLoading(true);
    setDoubanData([]);
    setPage(0);

    let newPrimary = '';
    let newSecondary = '全部';
    let newWeekday = '';

    if (type === 'custom' && customCategories.length > 0) {
      const types = Array.from(
        new Set(customCategories.map((cat) => cat.type)),
      );
      const selectedType = types.includes('movie') ? 'movie' : types[0] || 'tv';
      newPrimary = selectedType;

      const firstCat = customCategories.find(
        (cat) => cat.type === selectedType,
      );
      if (firstCat) newSecondary = firstCat.query;
    } else {
      if (type === 'anime') {
        newPrimary = '每日放送';
        newSecondary = '全部';
        const today = new Date().getDay();
        const weekdayMap = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        newWeekday = weekdayMap[today];
      } else if (type === 'movie') {
        newPrimary = '热门';
        newSecondary = '全部';
      } else if (type === 'tv') {
        newPrimary = '最近热门';
        newSecondary = 'tv';
      } else if (type === 'show') {
        newPrimary = '最近热门';
        newSecondary = 'show';
      }
    }

    setFilters({
      primary: newPrimary,
      secondary: newSecondary,
      weekday: newWeekday,
      multiLevel: {
        type: 'all',
        region: 'all',
        year: 'all',
        platform: 'all',
        label: 'all',
        sort: 'T',
      },
    });

    const timer = setTimeout(() => setSelectorsReady(true), 50);
    return () => clearTimeout(timer);
  }, [type, customCategories]);

  // 3. Data Fetching (Initial + Filter Change)
  useEffect(() => {
    if (!selectorsReady) return;

    // Increment Request ID: Any previous pending requests will now be considered "stale"
    const currentRequestId = ++requestIdRef.current;

    const fetchData = async () => {
      try {
        setLoading(true);
        setPage(0);

        const data = await fetchDoubanDataInternal(
          type,
          filters,
          0,
          customCategories,
        );

        // Guard: If requestId changed while we were fetching, ignore this result
        if (currentRequestId !== requestIdRef.current) return;

        if (data.code === 200) {
          setDoubanData(data.list);
          setHasMore(data.list.length > 0);
        } else {
          setHasMore(false);
          setDoubanData([]);
        }
      } catch (err) {
        if (currentRequestId !== requestIdRef.current) return;
        console.error(err);
        setDoubanData([]);
      } finally {
        if (currentRequestId === requestIdRef.current) {
          setLoading(false);
        }
      }
    };

    fetchData();
  }, [selectorsReady, type, filters, customCategories]);

  // 4. Load More (Pagination)
  const handleLoadMore = useCallback(async () => {
    // Basic guards
    if (loading || loadingMore || !hasMore) return;

    // Capture the request ID at the start of this pagination attempt
    const currentRequestId = requestIdRef.current;

    try {
      setLoadingMore(true);
      const nextPage = pageRef.current + 1; // Use Ref to ensure we get the true current page

      const data = await fetchDoubanDataInternal(
        type,
        filters,
        nextPage,
        customCategories,
      );

      // Guard: If user changed filters while "Load More" was running, abort update
      if (currentRequestId !== requestIdRef.current) return;

      if (data.code === 200) {
        if (data.list.length === 0) {
          setHasMore(false);
        } else {
          setDoubanData((prev) => {
            // Deduplicate items using a Set to be safe
            const existingIds = new Set(prev.map((p) => p.id));
            const newItems = data.list.filter(
              (item) => !existingIds.has(item.id),
            );
            return [...prev, ...newItems];
          });
          setPage(nextPage);
        }
      } else {
        setHasMore(false);
      }
    } catch (err) {
      if (currentRequestId !== requestIdRef.current) return;
      console.error(err);
      setHasMore(false);
    } finally {
      if (currentRequestId === requestIdRef.current) {
        setLoadingMore(false);
      }
    }
  }, [type, filters, loading, loadingMore, hasMore, customCategories]);

  // 5. Intersection Observer
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMore && !loading && !loadingMore) {
          handleLoadMore();
        }
      },
      { threshold: 0.1, rootMargin: '100px' },
    );

    const el = observerTarget.current;
    if (el) observer.observe(el);

    return () => {
      observer.disconnect(); // Safe cleanup
    };
  }, [handleLoadMore, hasMore, loading, loadingMore]);

  // --- Handlers ---
  const handlePrimaryChange = (value: string) => {
    if (value === filters.primary) return;

    let newSecondary = filters.secondary;
    if (type === 'custom' && customCategories.length > 0) {
      const firstCat = customCategories.find((cat) => cat.type === value);
      if (firstCat) newSecondary = firstCat.query;
    } else if ((type === 'tv' || type === 'show') && value === '最近热门') {
      newSecondary = type === 'tv' ? 'tv' : 'show';
    }

    setFilters((prev) => ({
      ...prev,
      primary: value,
      secondary: newSecondary,
      multiLevel: {
        type: 'all',
        region: 'all',
        year: 'all',
        platform: 'all',
        label: 'all',
        sort: 'T',
      },
    }));
  };

  const handleSecondaryChange = (value: string) => {
    setFilters((prev) => ({ ...prev, secondary: value }));
  };

  const handleMultiLevelChange = (values: Record<string, string>) => {
    setFilters((prev) => ({ ...prev, multiLevel: values }));
  };

  const handleWeekdayChange = (value: string) => {
    setFilters((prev) => ({ ...prev, weekday: value }));
  };

  // --- UI Helpers ---
  const getPageTitle = () => {
    switch (type) {
      case 'movie':
        return '电影';
      case 'tv':
        return '电视剧';
      case 'anime':
        return '动漫';
      case 'show':
        return '综艺';
      default:
        return '自定义';
    }
  };

  const getPageDescription = () => {
    if (type === 'anime' && filters.primary === '每日放送') {
      return '来自 Bangumi 番组计划的精选内容';
    }
    return '来自豆瓣的精选内容';
  };

  const activePath = `/douban${type ? `?type=${type}` : ''}`;
  const skeletonData = Array.from({ length: 18 }, (_, index) => index);

  return (
    <PageLayout activePath={activePath}>
      <div className='px-4 sm:px-10 py-4 sm:py-8 overflow-visible'>
        {/* Header & Selectors */}
        <div className='mb-6 sm:mb-8 space-y-4 sm:space-y-6'>
          <div>
            <h1 className='text-2xl sm:text-3xl font-bold text-gray-800 mb-1 sm:mb-2 dark:text-gray-200'>
              {getPageTitle()}
            </h1>
            <p className='text-sm sm:text-base text-gray-600 dark:text-gray-400'>
              {getPageDescription()}
            </p>
          </div>

          <div className='bg-white/60 dark:bg-gray-800/40 rounded-2xl p-4 sm:p-6 border border-gray-200/30 dark:border-gray-700/30 backdrop-blur-sm'>
            {type === 'custom' ? (
              <DoubanCustomSelector
                customCategories={customCategories}
                primarySelection={filters.primary}
                secondarySelection={filters.secondary}
                onPrimaryChange={handlePrimaryChange}
                onSecondaryChange={handleSecondaryChange}
              />
            ) : (
              <DoubanSelector
                type={type as 'movie' | 'tv' | 'show' | 'anime'}
                primarySelection={filters.primary}
                secondarySelection={filters.secondary}
                onPrimaryChange={handlePrimaryChange}
                onSecondaryChange={handleSecondaryChange}
                onMultiLevelChange={handleMultiLevelChange}
                onWeekdayChange={handleWeekdayChange}
              />
            )}
          </div>
        </div>

        {/* Grid Content */}
        <div className='max-w-[95%] mx-auto mt-8 overflow-visible'>
          <div className='justify-start grid grid-cols-3 gap-x-2 gap-y-12 px-0 sm:px-2 sm:grid-cols-[repeat(auto-fill,minmax(160px,1fr))] sm:gap-x-8 sm:gap-y-20'>
            {loading && doubanData.length === 0
              ? skeletonData.map((index) => (
                  <DoubanCardSkeleton key={`skeleton-${index}`} />
                ))
              : doubanData.map((item) => (
                  <div key={item.id} className='w-full'>
                    <VideoCard
                      from='douban'
                      title={item.title}
                      poster={item.poster}
                      douban_id={Number(item.id)}
                      rate={item.rate}
                      year={item.year}
                      type={type === 'movie' ? 'movie' : ''}
                      isBangumi={
                        type === 'anime' && filters.primary === '每日放送'
                      }
                    />
                  </div>
                ))}
          </div>

          {/* Load More Trigger */}
          <div
            ref={observerTarget}
            className='flex justify-center mt-12 py-8 min-h-[60px]'
          >
            {(loading || loadingMore) && doubanData.length > 0 && (
              <div className='flex items-center gap-2'>
                <div className='animate-spin rounded-full h-6 w-6 border-b-2 border-green-500'></div>
                <span className='text-gray-600 dark:text-gray-400'>
                  加载中...
                </span>
              </div>
            )}

            {!hasMore && !loading && doubanData.length > 0 && (
              <div className='text-center text-gray-500 dark:text-gray-400'>
                已加载全部内容
              </div>
            )}

            {!loading && doubanData.length === 0 && (
              <div className='text-center text-gray-500 dark:text-gray-400'>
                暂无相关内容
              </div>
            )}
          </div>
        </div>
      </div>
    </PageLayout>
  );
}

export default function DoubanPage() {
  return (
    <Suspense>
      <DoubanPageClient />
    </Suspense>
  );
}
