/* eslint-disable react-hooks/exhaustive-deps, @typescript-eslint/no-explicit-any, no-empty */
'use client';

import { ChevronUp, Search, ShieldAlert, X } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import React, {
  startTransition,
  Suspense,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import {
  addSearchHistory,
  clearSearchHistory,
  deleteSearchHistory,
  getSearchHistory,
  subscribeToDataUpdates,
} from '@/lib/db.client';
import { SearchResult } from '@/lib/types';

import PageLayout from '@/components/PageLayout';
import SearchResultFilter, {
  SearchFilterCategory,
} from '@/components/SearchResultFilter';
import SearchSuggestions from '@/components/SearchSuggestions';
import VideoCard, { VideoCardHandle } from '@/components/VideoCard';

function SearchPageClient() {
  // --- STATE ---
  const [searchHistory, setSearchHistory] = useState<string[]>([]);
  const [showBackToTop, setShowBackToTop] = useState(false);

  const router = useRouter();
  const searchParams = useSearchParams();

  // Search State
  const currentQueryRef = useRef<string>(''); // Source of Truth for "Current Active Query"
  const lastHistoryRef = useRef<string>(''); // Prevents duplicate history writes
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [isBlocked, setIsBlocked] = useState(false);

  // Streaming State
  const eventSourceRef = useRef<EventSource | null>(null);
  const [totalSources, setTotalSources] = useState(0);
  const [completedSources, setCompletedSources] = useState(0);
  const pendingResultsRef = useRef<SearchResult[]>([]);
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [useFluidSearch, setUseFluidSearch] = useState(true);

  // Refs for aggregation updates
  const groupRefs = useRef<
    Map<string, React.RefObject<VideoCardHandle | null>>
  >(new Map());
  const groupStatsRef = useRef<
    Map<
      string,
      { douban_id?: number; episodes?: number; source_names: string[] }
    >
  >(new Map());

  // --- FILTER & VIEW STATE ---
  const [viewMode, setViewMode] = useState<'agg' | 'all'>(() => {
    if (typeof window === 'undefined') return 'agg';
    try {
      const raw = localStorage.getItem('defaultAggregateSearch');
      const isAgg = raw === null ? true : Boolean(JSON.parse(raw));
      return isAgg ? 'agg' : 'all';
    } catch {
      return 'agg';
    }
  });

  const [filterAll, setFilterAll] = useState({
    source: 'all',
    title: 'all',
    year: 'all',
    yearOrder: 'none' as 'none' | 'asc' | 'desc',
  });
  const [filterAgg, setFilterAgg] = useState({
    source: 'all',
    title: 'all',
    year: 'all',
    yearOrder: 'none' as 'none' | 'asc' | 'desc',
  });

  // --- MIRROR REFS (Fixes Stale Closures in SSE) ---
  const viewModeRef = useRef(viewMode);
  const filterAggRef = useRef(filterAgg);
  const filterAllRef = useRef(filterAll);
  const totalSourcesRef = useRef(totalSources);

  useEffect(() => {
    viewModeRef.current = viewMode;
  }, [viewMode]);
  useEffect(() => {
    filterAggRef.current = filterAgg;
  }, [filterAgg]);
  useEffect(() => {
    filterAllRef.current = filterAll;
  }, [filterAll]);
  useEffect(() => {
    totalSourcesRef.current = totalSources;
  }, [totalSources]);

  // --- HELPERS ---

  const safeKeyGen = (item: SearchResult) => {
    const title = (item.title ?? '').replace(/\s+/g, '');
    const year = item.year || 'unknown';
    const epLen = Array.isArray(item.episodes) ? item.episodes.length : 0;
    const type = epLen === 1 ? 'movie' : 'tv';
    return `${title}-${year}-${type}`;
  };

  const getGroupRef = (key: string) => {
    let ref = groupRefs.current.get(key);
    if (!ref) {
      ref = React.createRef<VideoCardHandle | null>();
      groupRefs.current.set(key, ref);
    }
    return ref;
  };

  const computeGroupStats = (group: SearchResult[]) => {
    const episodes = (() => {
      const countMap = new Map<number, number>();
      group.forEach((g) => {
        const len = Array.isArray(g.episodes) ? g.episodes.length : 0;
        if (len > 0) countMap.set(len, (countMap.get(len) || 0) + 1);
      });
      let max = 0;
      let res = 0;
      countMap.forEach((v, k) => {
        if (v > max) {
          max = v;
          res = k;
        }
      });
      return res;
    })();
    const source_names = Array.from(
      new Set(group.map((g) => g.source_name).filter(Boolean)),
    ) as string[];
    const douban_id = (() => {
      const countMap = new Map<number, number>();
      group.forEach((g) => {
        if (g.douban_id && g.douban_id > 0)
          countMap.set(g.douban_id, (countMap.get(g.douban_id) || 0) + 1);
      });
      let max = 0;
      let res: number | undefined;
      countMap.forEach((v, k) => {
        if (v > max) {
          max = v;
          res = k;
        }
      });
      return res;
    })();
    return { episodes, source_names, douban_id };
  };

  // Safe Year Parsing
  const toYearNum = (y: string) => {
    const n = parseInt(String(y), 10);
    return Number.isFinite(n) ? n : null;
  };

  const sortBatchForNoOrder = (items: SearchResult[]) => {
    const q = currentQueryRef.current.trim();
    return items.slice().sort((a, b) => {
      const aExact = (a.title || '').trim() === q;
      const bExact = (b.title || '').trim() === q;
      if (aExact && !bExact) return -1;
      if (!aExact && bExact) return 1;

      const aNum = toYearNum(a.year);
      const bNum = toYearNum(b.year);
      if (aNum === null && bNum === null) return 0;
      if (aNum === null) return 1;
      if (bNum === null) return -1;
      return bNum - aNum;
    });
  };

  const compareYear = (
    aYear: string,
    bYear: string,
    order: 'none' | 'asc' | 'desc',
  ) => {
    if (order === 'none') return 0;
    const aEmpty = !aYear || aYear === 'unknown';
    const bEmpty = !bYear || bYear === 'unknown';
    if (aEmpty && bEmpty) return 0;
    if (aEmpty) return 1;
    if (bEmpty) return -1;

    const aNum = toYearNum(aYear);
    const bNum = toYearNum(bYear);
    if (aNum === null && bNum === null) return 0;
    if (aNum === null) return 1;
    if (bNum === null) return -1;

    return order === 'asc' ? aNum - bNum : bNum - aNum;
  };

  // --- MEMOIZED CALCULATIONS ---

  const aggregatedResults = useMemo(() => {
    const map = new Map<string, SearchResult[]>();
    const keyOrder: string[] = [];
    searchResults.forEach((item) => {
      const key = safeKeyGen(item);
      const arr = map.get(key) || [];
      if (arr.length === 0) keyOrder.push(key);
      arr.push(item);
      map.set(key, arr);
    });
    return keyOrder.map(
      (key) => [key, map.get(key)!] as [string, SearchResult[]],
    );
  }, [searchResults]);

  useEffect(() => {
    aggregatedResults.forEach(([mapKey, group]) => {
      const stats = computeGroupStats(group);
      const prev = groupStatsRef.current.get(mapKey);
      if (!prev) {
        groupStatsRef.current.set(mapKey, stats);
        return;
      }
      const ref = groupRefs.current.get(mapKey);
      if (ref && ref.current) {
        if (prev.episodes !== stats.episodes)
          ref.current.setEpisodes(stats.episodes);
        const prevNames = (prev.source_names || []).join('|');
        const nextNames = (stats.source_names || []).join('|');
        if (prevNames !== nextNames)
          ref.current.setSourceNames(stats.source_names);
        if (prev.douban_id !== stats.douban_id)
          ref.current.setDoubanId(stats.douban_id);
        groupStatsRef.current.set(mapKey, stats);
      }
    });
  }, [aggregatedResults]);

  const filterOptions = useMemo(() => {
    const sourcesSet = new Map<string, string>();
    const titlesSet = new Set<string>();
    const yearsSet = new Set<string>();

    searchResults.forEach((item) => {
      if (item.source && item.source_name)
        sourcesSet.set(item.source, item.source_name);
      if (item.title) titlesSet.add(item.title);
      if (item.year) yearsSet.add(item.year);
    });

    const sourceOptions = [
      { label: '全部来源', value: 'all' },
      ...Array.from(sourcesSet.entries())
        .sort((a, b) => a[1].localeCompare(b[1]))
        .map(([value, label]) => ({ label, value })),
    ];
    const titleOptions = [
      { label: '全部标题', value: 'all' },
      ...Array.from(titlesSet.values())
        .sort((a, b) => a.localeCompare(b))
        .map((t) => ({ label: t, value: t })),
    ];
    const years = Array.from(yearsSet.values());
    const knownYears = years
      .filter((y) => y !== 'unknown')
      .sort(
        (a, b) => (toYearNum(b) ?? -Infinity) - (toYearNum(a) ?? -Infinity),
      );

    const yearOptions = [
      { label: '全部年份', value: 'all' },
      ...knownYears.map((y) => ({ label: y, value: y })),
      ...(years.includes('unknown')
        ? [{ label: '未知', value: 'unknown' }]
        : []),
    ];

    const cats: SearchFilterCategory[] = [
      { key: 'source', label: '来源', options: sourceOptions },
      { key: 'title', label: '标题', options: titleOptions },
      { key: 'year', label: '年份', options: yearOptions },
    ];
    return { categoriesAll: cats, categoriesAgg: cats };
  }, [searchResults]);

  const filteredAllResults = useMemo(() => {
    const { source, title, year, yearOrder } = filterAll;
    const filtered = searchResults.filter((item) => {
      if (source !== 'all' && item.source !== source) return false;
      if (title !== 'all' && item.title !== title) return false;
      if (year !== 'all' && item.year !== year) return false;
      return true;
    });

    if (yearOrder === 'none') return filtered;

    const q = currentQueryRef.current.trim();
    return filtered.sort((a, b) => {
      const yearComp = compareYear(a.year, b.year, yearOrder);
      if (yearComp !== 0) return yearComp;
      const aExactMatch = a.title === q;
      const bExactMatch = b.title === q;
      if (aExactMatch && !bExactMatch) return -1;
      if (!aExactMatch && bExactMatch) return 1;
      return yearOrder === 'asc'
        ? a.title.localeCompare(b.title)
        : b.title.localeCompare(a.title);
    });
  }, [searchResults, filterAll]);

  const filteredAggResults = useMemo(() => {
    const { source, title, year, yearOrder } = filterAgg;
    const filtered = aggregatedResults.filter(([_, group]) => {
      const gTitle = group[0]?.title ?? '';
      const gYear = group[0]?.year ?? 'unknown';
      const hasSource =
        source === 'all' ? true : group.some((item) => item.source === source);
      if (!hasSource) return false;
      if (title !== 'all' && gTitle !== title) return false;
      if (year !== 'all' && gYear !== year) return false;
      return true;
    });

    if (yearOrder === 'none') return filtered;

    const q = currentQueryRef.current.trim();
    return filtered.sort((a, b) => {
      const aYear = a[1][0].year;
      const bYear = b[1][0].year;
      const yearComp = compareYear(aYear, bYear, yearOrder);
      if (yearComp !== 0) return yearComp;
      const aExactMatch = a[1][0].title === q;
      const bExactMatch = b[1][0].title === q;
      if (aExactMatch && !bExactMatch) return -1;
      if (!aExactMatch && bExactMatch) return 1;
      const aTitle = a[1][0].title;
      const bTitle = b[1][0].title;
      return yearOrder === 'asc'
        ? aTitle.localeCompare(bTitle)
        : bTitle.localeCompare(aTitle);
    });
  }, [aggregatedResults, filterAgg]);

  // --- EFFECTS ---

  useEffect(() => {
    const query = searchParams.get('q') || '';
    const trimmed = query.trim();
    currentQueryRef.current = trimmed;

    // Reset State
    if (trimmed) {
      setSearchQuery(trimmed);

      // Close previous global ref if exists
      if (eventSourceRef.current) {
        try {
          eventSourceRef.current.close();
        } catch {}
        eventSourceRef.current = null;
      }

      setSearchResults([]);
      setTotalSources(0);
      setCompletedSources(0);
      setIsBlocked(false);
      pendingResultsRef.current = [];
      if (flushTimerRef.current) {
        clearTimeout(flushTimerRef.current);
        flushTimerRef.current = null;
      }
      groupRefs.current.clear();
      groupStatsRef.current.clear();
      setIsLoading(true);
      setShowResults(true);

      let currentFluidSearch = useFluidSearch;
      if (typeof window !== 'undefined') {
        const saved = localStorage.getItem('fluidSearch');
        if (saved !== null) {
          currentFluidSearch = JSON.parse(saved);
        } else {
          currentFluidSearch =
            (window as any).RUNTIME_CONFIG?.FLUID_SEARCH !== false;
        }
      }
      if (currentFluidSearch !== useFluidSearch)
        setUseFluidSearch(currentFluidSearch);

      const abortController = new AbortController();
      let es: EventSource | null = null;

      if (currentFluidSearch) {
        // --- SSE MODE ---
        es = new EventSource(`/api/search/ws?q=${encodeURIComponent(trimmed)}`);
        eventSourceRef.current = es;

        es.onmessage = (event) => {
          if (!event.data) return;
          try {
            const payload = JSON.parse(event.data);
            if (currentQueryRef.current !== trimmed) return;

            switch (payload.type) {
              case 'start':
                setTotalSources(payload.totalSources || 0);
                setCompletedSources(0);
                break;

              case 'blocked': {
                setIsBlocked(true);
                setIsLoading(false);
                setTotalSources(0);
                setCompletedSources(0);
                pendingResultsRef.current = [];
                if (flushTimerRef.current) {
                  clearTimeout(flushTimerRef.current);
                  flushTimerRef.current = null;
                }
                try {
                  es?.close();
                } catch {}
                if (eventSourceRef.current === es)
                  eventSourceRef.current = null;
                break;
              }

              case 'source_result': {
                setCompletedSources((prev) => prev + 1);
                if (
                  Array.isArray(payload.results) &&
                  payload.results.length > 0
                ) {
                  const activeYearOrder =
                    viewModeRef.current === 'agg'
                      ? filterAggRef.current.yearOrder
                      : filterAllRef.current.yearOrder;

                  const incoming =
                    activeYearOrder === 'none'
                      ? sortBatchForNoOrder(payload.results)
                      : payload.results;

                  pendingResultsRef.current.push(...incoming);

                  if (!flushTimerRef.current) {
                    flushTimerRef.current = setTimeout(() => {
                      const toAppend = pendingResultsRef.current;
                      pendingResultsRef.current = [];
                      startTransition(() => {
                        setSearchResults((prev) => prev.concat(toAppend));
                      });
                      flushTimerRef.current = null;
                    }, 80);
                  }
                }
                break;
              }

              case 'source_error':
                setCompletedSources((prev) => prev + 1);
                break;

              case 'complete':
                setCompletedSources(
                  payload.completedSources || totalSourcesRef.current,
                );
                if (pendingResultsRef.current.length > 0) {
                  const toAppend = pendingResultsRef.current;
                  pendingResultsRef.current = [];
                  if (flushTimerRef.current) {
                    clearTimeout(flushTimerRef.current);
                    flushTimerRef.current = null;
                  }
                  startTransition(() => {
                    setSearchResults((prev) => prev.concat(toAppend));
                  });
                }
                setIsLoading(false);
                try {
                  es?.close();
                } catch {}
                if (eventSourceRef.current === es)
                  eventSourceRef.current = null;
                break;
            }
          } catch {}
        };

        es.onerror = () => {
          setIsLoading(false);
          if (pendingResultsRef.current.length > 0) {
            const toAppend = pendingResultsRef.current;
            pendingResultsRef.current = [];
            startTransition(() => setSearchResults((p) => p.concat(toAppend)));
          }
          if (flushTimerRef.current) {
            clearTimeout(flushTimerRef.current);
            flushTimerRef.current = null;
          }
          try {
            es?.close();
          } catch {}
          if (eventSourceRef.current === es) eventSourceRef.current = null;
        };
      } else {
        // --- FETCH MODE ---
        fetch(`/api/search?q=${encodeURIComponent(trimmed)}`, {
          signal: abortController.signal,
        })
          .then((response) => response.json())
          .then((data) => {
            if (abortController.signal.aborted) return;
            if (currentQueryRef.current !== trimmed) return;

            if (data.blocked) {
              setIsBlocked(true);
              setSearchResults([]);
              setIsLoading(false);
              return;
            }

            if (data.results && Array.isArray(data.results)) {
              const activeYearOrder =
                viewModeRef.current === 'agg'
                  ? filterAggRef.current.yearOrder
                  : filterAllRef.current.yearOrder;
              const results =
                activeYearOrder === 'none'
                  ? sortBatchForNoOrder(data.results)
                  : data.results;
              setSearchResults(results);
              setTotalSources(1);
              setCompletedSources(1);
            }
            setIsLoading(false);
          })
          .catch((err) => {
            if (err.name !== 'AbortError') setIsLoading(false);
          });
      }

      setShowSuggestions(false);

      // History Deduplication
      if (trimmed !== lastHistoryRef.current) {
        lastHistoryRef.current = trimmed;
        addSearchHistory(trimmed);
      }

      return () => {
        abortController.abort();
        if (flushTimerRef.current) {
          clearTimeout(flushTimerRef.current);
          flushTimerRef.current = null;
        }
        pendingResultsRef.current = [];
        if (es) {
          try {
            es.close();
          } catch {}
          if (eventSourceRef.current === es) eventSourceRef.current = null;
        }
      };
    } else {
      lastHistoryRef.current = '';
      setShowResults(false);
      setShowSuggestions(false);
    }
  }, [searchParams]);

  useEffect(() => {
    return () => {
      if (eventSourceRef.current) {
        try {
          eventSourceRef.current.close();
        } catch {}
        eventSourceRef.current = null;
      }
      if (flushTimerRef.current) clearTimeout(flushTimerRef.current);
      pendingResultsRef.current = [];
    };
  }, []);

  // --- EVENTS ---

  useEffect(() => {
    let ticking = false;
    const handleScroll = () => {
      if (!ticking) {
        window.requestAnimationFrame(() => {
          const scrollTop =
            document.scrollingElement?.scrollTop ||
            document.documentElement?.scrollTop ||
            document.body?.scrollTop ||
            0;
          setShowBackToTop(scrollTop > 300);
          ticking = false;
        });
        ticking = true;
      }
    };
    window.addEventListener('scroll', handleScroll, { passive: true });
    handleScroll();
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  useEffect(() => {
    if (!searchParams.get('q')) document.getElementById('searchInput')?.focus();
    getSearchHistory().then(setSearchHistory);
    const unsubscribe = subscribeToDataUpdates(
      'searchHistoryUpdated',
      setSearchHistory,
    );
    return () => unsubscribe();
  }, []);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setSearchQuery(value);
    setShowSuggestions(!!value.trim());
  };

  const handleInputFocus = () => {
    if (searchQuery.trim()) setShowSuggestions(true);
  };

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = searchQuery.trim().replace(/\s+/g, ' ');
    if (!trimmed) return;
    setSearchQuery(trimmed);
    setIsLoading(true);
    setShowResults(true);
    setShowSuggestions(false);
    router.push(`/search?q=${encodeURIComponent(trimmed)}`);
  };

  const handleSuggestionSelect = (suggestion: string) => {
    setSearchQuery(suggestion);
    setShowSuggestions(false);
    setIsLoading(true);
    setShowResults(true);
    router.push(`/search?q=${encodeURIComponent(suggestion)}`);
  };

  const scrollToTop = () => {
    const el =
      document.scrollingElement || document.documentElement || document.body;
    el.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // --- RENDER ---
  const activeQuery = currentQueryRef.current.trim();

  return (
    <PageLayout activePath='/search'>
      <div className='px-4 sm:px-10 py-4 sm:py-8 overflow-visible mb-10'>
        <div className='mb-8'>
          <form onSubmit={handleSearch} className='max-w-2xl mx-auto'>
            <div className='relative'>
              <Search className='absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-gray-400 dark:text-gray-500' />
              <input
                id='searchInput'
                type='text'
                value={searchQuery}
                onChange={handleInputChange}
                onFocus={handleInputFocus}
                placeholder='搜索电影、电视剧...'
                autoComplete='off'
                className='w-full h-12 rounded-lg bg-gray-50/80 py-3 pl-10 pr-12 text-sm text-gray-700 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-green-400 focus:bg-white border border-gray-200/50 shadow-sm dark:bg-gray-800 dark:text-gray-300 dark:placeholder-gray-500 dark:focus:bg-gray-700 dark:border-gray-700'
              />
              {searchQuery && (
                <button
                  type='button'
                  onClick={() => {
                    setSearchQuery('');
                    setShowSuggestions(false);
                    document.getElementById('searchInput')?.focus();
                  }}
                  className='absolute right-3 top-1/2 h-5 w-5 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors dark:text-gray-500 dark:hover:text-gray-300'
                >
                  <X className='h-5 w-5' />
                </button>
              )}
              <SearchSuggestions
                query={searchQuery}
                isVisible={showSuggestions}
                onSelect={handleSuggestionSelect}
                onClose={() => setShowSuggestions(false)}
                onEnterKey={() => {
                  const trimmed = searchQuery.trim().replace(/\s+/g, ' ');
                  if (!trimmed) return;
                  setSearchQuery(trimmed);
                  setIsLoading(true);
                  setShowResults(true);
                  setShowSuggestions(false);
                  router.push(`/search?q=${encodeURIComponent(trimmed)}`);
                }}
              />
            </div>
          </form>
        </div>

        <div className='max-w-[95%] mx-auto mt-12 overflow-visible'>
          {showResults ? (
            <section className='mb-12'>
              <div className='mb-4'>
                <h2 className='text-xl font-bold text-gray-800 dark:text-gray-200'>
                  搜索结果
                  {totalSources > 0 && useFluidSearch && (
                    <span className='ml-2 text-sm font-normal text-gray-500 dark:text-gray-400'>
                      {completedSources}/{totalSources}
                    </span>
                  )}
                  {isLoading && useFluidSearch && !isBlocked && (
                    <span className='ml-2 inline-block align-middle'>
                      <span className='inline-block h-3 w-3 border-2 border-gray-300 border-t-green-500 rounded-full animate-spin'></span>
                    </span>
                  )}
                </h2>
              </div>

              <div className='mb-8 flex items-center justify-between gap-3'>
                <div className='flex-1 min-w-0'>
                  {viewMode === 'agg' ? (
                    <SearchResultFilter
                      categories={filterOptions.categoriesAgg}
                      values={filterAgg}
                      onChange={(v) => setFilterAgg(v as any)}
                    />
                  ) : (
                    <SearchResultFilter
                      categories={filterOptions.categoriesAll}
                      values={filterAll}
                      onChange={(v) => setFilterAll(v as any)}
                    />
                  )}
                </div>
                <label className='flex items-center gap-2 cursor-pointer select-none shrink-0'>
                  <span className='text-xs sm:text-sm text-gray-700 dark:text-gray-300'>
                    聚合
                  </span>
                  <div className='relative'>
                    <input
                      type='checkbox'
                      className='sr-only peer'
                      checked={viewMode === 'agg'}
                      onChange={() =>
                        setViewMode(viewMode === 'agg' ? 'all' : 'agg')
                      }
                    />
                    <div className='w-9 h-5 bg-gray-300 rounded-full peer-checked:bg-green-500 transition-colors dark:bg-gray-600'></div>
                    <div className='absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full transition-transform peer-checked:translate-x-4'></div>
                  </div>
                </label>
              </div>

              {isBlocked ? (
                <div className='text-center py-10'>
                  <div className='inline-flex items-center justify-center w-16 h-16 rounded-full bg-gray-100 dark:bg-gray-800 mb-4'>
                    <ShieldAlert className='w-8 h-8 text-gray-500' />
                  </div>
                  <h3 className='text-lg font-medium text-gray-900 dark:text-gray-100'>
                    搜索结果已隐藏
                  </h3>
                  <p className='mt-2 text-gray-500 dark:text-gray-400 max-w-sm mx-auto'>
                    该搜索词包含受限内容，请尝试其他关键词。
                  </p>
                </div>
              ) : searchResults.length === 0 ? (
                isLoading ? (
                  <div className='flex justify-center items-center h-40'>
                    <div className='animate-spin rounded-full h-8 w-8 border-b-2 border-green-500'></div>
                  </div>
                ) : (
                  <div className='text-center text-gray-500 py-8 dark:text-gray-400'>
                    未找到相关结果
                  </div>
                )
              ) : (
                <div
                  key={`search-results-${viewMode}`}
                  className='justify-start grid grid-cols-3 gap-x-2 gap-y-14 sm:gap-y-20 px-0 sm:px-2 sm:grid-cols-[repeat(auto-fill,minmax(11rem,1fr))] sm:gap-x-8'
                >
                  {viewMode === 'agg'
                    ? filteredAggResults.map(([mapKey, group]) => {
                        const title = group[0]?.title || '';
                        const poster = group[0]?.poster || '';
                        const year = group[0]?.year || 'unknown';
                        const { episodes, source_names, douban_id } =
                          computeGroupStats(group);
                        const type = episodes === 1 ? 'movie' : 'tv';

                        if (!groupStatsRef.current.has(mapKey)) {
                          groupStatsRef.current.set(mapKey, {
                            episodes,
                            source_names,
                            douban_id,
                          });
                        }

                        return (
                          <div key={`agg-${mapKey}`} className='w-full'>
                            <VideoCard
                              ref={getGroupRef(mapKey)}
                              from='search'
                              isAggregate={true}
                              title={title}
                              poster={poster}
                              year={year}
                              episodes={episodes}
                              source_names={source_names}
                              douban_id={douban_id}
                              query={
                                activeQuery && activeQuery !== title
                                  ? activeQuery
                                  : ''
                              }
                              type={type}
                            />
                          </div>
                        );
                      })
                    : filteredAllResults.map((item) => {
                        const epLen = Array.isArray(item.episodes)
                          ? item.episodes.length
                          : 0;
                        return (
                          <div
                            key={`all-${item.source}-${item.id}`}
                            className='w-full'
                          >
                            <VideoCard
                              id={item.id}
                              title={item.title}
                              poster={item.poster}
                              episodes={epLen}
                              source={item.source}
                              source_name={item.source_name}
                              douban_id={item.douban_id}
                              query={
                                activeQuery && activeQuery !== item.title
                                  ? activeQuery
                                  : ''
                              }
                              year={item.year}
                              from='search'
                              type={epLen > 1 ? 'tv' : 'movie'}
                            />
                          </div>
                        );
                      })}
                </div>
              )}
            </section>
          ) : searchHistory.length > 0 ? (
            <section className='mb-12'>
              <h2 className='mb-4 text-xl font-bold text-gray-800 text-left dark:text-gray-200'>
                搜索历史
                {searchHistory.length > 0 && (
                  <button
                    onClick={() => clearSearchHistory()}
                    className='ml-3 text-sm text-gray-500 hover:text-red-500 transition-colors dark:text-gray-400 dark:hover:text-red-500'
                  >
                    清空
                  </button>
                )}
              </h2>
              <div className='flex flex-wrap gap-2'>
                {searchHistory.map((item) => (
                  <div key={item} className='relative group'>
                    <button
                      onClick={() => {
                        setSearchQuery(item);
                        router.push(
                          `/search?q=${encodeURIComponent(item.trim())}`,
                        );
                      }}
                      className='px-4 py-2 bg-gray-500/10 hover:bg-gray-300 rounded-full text-sm text-gray-700 transition-colors duration-200 dark:bg-gray-700/50 dark:hover:bg-gray-600 dark:text-gray-300'
                    >
                      {item}
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        e.preventDefault();
                        deleteSearchHistory(item);
                      }}
                      className='absolute -top-1 -right-1 w-4 h-4 opacity-0 group-hover:opacity-100 bg-gray-400 hover:bg-red-500 text-white rounded-full flex items-center justify-center text-[10px] transition-colors'
                    >
                      <X className='w-3 h-3' />
                    </button>
                  </div>
                ))}
              </div>
            </section>
          ) : null}
        </div>
      </div>

      <button
        onClick={scrollToTop}
        className={`fixed bottom-20 md:bottom-6 right-6 z-50 w-12 h-12 bg-green-500/90 hover:bg-green-500 text-white rounded-full shadow-lg backdrop-blur-sm transition-all duration-300 ease-in-out flex items-center justify-center group ${showBackToTop ? 'opacity-100 translate-y-0 pointer-events-auto' : 'opacity-0 translate-y-4 pointer-events-none'}`}
      >
        <ChevronUp className='w-6 h-6 transition-transform group-hover:scale-110' />
      </button>
    </PageLayout>
  );
}

export default function SearchPage() {
  return (
    <Suspense>
      <SearchPageClient />
    </Suspense>
  );
}
