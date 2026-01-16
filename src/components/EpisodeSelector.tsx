/* eslint-disable @next/next/no-img-element */

import { useRouter } from 'next/navigation';
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { SearchResult } from '@/lib/types';
import { getVideoResolutionFromM3u8, processImageUrl } from '@/lib/utils';

interface VideoInfo {
  quality: string;
  loadSpeed: string;
  pingTime: number;
  hasError?: boolean;
}

interface EpisodeSelectorProps {
  totalEpisodes: number;
  episodes_titles: string[];
  episodesPerPage?: number;
  value?: number;
  onChange?: (episodeNumber: number) => void;
  onSourceChange?: (source: string, id: string, title: string) => void;
  currentSource?: string;
  currentId?: string;
  videoTitle?: string;
  availableSources?: SearchResult[];
  sourceSearchLoading?: boolean;
  sourceSearchError?: string | null;
  precomputedVideoInfo?: Map<string, VideoInfo>;
}

const EpisodeSelector: React.FC<EpisodeSelectorProps> = ({
  totalEpisodes,
  episodes_titles,
  episodesPerPage = 50,
  value = 1,
  onChange,
  onSourceChange,
  currentSource,
  currentId,
  videoTitle,
  availableSources = [],
  sourceSearchLoading = false,
  sourceSearchError = null,
  precomputedVideoInfo,
}) => {
  const router = useRouter();

  // --- 1. Optimistic UI State ---
  const [optimisticValue, setOptimisticValue] = useState(value);
  const lastIntentRef = useRef(value);

  useEffect(() => {
    if (value === lastIntentRef.current) {
      setOptimisticValue(value);
    }
  }, [value]);

  const pageCount = Math.ceil(totalEpisodes / episodesPerPage);

  // Video Info State
  const [videoInfoMap, setVideoInfoMap] = useState<Map<string, VideoInfo>>(
    new Map(),
  );
  const [attemptedSources, setAttemptedSources] = useState<Set<string>>(
    new Set(),
  );

  // Refs for async safety
  const attemptedSourcesRef = useRef<Set<string>>(new Set());
  const videoInfoMapRef = useRef<Map<string, VideoInfo>>(new Map());
  const fetchRunIdRef = useRef(0);

  // Keep refs in sync with state for standard renders
  useEffect(() => {
    attemptedSourcesRef.current = attemptedSources;
  }, [attemptedSources]);

  useEffect(() => {
    videoInfoMapRef.current = videoInfoMap;
  }, [videoInfoMap]);

  // Tab State
  const [activeTab, setActiveTab] = useState<'episodes' | 'sources'>(
    totalEpisodes > 1 ? 'episodes' : 'sources',
  );

  // --- 2. Memoized Sorted Sources ---
  const sortedSources = useMemo(() => {
    const arr = [...availableSources];
    return arr.sort((a, b) => {
      const aIsCurrent =
        String(a.source) === String(currentSource) &&
        String(a.id) === String(currentId);
      const bIsCurrent =
        String(b.source) === String(currentSource) &&
        String(b.id) === String(currentId);
      if (aIsCurrent && !bIsCurrent) return -1;
      if (!aIsCurrent && bIsCurrent) return 1;
      return 0;
    });
  }, [availableSources, currentSource, currentId]);

  // --- 3. Lazy Page Initialization ---
  const [currentPage, setCurrentPage] = useState(() =>
    Math.floor((value - 1) / episodesPerPage),
  );
  const [descending, setDescending] = useState<boolean>(false);

  useEffect(() => {
    if (value === lastIntentRef.current) {
      const newPage = Math.floor((value - 1) / episodesPerPage);
      if (activeTab === 'episodes' && newPage !== currentPage) {
        setCurrentPage(newPage);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, episodesPerPage]);

  const displayPage = useMemo(() => {
    if (descending) return pageCount - 1 - currentPage;
    return currentPage;
  }, [currentPage, descending, pageCount]);

  // --- Video Info Fetching (With AbortSignal) ---
  const getVideoInfo = useCallback(
    async (source: SearchResult, signal?: AbortSignal) => {
      const sourceKey = `${source.source}-${source.id}`;
      if (attemptedSourcesRef.current.has(sourceKey)) return;

      if (!source.episodes || source.episodes.length === 0) return;
      const episodeUrl =
        source.episodes.length > 1 ? source.episodes[1] : source.episodes[0];

      attemptedSourcesRef.current.add(sourceKey);
      setAttemptedSources((prev) => new Set(prev).add(sourceKey));

      try {
        const info = await getVideoResolutionFromM3u8(episodeUrl, { signal });
        setVideoInfoMap((prev) => new Map(prev).set(sourceKey, info));
      } catch (error: unknown) {
        if (error instanceof Error && error.name === 'AbortError') return;

        setVideoInfoMap((prev) =>
          new Map(prev).set(sourceKey, {
            quality: '错误',
            loadSpeed: '未知',
            pingTime: 0,
            hasError: true,
          }),
        );
      }
    },
    [],
  );

  // --- Sync Logic (Fixed: Ref Sync & Retry Prevention) ---
  useEffect(() => {
    if (precomputedVideoInfo && precomputedVideoInfo.size > 0) {
      setVideoInfoMap((prev) => {
        const newMap = new Map(prev);
        precomputedVideoInfo.forEach((value, key) => newMap.set(key, value));
        return newMap;
      });

      setAttemptedSources((prev) => {
        const newSet = new Set(prev);
        // Mark ALL keys as attempted (even errors) to prevent infinite retries
        precomputedVideoInfo.forEach((_info, key) => {
          newSet.add(key);
        });

        // FIX: Sync ref IMMEDIATELY to prevent race conditions in the fetch loop
        attemptedSourcesRef.current = newSet;

        return newSet;
      });
    }
  }, [precomputedVideoInfo]);

  const [optimizationEnabled, setOptimizationEnabled] = useState<boolean>(true);
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('enableOptimization');
      if (saved !== null) {
        try {
          setOptimizationEnabled(JSON.parse(saved));
        } catch {
          /* parse error */
        }
      }
    }
  }, []);

  // --- 4. Robust Cancellable Fetch Loop ---
  useEffect(() => {
    if (!optimizationEnabled || activeTab !== 'sources') return;

    const runId = ++fetchRunIdRef.current;
    const currentRunIdRef = fetchRunIdRef; // Capture ref for cleanup
    const ac = new AbortController();

    const runSpeedTests = async () => {
      const pendingSources = sortedSources.filter((source) => {
        const sourceKey = `${source.source}-${source.id}`;
        return !attemptedSourcesRef.current.has(sourceKey);
      });

      if (pendingSources.length === 0) return;

      // Sequential loop with yielding to main thread
      for (const source of pendingSources) {
        if (runId !== currentRunIdRef.current) return;

        await getVideoInfo(source, ac.signal);

        if (runId !== currentRunIdRef.current) return;
        // Vital: Yield to main thread to keep UI responsive
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    };

    runSpeedTests();

    return () => {
      currentRunIdRef.current++;
      ac.abort(); // Cancel pending network requests immediately
    };
  }, [activeTab, sortedSources, getVideoInfo, optimizationEnabled]);

  // --- Pagination Logic ---
  const categoriesAsc = useMemo(() => {
    return Array.from({ length: pageCount }, (_, i) => {
      const start = i * episodesPerPage + 1;
      const end = Math.min(start + episodesPerPage - 1, totalEpisodes);
      return { start, end };
    });
  }, [pageCount, episodesPerPage, totalEpisodes]);

  const categories = useMemo(() => {
    if (descending) {
      return [...categoriesAsc]
        .reverse()
        .map(({ start, end }) => `${end}-${start}`);
    }
    return categoriesAsc.map(({ start, end }) => `${start}-${end}`);
  }, [categoriesAsc, descending]);

  const categoryContainerRef = useRef<HTMLDivElement>(null);
  const buttonRefs = useRef<(HTMLButtonElement | null)[]>([]);

  // --- 5. Robust Scroll Listener ---
  useEffect(() => {
    const el = categoryContainerRef.current;
    if (!el || activeTab !== 'episodes') return;

    const onWheel = (e: WheelEvent) => {
      const rect = el.getBoundingClientRect();
      const x = e.clientX;
      const y = e.clientY;

      const inside =
        x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
      if (!inside) return;

      const maxScrollLeft = el.scrollWidth - el.clientWidth;
      if (maxScrollLeft <= 0) return;

      const atLeft = el.scrollLeft <= 0;
      const atRight = el.scrollLeft >= maxScrollLeft - 1;
      const scrollingUp = e.deltaY < 0;
      const scrollingDown = e.deltaY > 0;

      if ((atLeft && scrollingUp) || (atRight && scrollingDown)) return;

      e.preventDefault();
      e.stopPropagation();
      el.scrollBy({ left: e.deltaY, behavior: 'auto' });
    };

    el.addEventListener('wheel', onWheel, { passive: false });

    return () => {
      el.removeEventListener('wheel', onWheel);
    };
  }, [activeTab]);

  useEffect(() => {
    const btn = buttonRefs.current[displayPage];
    const container = categoryContainerRef.current;
    if (btn && container) {
      const containerRect = container.getBoundingClientRect();
      const btnRect = btn.getBoundingClientRect();
      const scrollLeft = container.scrollLeft;
      const btnLeft = btnRect.left - containerRect.left + scrollLeft;
      const targetScrollLeft =
        btnLeft - (containerRect.width - btnRect.width) / 2;

      container.scrollTo({ left: targetScrollLeft, behavior: 'smooth' });
    }
  }, [displayPage, pageCount, activeTab]);

  const handleCategoryClick = useCallback(
    (index: number) => {
      if (descending) {
        setCurrentPage(pageCount - 1 - index);
      } else {
        setCurrentPage(index);
      }
    },
    [descending, pageCount],
  );

  const handleEpisodeClick = useCallback(
    (episodeNumber: number) => {
      lastIntentRef.current = episodeNumber;
      setOptimisticValue(episodeNumber);
      onChange?.(episodeNumber);
    },
    [onChange],
  );

  const handleSourceClick = useCallback(
    (source: SearchResult) => {
      onSourceChange?.(source.source, source.id, source.title);
    },
    [onSourceChange],
  );

  const currentStart = currentPage * episodesPerPage + 1;
  const currentEnd = Math.min(
    currentStart + episodesPerPage - 1,
    totalEpisodes,
  );

  return (
    <div className='md:ml-2 px-4 py-0 h-full rounded-xl bg-black/10 dark:bg-white/5 flex flex-col border border-white/0 dark:border-white/30 overflow-hidden relative'>
      {/* Tabs */}
      <div className='flex mb-1 -mx-6 shrink-0'>
        {totalEpisodes > 1 && (
          <div
            onClick={() => setActiveTab('episodes')}
            className={`flex-1 py-3 px-6 text-center cursor-pointer transition-all duration-200 font-medium select-none
              ${
                activeTab === 'episodes'
                  ? 'text-green-600 dark:text-green-400'
                  : 'text-gray-700 hover:text-green-600 bg-black/5 dark:bg-white/5 dark:text-gray-300 dark:hover:text-green-400 hover:bg-black/3 dark:hover:bg-white/3'
              }`}
          >
            选集
          </div>
        )}
        <div
          onClick={() => setActiveTab('sources')}
          className={`flex-1 py-3 px-6 text-center cursor-pointer transition-all duration-200 font-medium select-none
            ${
              activeTab === 'sources'
                ? 'text-green-600 dark:text-green-400'
                : 'text-gray-700 hover:text-green-600 bg-black/5 dark:bg-white/5 dark:text-gray-300 dark:hover:text-green-400 hover:bg-black/3 dark:hover:bg-white/3'
            }`}
        >
          换源
        </div>
      </div>

      {/* Episode List Tab */}
      {activeTab === 'episodes' && (
        <>
          {/* Categories */}
          <div className='flex items-center gap-4 mb-4 border-b border-gray-300 dark:border-gray-700 -mx-6 px-6 shrink-0'>
            <div
              className='flex-1 overflow-x-auto scrollbar-hide'
              ref={categoryContainerRef}
            >
              <div className='flex gap-2 min-w-max'>
                {categories.map((label, idx) => {
                  const isActive = idx === displayPage;
                  return (
                    <button
                      key={label}
                      ref={(el) => {
                        buttonRefs.current[idx] = el;
                      }}
                      onClick={() => handleCategoryClick(idx)}
                      className={`w-20 relative py-2 text-sm font-medium transition-colors whitespace-nowrap shrink-0 text-center select-none
                        ${
                          isActive
                            ? 'text-green-500 dark:text-green-400'
                            : 'text-gray-700 hover:text-green-600 dark:text-gray-300 dark:hover:text-green-400'
                        }`}
                    >
                      {label}
                      {isActive && (
                        <div className='absolute bottom-0 left-0 right-0 h-0.5 bg-green-500 dark:bg-green-400' />
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
            {/* Sort Toggle */}
            <button
              className='shrink-0 w-8 h-8 rounded-md flex items-center justify-center text-gray-700 hover:text-green-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:text-green-400 dark:hover:bg-white/20 transition-colors transform translate-y-[-4px]'
              onClick={() => setDescending((prev) => !prev)}
            >
              <svg
                className='w-4 h-4'
                fill='none'
                stroke='currentColor'
                viewBox='0 0 24 24'
              >
                <path
                  strokeLinecap='round'
                  strokeLinejoin='round'
                  strokeWidth='2'
                  d='M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4'
                />
              </svg>
            </button>
          </div>

          {/* Grid */}
          <div className='flex flex-wrap gap-3 overflow-y-auto flex-1 content-start pb-4 min-h-0'>
            {(() => {
              const len = currentEnd - currentStart + 1;
              const episodes = Array.from({ length: len }, (_, i) =>
                descending ? currentEnd - i : currentStart + i,
              );
              return episodes;
            })().map((episodeNumber) => {
              const isActive = episodeNumber === optimisticValue;
              const title = episodes_titles?.[episodeNumber - 1];

              let displayText = String(episodeNumber);
              if (title) {
                const match = title.match(/(?:第)?(\d+)(?:集|话)/);
                if (match) displayText = match[1];
                else displayText = title;
              }

              return (
                <button
                  key={episodeNumber}
                  onClick={() => handleEpisodeClick(episodeNumber)}
                  className={`h-10 min-w-10 px-3 py-2 flex items-center justify-center text-sm font-medium rounded-md transition-all duration-200 whitespace-nowrap font-mono select-none
                    ${
                      isActive
                        ? 'bg-green-500 text-white shadow-lg shadow-green-500/25 dark:bg-green-600 scale-105'
                        : 'bg-gray-200 text-gray-700 hover:bg-gray-300 hover:scale-105 active:scale-95 dark:bg-white/10 dark:text-gray-300 dark:hover:bg-white/20'
                    }`}
                >
                  {displayText}
                </button>
              );
            })}
          </div>
        </>
      )}

      {/* Source List Tab */}
      {activeTab === 'sources' && (
        <div className='flex flex-col h-full mt-4 min-h-0'>
          {sourceSearchLoading && (
            <div className='flex items-center justify-center py-8'>
              <div className='animate-spin rounded-full h-8 w-8 border-b-2 border-green-500'></div>
              <span className='ml-2 text-sm text-gray-600 dark:text-gray-300'>
                搜索中...
              </span>
            </div>
          )}

          {sourceSearchError && (
            <div className='flex items-center justify-center py-8'>
              <div className='text-center'>
                <div className='text-red-500 text-2xl mb-2'>⚠️</div>
                <p className='text-sm text-red-600 dark:text-red-400'>
                  {sourceSearchError}
                </p>
              </div>
            </div>
          )}

          {!sourceSearchLoading &&
            !sourceSearchError &&
            availableSources.length === 0 && (
              <div className='flex items-center justify-center py-8'>
                <div className='text-center'>
                  <div className='text-gray-400 text-2xl mb-2'>📺</div>
                  <p className='text-sm text-gray-600 dark:text-gray-300'>
                    暂无可用的换源
                  </p>
                </div>
              </div>
            )}

          {!sourceSearchLoading &&
            !sourceSearchError &&
            availableSources.length > 0 && (
              <div className='flex-1 overflow-y-auto space-y-2 pb-20 pr-1'>
                {sortedSources.map((source, index) => {
                  const isCurrentSource =
                    source.source?.toString() === currentSource?.toString() &&
                    source.id?.toString() === currentId?.toString();
                  const sourceKey = `${source.source}-${source.id}`;
                  const videoInfo = videoInfoMap.get(sourceKey);

                  return (
                    <div
                      key={sourceKey}
                      onClick={() =>
                        !isCurrentSource && handleSourceClick(source)
                      }
                      className={`flex items-start gap-3 px-2 py-3 rounded-lg transition-all select-none duration-200 relative
                          ${
                            isCurrentSource
                              ? 'bg-green-500/10 dark:bg-green-500/20 border-green-500/30 border'
                              : 'hover:bg-gray-200/50 dark:hover:bg-white/10 hover:scale-[1.02] cursor-pointer'
                          }`}
                    >
                      {/* Poster - Correct Aspect Ratio & Logic */}
                      <div className='shrink-0 w-12 aspect-2/3 bg-gray-300 dark:bg-gray-600 rounded overflow-hidden relative'>
                        {!!source.poster && (
                          <img
                            src={processImageUrl(source.poster)}
                            alt={source.title}
                            loading='lazy'
                            className='w-full h-full object-cover object-center'
                            onError={(e) => {
                              (e.target as HTMLImageElement).style.display =
                                'none';
                            }}
                          />
                        )}
                      </div>

                      {/* Info */}
                      <div className='flex-1 min-w-0 flex flex-col justify-between h-20'>
                        <div className='flex items-start justify-between gap-3 h-6'>
                          <div className='flex-1 min-w-0 relative group/title'>
                            <h3 className='font-medium text-base truncate text-gray-900 dark:text-gray-100 leading-none'>
                              {source.title}
                            </h3>
                            {index !== 0 && (
                              <div className='absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 px-3 py-1 bg-gray-800 text-white text-xs rounded-md shadow-lg opacity-0 invisible group-hover/title:opacity-100 group-hover/title:visible transition-all duration-200 z-50 pointer-events-none whitespace-nowrap'>
                                {source.title}
                                <div className='absolute top-full left-1/2 transform -translate-x-1/2 w-0 h-0 border-l-4 border-r-4 border-t-4 border-transparent border-t-gray-800'></div>
                              </div>
                            )}
                          </div>

                          {/* Quality Tags */}
                          {videoInfo &&
                            !videoInfo.hasError &&
                            videoInfo.quality !== '未知' &&
                            videoInfo.quality !== 'Unknown' && (
                              <div
                                className={`bg-gray-500/10 dark:bg-gray-400/20 px-1.5 py-0 rounded text-xs shrink-0 min-w-[50px] text-center
                                ${
                                  ['4K', '2K'].includes(videoInfo.quality)
                                    ? 'text-purple-600 dark:text-purple-400'
                                    : ['1080p', '720p'].includes(
                                          videoInfo.quality,
                                        )
                                      ? 'text-green-600 dark:text-green-400'
                                      : 'text-yellow-600 dark:text-yellow-400'
                                }`}
                              >
                                {videoInfo.quality}
                              </div>
                            )}
                          {videoInfo && videoInfo.hasError && (
                            <div className='bg-gray-500/10 dark:bg-gray-400/20 text-red-600 dark:text-red-400 px-1.5 py-0 rounded text-xs shrink-0 min-w-[50px] text-center'>
                              失败
                            </div>
                          )}
                        </div>

                        <div className='flex items-center justify-between'>
                          <span className='text-xs px-2 py-1 border border-gray-500/60 rounded text-gray-700 dark:text-gray-300'>
                            {source.source_name}
                          </span>
                          {source.episodes.length > 1 && (
                            <span className='text-xs text-gray-500 dark:text-gray-400 font-medium'>
                              {source.episodes.length} 集
                            </span>
                          )}
                        </div>

                        <div className='flex items-end h-6'>
                          {videoInfo && !videoInfo.hasError ? (
                            <div className='flex items-end gap-3 text-xs'>
                              <span className='text-green-600 dark:text-green-400 font-medium'>
                                {videoInfo.loadSpeed}
                              </span>
                              <span className='text-orange-600 dark:text-orange-400 font-medium'>
                                {videoInfo.pingTime}ms
                              </span>
                            </div>
                          ) : (
                            <div className='text-red-500/90 dark:text-red-400 font-medium text-xs opacity-0'>
                              .
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}

                <div className='shrink-0 mt-auto pt-2 border-t border-gray-400 dark:border-gray-700'>
                  <button
                    onClick={() =>
                      videoTitle &&
                      router.push(`/search?q=${encodeURIComponent(videoTitle)}`)
                    }
                    className='w-full text-center text-xs text-gray-500 dark:text-gray-400 hover:text-green-500 dark:hover:text-green-400 transition-colors py-2'
                  >
                    影片匹配有误？点击去搜索
                  </button>
                </div>
              </div>
            )}
        </div>
      )}
    </div>
  );
};

export default EpisodeSelector;
