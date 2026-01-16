'use client';

import { ChevronRight, X } from 'lucide-react';
import Link from 'next/link';
import { Suspense, useCallback, useEffect, useMemo, useRef,useState } from 'react';

import {
  BangumiCalendarData,
  GetBangumiCalendarData,
} from '@/lib/bangumi.client';
import {
  clearAllFavorites,
  getAllFavorites,
  getAllPlayRecords,
  subscribeToDataUpdates,
} from '@/lib/db.client';
import { getDoubanCategories } from '@/lib/douban.client';
import { DoubanItem } from '@/lib/types';

import CapsuleSwitch from '@/components/CapsuleSwitch';
import ContinueWatching from '@/components/ContinueWatching';
import { useLanguage } from '@/components/LanguageProvider';
import PageLayout from '@/components/PageLayout';
import ScrollableRow from '@/components/ScrollableRow';
import { useSite } from '@/components/SiteProvider';
import VideoCard from '@/components/VideoCard';

// API Response Types
type DoubanResponse = { code: number; list: DoubanItem[] };

// --- Type Definitions ---
type FavoriteItem = {
  id: string;
  source: string;
  title: string;
  year?: string;
  poster: string;
  episodes: number;
  source_name: string;
  currentEpisode?: number;
  search_title?: string;
  origin?: 'vod' | 'live';
  save_time: number;
};

// Strict Record Type
type FavoriteRecord = Record<string, {
  title: string;
  year?: string;
  cover: string;
  total_episodes: number;
  source_name: string;
  search_title?: string;
  origin?: 'vod' | 'live';
  save_time?: number;
}>;

// --- Sub-Component: Skeleton Loader ---
const SectionSkeleton = () => (
  <>
    {Array.from({ length: 8 }).map((_, index) => (
      <div key={index} className='min-w-[96px] w-24 sm:min-w-[180px] sm:w-44'>
        <div className='relative aspect-2/3 w-full overflow-hidden rounded-lg bg-gray-200 animate-pulse dark:bg-gray-800'>
          <div className='absolute inset-0 bg-gray-300 dark:bg-gray-700'></div>
        </div>
        <div className='mt-2 h-4 bg-gray-200 rounded animate-pulse dark:bg-gray-800'></div>
      </div>
    ))}
  </>
);

function HomeClient() {
  const [activeTab, setActiveTab] = useState<'home' | 'favorites'>('home');
  
  // Consolidated Data State
  const [categories, setCategories] = useState<{
    movies: DoubanItem[];
    tv: DoubanItem[];
    variety: DoubanItem[];
    bangumi: BangumiCalendarData[];
  }>({ movies: [], tv: [], variety: [], bangumi: [] });

  // Consolidated Loading State
  const [loadingStates, setLoadingStates] = useState({
    movies: true,
    tv: true,
    variety: true,
    bangumi: true,
  });

  const { announcement } = useSite();
  const { convert } = useLanguage();
  const [showAnnouncement, setShowAnnouncement] = useState(false);
  const [favoriteItems, setFavoriteItems] = useState<FavoriteItem[]>([]);
  const [currentWeekday, setCurrentWeekday] = useState<string>('');

  // --- Effects ---

  // 1. Calculate Date (Client-side only)
  useEffect(() => {
    const today = new Date();
    const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    setCurrentWeekday(weekdays[today.getDay()]);
  }, []);

  // 2. Announcement Logic (Removed redundant window check)
  useEffect(() => {
    if (announcement) {
      const hasSeenAnnouncement = localStorage.getItem('hasSeenAnnouncement');
      if (hasSeenAnnouncement !== announcement) {
        setShowAnnouncement(true);
      } else {
        setShowAnnouncement(Boolean(!hasSeenAnnouncement && announcement));
      }
    }
  }, [announcement]);

  // 3. Consolidated Data Fetching (With Unmount Guard)
  useEffect(() => {
    let isMounted = true;

    const fetchData = async <T,>(
      key: keyof typeof loadingStates,
      fetcher: () => Promise<T>,
      onSuccess: (data: T) => void
    ) => {
      try {
        if (!isMounted) return;
        
        const result = await fetcher();
        
        if (!isMounted) return;
        onSuccess(result);
      } catch (error) {
        console.error(`Fetch failed for ${key}:`, error);
      } finally {
        if (isMounted) {
          setLoadingStates(prev => ({ ...prev, [key]: false }));
        }
      }
    };

    fetchData('movies', 
      () => getDoubanCategories({ kind: 'movie', category: '热门', type: '全部' }),
      (data: DoubanResponse) => { if (data.code === 200) setCategories(prev => ({ ...prev, movies: data.list })); }
    );

    fetchData('tv', 
      () => getDoubanCategories({ kind: 'tv', category: 'tv', type: 'tv' }),
      (data: DoubanResponse) => { if (data.code === 200) setCategories(prev => ({ ...prev, tv: data.list })); }
    );

    fetchData('variety', 
      () => getDoubanCategories({ kind: 'tv', category: 'show', type: 'show' }),
      (data: DoubanResponse) => { if (data.code === 200) setCategories(prev => ({ ...prev, variety: data.list })); }
    );

    // Fetch Bangumi
    fetchData('bangumi', 
      () => GetBangumiCalendarData(),
      (data) => setCategories(prev => ({ ...prev, bangumi: data }))
    );

    return () => { isMounted = false; };
  }, []);

  // 4. Favorites Logic (With Unmount Guard Ref)
  const isMountedRef = useRef(true);
  useEffect(() => {
    isMountedRef.current = true;
    return () => { isMountedRef.current = false; };
  }, []);

  const updateFavoriteItems = useCallback(async (allFavorites: FavoriteRecord) => {
    // Strict typing: unknown -> number
    const safeTime = (t: unknown) => (typeof t === 'number' ? t : 0);

    const allPlayRecords = await getAllPlayRecords();
    
    if (!isMountedRef.current) return;

    const sorted = Object.entries(allFavorites)
      .map(([key, fav]) => {
        const plusIndex = key.indexOf('+');
        if (plusIndex === -1) return null; 
        
        const source = key.slice(0, plusIndex);
        const id = key.slice(plusIndex + 1);
        const playRecord = allPlayRecords[key];

        return {
          id,
          source,
          title: fav.title,
          year: fav.year,
          poster: fav.cover,
          episodes: fav.total_episodes,
          source_name: fav.source_name,
          currentEpisode: playRecord?.index,
          search_title: fav?.search_title,
          origin: fav?.origin,
          save_time: safeTime(fav.save_time),
        } as FavoriteItem;
      })
      .filter((item): item is FavoriteItem => item !== null)
      .sort((a, b) => b.save_time - a.save_time);

    setFavoriteItems(sorted);
  }, []);

  useEffect(() => {
    if (activeTab !== 'favorites') return;

    const loadFavorites = async () => {
      const allFavorites = await getAllFavorites();
      if (isMountedRef.current) {
        // Cast as unknown -> Record for strict type compliance at boundary
        await updateFavoriteItems(allFavorites as unknown as FavoriteRecord);
      }
    };

    loadFavorites();

    const unsubscribe = subscribeToDataUpdates('favoritesUpdated', (data) => {
      if (isMountedRef.current) updateFavoriteItems(data as unknown as FavoriteRecord);
    });
    return unsubscribe;
  }, [activeTab, updateFavoriteItems]);

  const handleCloseAnnouncement = (txt: string) => {
    setShowAnnouncement(false);
    localStorage.setItem('hasSeenAnnouncement', txt);
  };

  // 5. Memoized Anime List
  const todayAnimes = useMemo(() => {
    return categories.bangumi.find(
      (item) => item.weekday.en === currentWeekday
    )?.items || [];
  }, [categories.bangumi, currentWeekday]);

  return (
    <PageLayout>
      <div className='px-2 sm:px-10 py-4 sm:py-8 overflow-visible'>
        {/* Tab Switch */}
        <div className='mb-8 flex justify-center'>
          <CapsuleSwitch
            options={[
              { label: convert('首页'), value: 'home' },
              { label: convert('收藏夹'), value: 'favorites' },
            ]}
            active={activeTab}
            onChange={(value) => setActiveTab(value as 'home' | 'favorites')}
          />
        </div>

        <div className='max-w-[95%] mx-auto'>
          {activeTab === 'favorites' ? (
            // Favorites View
            <section className='mb-8'>
              <div className='mb-4 flex items-center justify-between'>
                <h2 className='text-xl font-bold text-gray-800 dark:text-gray-200'>{convert('我的收藏')}</h2>
                {favoriteItems.length > 0 && (
                  <button
                    className='text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
                    onClick={async () => {
                      await clearAllFavorites();
                      if (isMountedRef.current) setFavoriteItems([]);
                    }}
                  >
                    {convert('清空')}
                  </button>
                )}
              </div>
              <div className='justify-start grid grid-cols-3 gap-x-2 gap-y-14 sm:gap-y-20 px-0 sm:px-2 sm:grid-cols-[repeat(auto-fill,minmax(11rem,1fr))] sm:gap-x-8'>
                {favoriteItems.map((item) => (
                  <div key={`${item.source}-${item.id}`} className='w-full'>
                    <VideoCard
                      query={item.search_title}
                      {...item}
                      from='favorite'
                      type={item.episodes > 1 ? 'tv' : ''}
                    />
                  </div>
                ))}
                {favoriteItems.length === 0 && (
                  <div className='col-span-full text-center text-gray-500 py-8 dark:text-gray-400'>
                    {convert('暂无收藏内容')}
                  </div>
                )}
              </div>
            </section>
          ) : (
            // Home View
            <>
              <ContinueWatching />

              {/* Movies */}
              <section className='mb-8'>
                <div className='mb-4 flex items-center justify-between'>
                  <h2 className='text-xl font-bold text-gray-800 dark:text-gray-200'>{convert('热门电影')}</h2>
                  <Link href='/douban?type=movie' className='flex items-center text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'>
                    {convert('查看更多')} <ChevronRight className='w-4 h-4 ml-1' />
                  </Link>
                </div>
                <ScrollableRow>
                  {loadingStates.movies ? <SectionSkeleton /> : categories.movies.map((movie, index) => (
                    <div key={index} className='min-w-[96px] w-24 sm:min-w-[180px] sm:w-44'>
                      <VideoCard from='douban' title={movie.title} poster={movie.poster} douban_id={Number(movie.id)} rate={movie.rate} year={movie.year} type='movie' />
                    </div>
                  ))}
                </ScrollableRow>
              </section>

              {/* TV Shows */}
              <section className='mb-8'>
                <div className='mb-4 flex items-center justify-between'>
                  <h2 className='text-xl font-bold text-gray-800 dark:text-gray-200'>{convert('热门剧集')}</h2>
                  <Link href='/douban?type=tv' className='flex items-center text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'>
                    {convert('查看更多')} <ChevronRight className='w-4 h-4 ml-1' />
                  </Link>
                </div>
                <ScrollableRow>
                  {loadingStates.tv ? <SectionSkeleton /> : categories.tv.map((show, index) => (
                    <div key={index} className='min-w-[96px] w-24 sm:min-w-[180px] sm:w-44'>
                      <VideoCard from='douban' title={show.title} poster={show.poster} douban_id={Number(show.id)} rate={show.rate} year={show.year} />
                    </div>
                  ))}
                </ScrollableRow>
              </section>

              {/* Anime (Bangumi) */}
              <section className='mb-8'>
                <div className='mb-4 flex items-center justify-between'>
                  <h2 className='text-xl font-bold text-gray-800 dark:text-gray-200'>{convert('新番放送')}</h2>
                  <Link href='/douban?type=anime' className='flex items-center text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'>
                    {convert('查看更多')} <ChevronRight className='w-4 h-4 ml-1' />
                  </Link>
                </div>
                <ScrollableRow>
                  {loadingStates.bangumi ? <SectionSkeleton /> : todayAnimes.map((anime, index) => (
                    <div key={`${anime.id}-${index}`} className='min-w-[96px] w-24 sm:min-w-[180px] sm:w-44'>
                      <VideoCard
                        from='douban'
                        title={anime.name_cn || anime.name}
                        poster={anime.images.large || anime.images.common || anime.images.medium || anime.images.grid}
                        douban_id={anime.id}
                        rate={anime.rating?.score?.toFixed(1) || ''}
                        year={anime.air_date?.split('-')?.[0] || ''}
                        isBangumi={true}
                      />
                    </div>
                  ))}
                </ScrollableRow>
              </section>

              {/* Variety */}
              <section className='mb-8'>
                <div className='mb-4 flex items-center justify-between'>
                  <h2 className='text-xl font-bold text-gray-800 dark:text-gray-200'>{convert('热门综艺')}</h2>
                  <Link href='/douban?type=show' className='flex items-center text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'>
                    {convert('查看更多')} <ChevronRight className='w-4 h-4 ml-1' />
                  </Link>
                </div>
                <ScrollableRow>
                  {loadingStates.variety ? <SectionSkeleton /> : categories.variety.map((show, index) => (
                    <div key={index} className='min-w-[96px] w-24 sm:min-w-[180px] sm:w-44'>
                      <VideoCard from='douban' title={show.title} poster={show.poster} douban_id={Number(show.id)} rate={show.rate} year={show.year} />
                    </div>
                  ))}
                </ScrollableRow>
              </section>
            </>
          )}
        </div>
      </div>
      
      {/* Announcement Modal - Final Polish */}
      {announcement && showAnnouncement && (
        <div
          className={`fixed inset-0 z-1050 flex items-center justify-center bg-black/50 backdrop-blur-sm dark:bg-black/70 p-4 transition-opacity duration-300 ${showAnnouncement ? '' : 'opacity-0 pointer-events-none'}`}
          onClick={(e) => {
            if (e.target === e.currentTarget) handleCloseAnnouncement(announcement);
          }}
          style={{ touchAction: 'none' }}
        >
          <div
            className='w-full max-w-md rounded-xl bg-white p-6 shadow-xl dark:bg-gray-900 transform transition-all duration-300 hover:shadow-2xl'
            onClick={(e) => e.stopPropagation()} 
            style={{ touchAction: 'auto' }}
          >
            <div className='flex justify-between items-start mb-4'>
              <h3 className='text-2xl font-bold tracking-tight text-gray-800 dark:text-white border-b border-green-500 pb-1'>
                {convert('提示')}
              </h3>
              <button 
                onClick={() => handleCloseAnnouncement(announcement)} 
                className='p-1 text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300 transition-colors rounded-full hover:bg-black/5 dark:hover:bg-white/10' 
                aria-label={convert('关闭')}
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className='mb-6'>
              <div className='relative overflow-hidden rounded-lg mb-4 bg-green-50 dark:bg-green-900/20'>
                <div className='absolute inset-y-0 left-0 w-1.5 bg-green-500 dark:bg-green-400'></div>
                <p className='ml-4 text-gray-600 dark:text-gray-300 leading-relaxed'>{announcement}</p>
              </div>
            </div>
            <button
              onClick={() => handleCloseAnnouncement(announcement)}
              className='w-full rounded-lg bg-linear-to-r from-green-600 to-green-700 px-4 py-3 text-white font-medium shadow-md hover:shadow-lg transition-all duration-300'
            >
              {convert('我知道了')}
            </button>
          </div>
        </div>
      )}
    </PageLayout>
  );
}

export default function Home() {
  return (
    <Suspense>
      <HomeClient />
    </Suspense>
  );
}