/* eslint-disable @typescript-eslint/no-explicit-any, react-hooks/exhaustive-deps, @next/next/no-img-element */

'use client';

import { Heart } from 'lucide-react';
import dynamic from 'next/dynamic';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import Player from 'video.js/dist/types/player';
import 'videojs-mobile-ui';

import {
  deleteFavorite,
  deletePlayRecord,
  deleteSkipConfig,
  generateStorageKey,
  getAllPlayRecords,
  getSkipConfig,
  isFavorited,
  saveFavorite,
  savePlayRecord,
  saveSkipConfig,
  subscribeToDataUpdates,
} from '@/lib/db.client';
import { SearchResult } from '@/lib/types';
import { getVideoResolutionFromM3u8, processImageUrl } from '@/lib/utils';

import EpisodeSelector from '@/components/EpisodeSelector';
import { useLanguage } from '@/components/LanguageProvider';
import PageLayout from '@/components/PageLayout';
import { ScrollableDescription } from '@/components/ScrollableDescription';
import { useSeasonalEffects } from '@/components/SeasonalEffectsProvider';

const VideoJsPlayer = dynamic(() => import('@/components/VideoJsPlayer'), {
  ssr: false,
}) as any;

// -----------------------------------------------------------------------------
// 类型定义
// -----------------------------------------------------------------------------

declare global {
  interface HTMLVideoElement {
    hls?: any;
  }
}

interface WakeLockSentinel {
  released: boolean;
  release(): Promise<void>;
  addEventListener(type: 'release', listener: () => void): void;
  removeEventListener(type: 'release', listener: () => void): void;
}

// -----------------------------------------------------------------------------
// 广告过滤 & 自定义 Loader
// -----------------------------------------------------------------------------

function filterAdsFromM3U8(m3u8Content: string): string {
  if (!m3u8Content) return '';

  const lines = m3u8Content.split('\n');
  const filteredLines: string[] = [];

  const adKeywords = [
    '/ad/',
    '_ad',
    'ad_',
    'guanggao',
    'xx_ad',
    'cl_ad',
    'udp_ad',
    '.png',
    '.jpg',
    '.jpeg',
    '.gif',
    'logo.ts',
    'image.ts',
    'intro.ts',
    'kaitou',
    'jiewei',
  ];

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    if (line.startsWith('#EXTINF:')) {
      let nextIdx = i + 1;
      let urlLine = '';

      while (nextIdx < lines.length) {
        const nextLine = lines[nextIdx].trim();
        if (nextLine !== '' && !nextLine.startsWith('#')) {
          urlLine = nextLine;
          break;
        }
        if (nextLine.startsWith('#EXT-X-ENDLIST')) break;
        nextIdx++;
      }

      if (urlLine) {
        const isAd = adKeywords.some((kw) =>
          urlLine.toLowerCase().includes(kw),
        );
        if (isAd) {
          i = nextIdx + 1;
          continue;
        }
      }
    }

    filteredLines.push(line);
    i++;
  }

  return filteredLines.join('\n');
}

function createCustomHlsJsLoader(HlsClass: any) {
  return class CustomHlsJsLoader extends HlsClass.DefaultConfig.loader {
    constructor(config: any) {
      super(config);
      const load = this.load.bind(this);
      this.load = function (context: any, config: any, callbacks: any) {
        if (
          (context as any).type === 'manifest' ||
          (context as any).type === 'level'
        ) {
          const onSuccess = callbacks.onSuccess;
          callbacks.onSuccess = function (
            response: any,
            stats: any,
            context: any,
          ) {
            if (response.data && typeof response.data === 'string') {
              response.data = filterAdsFromM3U8(response.data);
            }
            return onSuccess(response, stats, context, null);
          };
        }
        load(context, config, callbacks);
      };
    }
  };
}

function getOptimizationEnabledFromStorage(): boolean {
  if (typeof window === 'undefined') return true;
  const raw = localStorage.getItem('enableOptimization');
  if (raw === null) return true;
  try {
    return Boolean(JSON.parse(raw));
  } catch {
    return true;
  }
}

// -----------------------------------------------------------------------------
// 主组件逻辑
// -----------------------------------------------------------------------------

function PlayPageClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { convert } = useLanguage();
  const { setBackgroundImage } = useSeasonalEffects();

  // --- 基础状态 ---
  const [loading, setLoading] = useState(true);
  const [loadingStage, setLoadingStage] = useState<
    'searching' | 'preferring' | 'fetching' | 'ready'
  >('searching');
  const [loadingMessage, setLoadingMessage] = useState('正在搜索播放源...');
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<SearchResult | null>(null);
  const [favorited, setFavorited] = useState(false);

  // --- 配置状态 ---
  const [skipConfig, setSkipConfig] = useState<{
    enable: boolean;
    intro_time: number;
    outro_time: number;
  }>({
    enable: false,
    intro_time: 0,
    outro_time: 0,
  });
  const skipConfigRef = useRef(skipConfig);
  const [blockAdEnabled, setBlockAdEnabled] = useState<boolean>(true);
  const blockAdEnabledRef = useRef(blockAdEnabled);

  const [optimizationEnabled, setOptimizationEnabled] = useState<boolean>(() =>
    getOptimizationEnabledFromStorage(),
  );
  const optimizationEnabledRef = useRef(optimizationEnabled);

  const [debugEnabled, setDebugEnabled] = useState(false);
  const debugEnabledRef = useRef(debugEnabled);

  // --- 视频信息状态 ---
  const [videoTitle, setVideoTitle] = useState(searchParams.get('title') || '');
  const [videoYear, setVideoYear] = useState(searchParams.get('year') || '');
  const [videoCover, setVideoCover] = useState(searchParams.get('cover') || '');
  const [videoDesc, setVideoDesc] = useState(
    searchParams.get('desc') || searchParams.get('videoDesc') || '',
  );
  const [videoDoubanId, setVideoDoubanId] = useState(0);
  const [currentSource, setCurrentSource] = useState(
    searchParams.get('source') || '',
  );
  const [currentId, setCurrentId] = useState(searchParams.get('id') || '');
  const [searchTitle, setSearchTitle] = useState(
    searchParams.get('stitle') || '',
  );
  const [searchType, setSearchType] = useState(searchParams.get('stype') || '');
  const [needPrefer, setNeedPrefer] = useState(
    searchParams.get('prefer') === 'true',
  );
  const [currentEpisodeIndex, setCurrentEpisodeIndex] = useState(0);
  const [videoUrl, setVideoUrl] = useState('');

  // --- Refs ---
  const needPreferRef = useRef(needPrefer);
  const currentSourceRef = useRef(currentSource);
  const currentIdRef = useRef(currentId);
  const videoTitleRef = useRef(videoTitle);
  const videoYearRef = useRef(videoYear);
  const detailRef = useRef<SearchResult | null>(detail);
  const currentEpisodeIndexRef = useRef(currentEpisodeIndex);
  const searchTitleRef = useRef(searchTitle);

  // Fetch deduplication refs
  const lastInitKeyRef = useRef<string>('');
  const initAbortRef = useRef<AbortController | null>(null);

  // 核心播放器 Ref
  const playerRef = useRef<Player | null>(null);

  const resumeTimeRef = useRef<number | null>(null);
  const lastSaveTimeRef = useRef<number>(0);
  const saveErrorCountRef = useRef<number>(0);
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);
  const sourceFailCountRef = useRef<Record<string, number>>({});
  const sourceFailoverLockRef = useRef(false);
  const episodeProbeCacheRef = useRef<Record<string, boolean>>({});
  const sourceScoreMapRef = useRef<Record<string, number>>({});
  const sourceRankOrderRef = useRef<string[]>([]);

  // --- UI 状态 ---
  const [availableSources, setAvailableSources] = useState<SearchResult[]>([]);
  const [sourceSearchLoading, setSourceSearchLoading] = useState(false);
  const [sourceSearchError, setSourceSearchError] = useState<string | null>(
    null,
  );
  const [precomputedVideoInfo, setPrecomputedVideoInfo] = useState<
    Map<string, { quality: string; loadSpeed: string; pingTime: number }>
  >(new Map());
  const [isEpisodeSelectorCollapsed, setIsEpisodeSelectorCollapsed] =
    useState(false);
  const [isVideoLoading, setIsVideoLoading] = useState(true);
  const [videoLoadingStage, setVideoLoadingStage] = useState<
    'initing' | 'sourceChanging'
  >('initing');

  const totalEpisodes = detail?.episodes?.length || 0;

  // --- Effects: 状态同步 ---
  useEffect(() => {
    skipConfigRef.current = skipConfig;
  }, [skipConfig]);
  useEffect(() => {
    blockAdEnabledRef.current = blockAdEnabled;
  }, [blockAdEnabled]);
  useEffect(() => {
    needPreferRef.current = needPrefer;
  }, [needPrefer]);
  useEffect(() => {
    optimizationEnabledRef.current = optimizationEnabled;
  }, [optimizationEnabled]);
  useEffect(() => {
    debugEnabledRef.current = debugEnabled;
  }, [debugEnabled]);

  const lastProgressTimeRef = useRef<number>(Date.now());
  const handleVideoProgress = useCallback(() => {
    lastProgressTimeRef.current = Date.now();
  }, []);
  useEffect(() => {
    searchTitleRef.current = searchTitle;
  }, [searchTitle]);
  useEffect(() => {
    currentSourceRef.current = currentSource;
    currentIdRef.current = currentId;
    detailRef.current = detail;
    currentEpisodeIndexRef.current = currentEpisodeIndex;
    videoTitleRef.current = videoTitle;
    videoYearRef.current = videoYear;
  }, [
    currentSource,
    currentId,
    detail,
    currentEpisodeIndex,
    videoTitle,
    videoYear,
  ]);

  // --- Effect: Loading Timeout (Event Driven) ---
  useEffect(() => {
    if (!isVideoLoading || !videoUrl) return;

    lastProgressTimeRef.current = Date.now();
    const CHECK_INTERVAL = 3000;
    const TIMEOUT_DURATION = 15000;

    const intervalId = window.setInterval(() => {
      if (!isVideoLoading) return;

      const now = Date.now();
      if (now - lastProgressTimeRef.current > TIMEOUT_DURATION) {
        window.clearInterval(intervalId);
        console.warn('Video loading timeout - clearing loading state');
        setIsVideoLoading(false);

        const episodeIdx = currentEpisodeIndexRef.current;
        if (sourceFailoverLockRef.current) return;

        sourceFailoverLockRef.current = true;
        void (async () => {
          const pickCandidates = (sources: SearchResult[]) =>
            sources.filter((s) => {
              if (
                s.source === currentSourceRef.current &&
                s.id === currentIdRef.current
              )
                return false;
              if (!s.episodes || episodeIdx >= s.episodes.length) return false;
              const candidateKey = `${s.source}|${s.id}|${episodeIdx}`;
              return (sourceFailCountRef.current[candidateKey] || 0) < 2;
            });

          let candidates = pickCandidates(availableSources);
          if (candidates.length === 0) {
            const query = (
              searchTitleRef.current ||
              videoTitleRef.current ||
              ''
            ).trim();
            if (query) {
              try {
                const res = await fetch(
                  `/api/search?q=${encodeURIComponent(query)}`,
                  { cache: 'no-store' },
                );
                if (res.ok) {
                  const data = (await res.json()) as {
                    results?: SearchResult[];
                  };
                  const rawResults = Array.isArray(data.results)
                    ? data.results
                    : [];
                  const normalizedTitle = videoTitleRef.current
                    ?.replaceAll(' ', '')
                    .toLowerCase();
                  const normalizedSearchTitle = searchTitleRef.current
                    ?.replaceAll(' ', '')
                    .toLowerCase();
                  const normalizedYear = (videoYearRef.current || '')
                    .trim()
                    .toLowerCase();

                  const refreshedResults = rawResults.filter((result) => {
                    const normalizedResultTitle = result.title
                      .replaceAll(' ', '')
                      .toLowerCase();
                    const titleOk =
                      !normalizedTitle ||
                      normalizedResultTitle === normalizedTitle ||
                      (!!normalizedSearchTitle &&
                        normalizedResultTitle === normalizedSearchTitle);
                    const yearOk = normalizedYear
                      ? result.year.toLowerCase() === normalizedYear
                      : true;
                    return titleOk && yearOk;
                  });

                  if (refreshedResults.length > 0) {
                    setAvailableSources(refreshedResults);
                    candidates = pickCandidates(refreshedResults);
                  }
                }
              } catch {
                // Ignore refresh errors
              }
            }
          }

          if (candidates.length === 0) return;

          const rankedCandidates = sortSourcesByScore(candidates);
          for (const candidate of rankedCandidates) {
            const candidateEpisode = candidate.episodes?.[episodeIdx] || '';
            const ok = await probeEpisodePlayable(
              candidateEpisode,
              candidate.source,
              candidate.id,
            );
            if (!ok) continue;
            await handleSourceChange(
              candidate.source,
              candidate.id,
              candidate.title,
            );
            return;
          }
        })().finally(() => {
          setTimeout(() => {
            sourceFailoverLockRef.current = false;
          }, 1000);
        });
      }
    }, CHECK_INTERVAL);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [
    isVideoLoading,
    currentEpisodeIndex,
    videoUrl,
    availableSources,
    searchType,
  ]);

  // --- Effects: 初始化配置 ---
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const ad = localStorage.getItem('enable_blockad');
      if (ad !== null) setBlockAdEnabled(ad === 'true');

      const opt = localStorage.getItem('enableOptimization');
      if (opt !== null) {
        try {
          const val = JSON.parse(opt);
          setOptimizationEnabled(val);
          optimizationEnabledRef.current = val;
        } catch {
          /* ignore */
        }
      }

      const debug =
        localStorage.getItem('enablePlayerDebug') ||
        localStorage.getItem('enable_player_debug');
      if (debug === 'true') setDebugEnabled(true);
    }
  }, []);

  useEffect(() => {
    if (debugEnabled) {
      if (typeof window !== 'undefined') {
        (window as any).debugLogs = (window as any).debugLogs || [];
        (window as any).debugLogs.push(
          `[${new Date().toISOString()}] PlayPageClient MOUNTED`,
        );
      }
      return () => {
        if (typeof window !== 'undefined') {
          (window as any).debugLogs = (window as any).debugLogs || [];
          (window as any).debugLogs.push(
            `[${new Date().toISOString()}] PlayPageClient UNMOUNTED`,
          );
        }
      };
    }
  }, [debugEnabled]);

  // --- Effects: URL 参数变更 ---
  useEffect(() => {
    const sTitle = searchParams.get('title') || '';
    const sYear = searchParams.get('year') || '';
    const sCover = searchParams.get('cover') || '';
    const sSource = searchParams.get('source') || '';
    const sId = searchParams.get('id') || '';
    const sSTitle = searchParams.get('stitle') || '';
    const sSType = searchParams.get('stype') || '';
    const sPrefer = searchParams.get('prefer') === 'true';
    const sDesc = searchParams.get('desc') || '';

    if (sTitle !== videoTitle) setVideoTitle(sTitle);
    if (sYear !== videoYear) setVideoYear(sYear);
    if (sCover !== videoCover) setVideoCover(sCover);
    if (sDesc && sDesc !== videoDesc) setVideoDesc(sDesc);

    if (sSource !== currentSource || sId !== currentId) {
      setCurrentSource(sSource);
      setCurrentId(sId);
      setCurrentEpisodeIndex(0);
    }

    if (sSTitle !== searchTitle) setSearchTitle(sSTitle);
    if (sSType !== searchType) setSearchType(sSType);
    if (sPrefer !== needPrefer) setNeedPrefer(sPrefer);
  }, [searchParams]);

  // --- Effects: 更新播放地址 ---
  useEffect(() => {
    if (
      !detail ||
      !detail.episodes ||
      currentEpisodeIndex >= detail.episodes.length
    ) {
      setVideoUrl('');
      return;
    }
    const newUrl = detail.episodes[currentEpisodeIndex] || '';
    if (newUrl !== videoUrl) {
      setVideoUrl(newUrl);
    }
  }, [detail, currentEpisodeIndex]);

  // --- Effect: Sync Background for Seasonal Effects ---
  useEffect(() => {
    if (videoCover) {
      setBackgroundImage(processImageUrl(videoCover));
    }
    return () => {
      setBackgroundImage(null);
    };
  }, [videoCover, setBackgroundImage]);

  // --- 核心业务逻辑: 优选源 ---
  const calculateSourceScore = (
    testResult: { quality: string; loadSpeed: string; pingTime: number },
    maxSpeed: number,
    minPing: number,
    maxPing: number,
  ): number => {
    let score = 0;
    const qualityScore = (() => {
      switch (testResult.quality) {
        case '4K':
          return 100;
        case '2K':
          return 85;
        case '1080p':
          return 75;
        case '720p':
          return 60;
        case '480p':
          return 40;
        case 'SD':
          return 20;
        default:
          return 0;
      }
    })();
    score += qualityScore * 0.4;

    const speedScore = (() => {
      const speedStr = testResult.loadSpeed;
      if (speedStr === '未知' || speedStr === '测量中...') return 30;
      const match = speedStr.match(/^([\d.]+)\s*(KB\/s|MB\/s)$/);
      if (!match) return 30;
      const value = parseFloat(match[1]);
      const unit = match[2];
      const speedKBps = unit === 'MB/s' ? value * 1024 : value;
      const speedRatio = speedKBps / maxSpeed;
      return Math.min(100, Math.max(0, speedRatio * 100));
    })();
    score += speedScore * 0.4;

    const pingScore = (() => {
      const ping = testResult.pingTime;
      if (ping <= 0) return 0;
      if (maxPing === minPing) return 100;
      const pingRatio = (maxPing - ping) / (maxPing - minPing);
      return Math.min(100, Math.max(0, pingRatio * 100));
    })();
    score += pingScore * 0.2;

    return Math.round(score * 100) / 100;
  };

  const parseSpeedToKBps = (speedStr: string): number => {
    if (speedStr === '未知' || speedStr === '测量中...') return 0;
    const match = speedStr.match(/^([\d.]+)\s*(KB\/s|MB\/s)$/);
    if (!match) return 0;
    const value = parseFloat(match[1]);
    if (!Number.isFinite(value) || value <= 0) return 0;
    return match[2] === 'MB/s' ? value * 1024 : value;
  };

  const rankSourceResults = (
    results: Array<{
      source: SearchResult;
      testResult: { quality: string; loadSpeed: string; pingTime: number };
    }>,
  ) => {
    if (results.length === 0) return [];

    const validSpeeds = results
      .map((result) => parseSpeedToKBps(result.testResult.loadSpeed))
      .filter((speed) => speed > 0);
    const maxSpeed = validSpeeds.length > 0 ? Math.max(...validSpeeds) : 1024;

    const validPings = results
      .map((result) => result.testResult.pingTime)
      .filter((ping) => ping > 0);
    const minPing = validPings.length > 0 ? Math.min(...validPings) : 50;
    const maxPing = validPings.length > 0 ? Math.max(...validPings) : 1000;

    const ranked = results.map((result) => ({
      ...result,
      score: calculateSourceScore(
        result.testResult,
        maxSpeed,
        minPing,
        maxPing,
      ),
    }));

    ranked.sort((a, b) => b.score - a.score);
    return ranked;
  };

  const sortSourcesByScore = (sources: SearchResult[]): SearchResult[] => {
    if (sources.length <= 1) return sources;

    const scoreMap = sourceScoreMapRef.current;
    const rankOrder = sourceRankOrderRef.current;
    const rankIndexMap = new Map(rankOrder.map((k, i) => [k, i]));

    return [...sources].sort((a, b) => {
      const aKey = `${a.source}-${a.id}`;
      const bKey = `${b.source}-${b.id}`;

      const aScoreRaw = scoreMap[aKey];
      const bScoreRaw = scoreMap[bKey];
      const aHasScore = Number.isFinite(aScoreRaw);
      const bHasScore = Number.isFinite(bScoreRaw);
      const aScore = aHasScore ? Number(aScoreRaw) : 0;
      const bScore = bHasScore ? Number(bScoreRaw) : 0;

      if (aHasScore && bHasScore && aScore !== bScore) return bScore - aScore;
      if (aHasScore !== bHasScore) return aHasScore ? -1 : 1;

      const aRank = rankIndexMap.get(aKey);
      const bRank = rankIndexMap.get(bKey);
      const aHasRank = typeof aRank === 'number';
      const bHasRank = typeof bRank === 'number';
      if (aHasRank && bHasRank && aRank !== bRank) return aRank - bRank;
      if (aHasRank !== bHasRank) return aHasRank ? -1 : 1;

      return 0;
    });
  };

  const preferBestSource = async (
    sources: SearchResult[],
    signal?: AbortSignal,
  ): Promise<SearchResult> => {
    if (sources.length === 1) return sources[0];
    if (signal?.aborted) return sources[0];

    const MAX_CONCURRENT = 3;
    const MAX_TEST_SOURCES = 6;
    const candidates = sources.slice(0, MAX_TEST_SOURCES);

    type TestResult =
      | {
          status: 'ok';
          source: SearchResult;
          testResult: { quality: string; loadSpeed: string; pingTime: number };
        }
      | { status: 'reachable_untested'; source: SearchResult }
      | { status: 'unreachable'; source: SearchResult }
      | { status: 'error'; source: SearchResult }
      | { status: 'aborted' };

    const testSource = async (source: SearchResult): Promise<TestResult> => {
      if (signal?.aborted) return { status: 'aborted' };
      try {
        if (!source.episodes || source.episodes.length === 0) {
          console.warn(`播放源 ${source.source_name} 没有可用的播放地址`);
          return { status: 'error', source };
        }
        const episodeIdx = Math.max(
          0,
          Math.min(
            currentEpisodeIndexRef.current || 0,
            source.episodes.length - 1,
          ),
        );
        const episodeUrl = source.episodes[episodeIdx] || source.episodes[0];

        const testResult = await getVideoResolutionFromM3u8(episodeUrl, {
          signal,
          sourceId: source.source,
        });

        if (signal?.aborted) return { status: 'aborted' };

        return { status: 'ok', source, testResult };
      } catch (error: any) {
        if (error?.name === 'AbortError') return { status: 'aborted' };
        if (
          error?.message === 'Stream probe failed - source unreachable or 403'
        ) {
          return { status: 'unreachable', source };
        }
        return { status: 'reachable_untested', source };
      }
    };

    const runWithConcurrencyLimit = async (
      inputTasks: (() => Promise<TestResult>)[],
      limit: number,
    ): Promise<TestResult[]> => {
      const results: TestResult[] = new Array(inputTasks.length);
      const executing: Promise<void>[] = [];
      let i = 0;
      for (const task of inputTasks) {
        if (signal?.aborted) break;
        const index = i++;
        const promise = task().then((result) => {
          results[index] = result;
          executing.splice(executing.indexOf(promise), 1);
        });
        executing.push(promise);
        if (executing.length >= limit) await Promise.race(executing);
      }
      await Promise.all(executing);
      return results;
    };

    const taskList = candidates.map((source) => () => testSource(source));
    const allResults = await runWithConcurrencyLimit(taskList, MAX_CONCURRENT);

    if (!signal?.aborted) {
      const newVideoInfoMap = new Map<
        string,
        {
          quality: string;
          loadSpeed: string;
          pingTime: number;
          hasError?: boolean;
        }
      >();
      allResults.forEach((result) => {
        if (!result) return;

        if (result.status === 'ok') {
          const sourceKey = `${result.source.source}-${result.source.id}`;
          newVideoInfoMap.set(sourceKey, result.testResult);
        } else if (
          result.status === 'error' ||
          result.status === 'unreachable'
        ) {
          const sourceKey = `${result.source.source}-${result.source.id}`;
          newVideoInfoMap.set(sourceKey, {
            quality: 'Error',
            loadSpeed: '0 KB/s',
            pingTime: 0,
            hasError: true,
          });
        }
      });
      setPrecomputedVideoInfo(newVideoInfoMap);
    }

    if (signal?.aborted) return sources[0];

    const successfulResults = allResults
      .filter(
        (r): r is Extract<TestResult, { status: 'ok' }> => r?.status === 'ok',
      )
      .map((r) => ({ source: r.source, testResult: r.testResult }));

    if (successfulResults.length === 0) {
      const reachableResults = allResults.filter(
        (r): r is Extract<TestResult, { status: 'reachable_untested' }> =>
          r?.status === 'reachable_untested',
      );
      if (reachableResults.length > 0) {
        if (process.env.NODE_ENV !== 'production') {
          console.warn(
            '所有源HLS测速均失败或超时，但存在基础连通源，回退到连通源',
          );
        }
        sourceScoreMapRef.current = {};
        sourceRankOrderRef.current = [];
        return reachableResults[0].source;
      }

      console.warn(
        '所有播放源测速连通均失败，由于无可用判定，退回使用第一个评级源',
      );
      sourceScoreMapRef.current = {};
      sourceRankOrderRef.current = [];
      return sources[0];
    }

    const resultsWithScore = rankSourceResults(successfulResults);
    sourceScoreMapRef.current = Object.fromEntries(
      resultsWithScore.map((result) => [
        `${result.source.source}-${result.source.id}`,
        result.score,
      ]),
    );
    sourceRankOrderRef.current = resultsWithScore.map(
      (result) => `${result.source.source}-${result.source.id}`,
    );

    if (process.env.NODE_ENV !== 'production') {
      console.log('播放源评分排序结果:');
      resultsWithScore.forEach((result, index) => {
        console.log(
          `${index + 1}. ${result.source.source_name} - 评分: ${result.score.toFixed(2)} (${result.testResult.quality}, ${result.testResult.loadSpeed}, ${result.testResult.pingTime}ms)`,
        );
      });
    }

    return resultsWithScore[0]?.source || candidates[0] || sources[0];
  };

  useEffect(() => {
    let isMounted = true;

    const snap = {
      currentSource,
      currentId,
      videoTitle,
      videoYear,
      searchTitle,
      searchType,
      videoCover,
    };

    const initKey = `${snap.currentSource}::${snap.currentId}::${snap.searchTitle}::${snap.videoTitle}::${snap.searchType}::${snap.videoYear}`;

    if (lastInitKeyRef.current === initKey) return;
    lastInitKeyRef.current = initKey;

    initAbortRef.current?.abort();
    const ac = new AbortController();
    initAbortRef.current = ac;

    const fetchSourcesData = async (query: string): Promise<SearchResult[]> => {
      setSourceSearchLoading(true);
      setSourceSearchError(null);
      const res = await fetch(
        `/api/search?q=${encodeURIComponent(query.trim())}`,
        { signal: ac.signal },
      );
      if (!res.ok) throw new Error('搜索失败');
      const data = await res.json();
      const results = data.results.filter(
        (result: SearchResult) =>
          result.title.replaceAll(' ', '').toLowerCase() ===
            snap.videoTitle.replaceAll(' ', '').toLowerCase() &&
          (snap.videoYear
            ? result.year.toLowerCase() === snap.videoYear.toLowerCase()
            : true),
      );
      setAvailableSources(results);
      return results;
    };

    const fetchSourceDetail = async (
      source: string,
      id: string,
    ): Promise<SearchResult[]> => {
      setSourceSearchLoading(true);
      setSourceSearchError(null);
      const res = await fetch(`/api/detail?source=${source}&id=${id}`, {
        signal: ac.signal,
      });
      if (!res.ok) throw new Error('获取视频详情失败');
      const detailData = (await res.json()) as SearchResult;
      setAvailableSources([detailData]);
      return [detailData];
    };

    const initAll = async () => {
      try {
        sourceScoreMapRef.current = {};
        sourceRankOrderRef.current = [];

        const probeEpisodePlayableInInit = async (
          episodeUrl: string,
          sourceId: string,
        ): Promise<boolean> => {
          if (!episodeUrl) return false;
          try {
            const probeUrl = /^https?:\/\//i.test(episodeUrl)
              ? `/api/proxy/m3u8?url=${encodeURIComponent(episodeUrl)}&moontv-source=${encodeURIComponent(sourceId || 'global')}`
              : episodeUrl;
            const controller = new AbortController();
            const timeoutId = window.setTimeout(() => controller.abort(), 6000);
            const res = await fetch(probeUrl, {
              cache: 'no-store',
              signal: controller.signal,
            });
            clearTimeout(timeoutId);
            if (!res.ok) return false;
            const ct = (res.headers.get('content-type') || '').toLowerCase();
            const text = await res.text();
            return (
              ct.includes('mpegurl') ||
              text.includes('#EXTM3U') ||
              text.includes('#EXTINF')
            );
          } catch {
            return false;
          }
        };

        if (
          !snap.currentSource &&
          !snap.currentId &&
          !snap.videoTitle &&
          !snap.searchTitle
        ) {
          setError('缺少必要参数');
          setLoading(false);
          return;
        }

        setError(null);
        // --- NEW: Fast-Path Initialization Strategy ---
        let sourcesInfo: SearchResult[] = [];
        let detailData: SearchResult | null = null;
        const targetSource = snap.currentSource;
        const targetId = snap.currentId;
        let backgroundSearchPromise: Promise<SearchResult[]> | null = null;

        if (targetSource && targetId && !needPreferRef.current) {
          // 1. FAST PATH: We already know exactly what we want to play.
          setLoadingStage('fetching');
          setLoadingMessage('🎬 正在获取视频详情...');

          try {
            sourcesInfo = await fetchSourceDetail(targetSource, targetId);
            if (sourcesInfo.length > 0) {
              detailData = sourcesInfo[0];

              // Spin off the heavy global search into the background silently
              // to populate the right-side panel without blocking video playback.
              if (snap.searchTitle || snap.videoTitle) {
                backgroundSearchPromise = fetchSourcesData(
                  snap.searchTitle || snap.videoTitle,
                ).catch(() => []);
              }
            }
          } catch (err) {
            console.warn(
              '[Fast-Path] Direct source is dead, falling back to aggregate search...',
              err,
            );
            // Drop out of Fast Path, sourcesInfo remains empty, triggers fallback below.
          }
        }

        if (sourcesInfo.length === 0) {
          // 2. SLOW PATH / FALLBACK: Search all 12+ sites and auto-pick the best one.
          setLoadingStage('searching');
          setLoadingMessage('🔍 正在搜索可用播放源...');

          sourcesInfo = await fetchSourcesData(
            snap.searchTitle || snap.videoTitle,
          );

          if (sourcesInfo.length > 0) {
            detailData = sourcesInfo[0];
            // Force the Prefer mechanism to run so we don't just pick the first unverified source
            setNeedPrefer(true);
            needPreferRef.current = true;
          }
        }

        if (sourcesInfo.length === 0 || !detailData) {
          setError('未找到匹配结果');
          setLoading(false);
          return;
        }

        // --- Set videoDesc early to show it during the "Preferring" phase ---
        if (detailData.desc && !videoDesc) {
          setVideoDesc(detailData.desc);
        }

        // (Removed old target fallback block since we handle it in Fast Path now)

        if (
          sourcesInfo.length > 1 &&
          needPreferRef.current &&
          optimizationEnabledRef.current
        ) {
          setLoadingStage('preferring');
          setLoadingMessage('⚡ 正在优选最佳播放源...');
          detailData = await preferBestSource(sourcesInfo, ac.signal);
        }

        const preferredEpisodeIndex = Math.max(
          0,
          Math.min(
            currentEpisodeIndexRef.current || 0,
            (detailData.episodes?.length || 1) - 1,
          ),
        );
        const primaryEpisodeUrl =
          detailData.episodes?.[preferredEpisodeIndex] || '';
        const primaryPlayable = await probeEpisodePlayableInInit(
          primaryEpisodeUrl,
          detailData.id,
        );
        if (!primaryPlayable) {
          // If we took the Fast Path and it failed the probe, we must wait for the background search to finish
          // so we have alternative sources to fall back to.
          if (backgroundSearchPromise && sourcesInfo.length <= 1) {
            setLoadingStage('preferring');
            setLoadingMessage('⚡ 当前播放源失效，正在搜索备用源...');
            const bgSources = await backgroundSearchPromise;
            if (bgSources && bgSources.length > 0) {
              sourcesInfo = bgSources;
            }
          }

          const rankedFallbackSources = sortSourcesByScore(sourcesInfo);
          for (const source of rankedFallbackSources) {
            if (
              source.source === detailData.source &&
              source.id === detailData.id
            )
              continue;
            const idx = Math.max(
              0,
              Math.min(
                preferredEpisodeIndex,
                (source.episodes?.length || 1) - 1,
              ),
            );
            const candidateEpisode = source.episodes?.[idx] || '';
            if (!candidateEpisode) continue;
            const ok = await probeEpisodePlayableInInit(
              candidateEpisode,
              source.id,
            );
            if (ok) {
              detailData = source;
              break;
            }
          }
        }

        if (!isMounted || ac.signal.aborted) return;

        if (needPreferRef.current) setNeedPrefer(false);

        if (snap.currentSource !== detailData.source)
          setCurrentSource(detailData.source);
        if (snap.currentId !== detailData.id) setCurrentId(detailData.id);

        if (detailData.year !== snap.videoYear) setVideoYear(detailData.year);

        const nextTitle = detailData.title || snap.videoTitle;
        if (nextTitle !== snap.videoTitle) setVideoTitle(nextTitle);

        if (detailData.poster !== snap.videoCover)
          setVideoCover(detailData.poster);

        if (detailData.desc) setVideoDesc(detailData.desc);

        setVideoDoubanId(detailData.douban_id || 0);
        setDetail(detailData);

        if (currentEpisodeIndexRef.current >= detailData.episodes.length)
          setCurrentEpisodeIndex(0);

        const newUrl = new URL(window.location.href);
        newUrl.searchParams.set('source', detailData.source);
        newUrl.searchParams.set('id', detailData.id);
        newUrl.searchParams.set('year', detailData.year);
        newUrl.searchParams.set('title', detailData.title);
        newUrl.searchParams.delete('prefer');
        window.history.replaceState({}, '', newUrl.toString());

        setLoadingStage('ready');
        setLoadingMessage('✨ 准备就绪，即将开始播放...');
        setTimeout(() => {
          if (isMounted && !ac.signal.aborted) setLoading(false);
        }, 1000);
      } catch (e: any) {
        if (e?.name === 'AbortError') {
          if (isMounted) setSourceSearchLoading(false);
          return;
        }
        if (isMounted) {
          setError(e instanceof Error ? e.message : '初始化失败');
          setLoading(false);
        }
      } finally {
        if (isMounted && !ac.signal.aborted) setSourceSearchLoading(false);
      }
    };

    initAll();

    return () => {
      isMounted = false;
      ac.abort();
    };
  }, [
    currentSource,
    currentId,
    videoTitle,
    searchTitle,
    searchType,
    videoYear,
  ]);

  useEffect(() => {
    const initFromHistory = async () => {
      if (!currentSource || !currentId) return;
      try {
        const allRecords = await getAllPlayRecords();
        const key = generateStorageKey(currentSource, currentId);
        const record = allRecords[key];
        if (record) {
          const targetIndex = record.index - 1;
          if (targetIndex !== currentEpisodeIndex)
            setCurrentEpisodeIndex(targetIndex);
          resumeTimeRef.current = record.play_time;
          if (record.desc && !videoDesc) setVideoDesc(record.desc);
        }
      } catch (err) {
        console.error('读取播放记录失败:', err);
      }
    };
    initFromHistory();
  }, [currentSource, currentId]);

  useEffect(() => {
    sourceFailoverLockRef.current = false;
  }, [currentSource, currentId, currentEpisodeIndex]);

  useEffect(() => {
    const initSkipConfig = async () => {
      if (!currentSource || !currentId) return;
      try {
        const config = await getSkipConfig(currentSource, currentId);
        if (config) setSkipConfig(config);
      } catch (err) {
        console.error('读取配置失败:', err);
      }
    };
    initSkipConfig();
  }, [currentSource, currentId]);

  useEffect(() => {
    if (!currentSource || !currentId) return;
    (async () => {
      try {
        const fav = await isFavorited(currentSource, currentId);
        setFavorited(fav);
      } catch (err) {
        console.error('检查收藏失败:', err);
      }
    })();

    const unsubscribe = subscribeToDataUpdates(
      'favoritesUpdated',
      (favorites: Record<string, any>) => {
        const key = generateStorageKey(currentSource, currentId);
        setFavorited(!!favorites[key]);
      },
    );
    return unsubscribe;
  }, [currentSource, currentId]);

  const saveCurrentPlayProgress = async () => {
    const player = playerRef.current;
    if (
      !player ||
      player.isDisposed() ||
      !currentSourceRef.current ||
      !currentIdRef.current ||
      !videoTitleRef.current
    )
      return;

    const ct = player.currentTime();
    const dur = player.duration();

    // Explicit check for NaN/Invalid values and Narrow types
    if (
      typeof ct !== 'number' ||
      !Number.isFinite(ct) ||
      ct < 1 ||
      typeof dur !== 'number' ||
      !Number.isFinite(dur) ||
      dur <= 0
    )
      return;

    const currentTime: number = ct;
    const duration: number = dur;

    try {
      await savePlayRecord(currentSourceRef.current, currentIdRef.current, {
        title: videoTitleRef.current,
        source_name: detailRef.current?.source_name || '',
        year: detailRef.current?.year || '',
        cover: detailRef.current?.poster || '',
        index: currentEpisodeIndexRef.current + 1,
        total_episodes: detailRef.current?.episodes.length || 1,
        play_time: Math.floor(currentTime),
        total_time: Math.floor(duration),
        save_time: Date.now(),
        search_title: searchTitleRef.current,
        category: detailRef.current?.class || detailRef.current?.type_name,
        desc: videoDesc,
      });
      lastSaveTimeRef.current = Date.now();
      saveErrorCountRef.current = 0; // Reset error count on success
    } catch (err) {
      saveErrorCountRef.current++;
      // Only log errors sparingly to prevent console flooding
      if (saveErrorCountRef.current <= 3) {
        console.error('保存进度失败:', err);
      }
      // Still update lastSaveTime to honor the interval even on failure
      lastSaveTimeRef.current = Date.now();
    }
  };

  const handleToggleFavorite = async () => {
    if (
      !videoTitleRef.current ||
      !detailRef.current ||
      !currentSourceRef.current ||
      !currentIdRef.current
    )
      return;

    try {
      if (favorited) {
        await deleteFavorite(currentSourceRef.current, currentIdRef.current);
        setFavorited(false);
      } else {
        await saveFavorite(currentSourceRef.current, currentIdRef.current, {
          title: videoTitleRef.current,
          source_name: detailRef.current?.source_name || '',
          year: detailRef.current?.year,
          cover: detailRef.current?.poster || '',
          total_episodes: detailRef.current?.episodes.length || 1,
          save_time: Date.now(),
          search_title: searchTitleRef.current,
        });
        setFavorited(true);
      }
    } catch (err) {
      console.error('切换收藏失败:', err);
    }
  };

  const handleEpisodeChange = (episodeNumber: number) => {
    const total = detailRef.current?.episodes?.length || 0;
    if (episodeNumber < 1 || episodeNumber > total) return;

    const p = playerRef.current;
    if (p && !p.isDisposed()) {
      if (!p.paused()) saveCurrentPlayProgress();
      // p.pause(); // REMOVED: Let the source change handle stop to avoid FS exit on some browsers
    }

    setIsVideoLoading(true);
    setVideoLoadingStage('sourceChanging');

    resumeTimeRef.current = 0;

    setCurrentEpisodeIndex(episodeNumber - 1);
  };

  // FIX: Using State (detail/currentEpisodeIndex) directly instead of Refs
  // to ensure 'Next' logic always calculates from the latest render state.
  const handleNextEpisode = () => {
    if (
      detail &&
      detail.episodes &&
      currentEpisodeIndex < detail.episodes.length - 1
    ) {
      handleEpisodeChange(currentEpisodeIndex + 2); // 0-based index -> +1 for next, +1 for 1-based arg
    }
  };

  const handleSourceChange = async (
    newSource: string,
    newId: string,
    newTitle: string,
  ) => {
    try {
      setVideoLoadingStage('sourceChanging');
      setIsVideoLoading(true);

      const player = playerRef.current;
      const currentPlayTime =
        (player && !player.isDisposed() ? player.currentTime() : 0) || 0;

      if (currentSourceRef.current && currentIdRef.current) {
        await deletePlayRecord(currentSourceRef.current, currentIdRef.current);
        await deleteSkipConfig(currentSourceRef.current, currentIdRef.current);
        await saveSkipConfig(newSource, newId, skipConfigRef.current);
      }

      const newDetail = availableSources.find(
        (s) => s.source === newSource && s.id === newId,
      );
      if (!newDetail) {
        setError('未找到匹配结果');
        return;
      }

      let targetIndex = currentEpisodeIndex;
      if (!newDetail.episodes || targetIndex >= newDetail.episodes.length)
        targetIndex = 0;

      if (targetIndex !== currentEpisodeIndex) resumeTimeRef.current = 0;
      else if (
        (!resumeTimeRef.current || resumeTimeRef.current === 0) &&
        currentPlayTime > 1
      )
        resumeTimeRef.current = currentPlayTime;

      const newUrl = new URL(window.location.href);
      newUrl.searchParams.set('source', newSource);
      newUrl.searchParams.set('id', newId);
      newUrl.searchParams.set('year', newDetail.year);
      window.history.replaceState({}, '', newUrl.toString());

      // Bypass the full initialization since we are manually selecting the source
      lastInitKeyRef.current = `${newSource}::${newId}::${searchTitleRef.current}::${newDetail.title || newTitle}::${searchType}::${newDetail.year}`;

      setVideoTitle(newDetail.title || newTitle);
      setVideoYear(newDetail.year);
      setVideoCover(newDetail.poster);
      setVideoDesc(newDetail.desc || '');
      setVideoDoubanId(newDetail.douban_id || 0);
      setCurrentSource(newSource);
      setCurrentId(newId);
      setDetail(newDetail);
      setCurrentEpisodeIndex(targetIndex);
    } catch (err) {
      setIsVideoLoading(false);
      setError(err instanceof Error ? err.message : '换源失败');
    }
  };

  const probeEpisodePlayable = async (
    episodeUrl: string,
    source: string,
    id: string,
  ): Promise<boolean> => {
    if (!episodeUrl) return false;
    const cacheKey = `${source}|${id}|${episodeUrl}`;
    if (cacheKey in episodeProbeCacheRef.current) {
      return episodeProbeCacheRef.current[cacheKey];
    }

    try {
      const probeUrl = /^https?:\/\//i.test(episodeUrl)
        ? `/api/proxy/m3u8?url=${encodeURIComponent(episodeUrl)}&moontv-source=${encodeURIComponent(id || 'global')}`
        : episodeUrl;
      const controller = new AbortController();
      const timeoutId = window.setTimeout(() => controller.abort(), 7000);
      const res = await fetch(probeUrl, {
        cache: 'no-store',
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      if (!res.ok) {
        episodeProbeCacheRef.current[cacheKey] = false;
        return false;
      }
      const ct = (res.headers.get('content-type') || '').toLowerCase();
      const text = await res.text();
      const playable =
        ct.includes('mpegurl') ||
        text.includes('#EXTM3U') ||
        text.includes('#EXTINF');
      episodeProbeCacheRef.current[cacheKey] = playable;
      return playable;
    } catch {
      episodeProbeCacheRef.current[cacheKey] = false;
      return false;
    }
  };

  const requestWakeLock = async () => {
    try {
      if ('wakeLock' in navigator)
        wakeLockRef.current = await (navigator as any).wakeLock.request(
          'screen',
        );
    } catch {
      /* WakeLock not supported or denied */
    }
  };
  const releaseWakeLock = async () => {
    try {
      if (wakeLockRef.current) {
        await wakeLockRef.current.release();
        wakeLockRef.current = null;
      }
    } catch {
      /* WakeLock release failed - ignore */
    }
  };

  const handlePlayerReady = (player: Player) => {
    if (player.isDisposed()) return;

    playerRef.current = player;
    setIsVideoLoading(false);

    if (resumeTimeRef.current && resumeTimeRef.current > 0) {
      console.log(`[Playback] Resuming at ${resumeTimeRef.current}`);
      player.currentTime(resumeTimeRef.current);
      const playPromise = player.play();
      if (playPromise !== undefined) playPromise.catch(() => {});
      resumeTimeRef.current = null;
    }

    if ((player as any).mobileUi) {
      (player as any).mobileUi({
        touchControls: {
          seekSeconds: 10,
          tapToPlay: true,
          disableOnEnd: false,
        },
        fullscreen: {
          enterOnRotate: true,
          exitOnRotate: true,
          lockOnRotate: true,
        },
      });
    }
  };

  const handleTimeUpdate = (currentTime: number, duration: number) => {
    handleVideoProgress();
    const now = Date.now();
    let interval = 5000;
    if (process.env.NEXT_PUBLIC_STORAGE_TYPE === 'upstash') interval = 20000;

    if (!lastSaveTimeRef.current || now - lastSaveTimeRef.current > interval) {
      saveCurrentPlayProgress();
      lastSaveTimeRef.current = now;
    }
  };

  const handleEnded = () => {
    // 1. Handle TV Series (Multiple episodes in one source)
    if (
      detail &&
      detail.episodes &&
      currentEpisodeIndex < detail.episodes.length - 1
    ) {
      setTimeout(() => {
        handleEpisodeChange(currentEpisodeIndex + 2);
      }, 1000);
      saveCurrentPlayProgress();
      return;
    }

    // 2. Handle Movies/Single Episodes (Maybe next source in availableSources?)
    // If the title contains "Part 1" or similar, we might find "Part 2" in availableSources
    const nextInQueue = availableSources.find(
      (s) =>
        s.source === currentSource &&
        s.id !== currentId &&
        (s.title.includes('2') ||
          s.title.toLowerCase().includes('part') ||
          s.title.toLowerCase().includes('集')),
    );

    if (nextInQueue) {
      setTimeout(() => {
        handleSourceChange(
          nextInQueue.source,
          nextInQueue.id,
          nextInQueue.title,
        );
      }, 1500);
    }

    saveCurrentPlayProgress();
  };

  const handleKeyboardShortcuts = (e: KeyboardEvent) => {
    if (
      (e.target as HTMLElement).tagName === 'INPUT' ||
      (e.target as HTMLElement).tagName === 'TEXTAREA'
    )
      return;

    if (e.altKey && e.key === 'ArrowLeft') {
      if (detailRef.current && currentEpisodeIndexRef.current > 0) {
        e.preventDefault();
        handleEpisodeChange(currentEpisodeIndexRef.current);
      }
    }

    if (e.altKey && e.key === 'ArrowRight') {
      const d = detailRef.current;
      if (d && currentEpisodeIndexRef.current < d.episodes.length - 1) {
        e.preventDefault();
        handleEpisodeChange(currentEpisodeIndexRef.current + 2);
      }
    }
  };

  useEffect(() => {
    document.addEventListener('keydown', handleKeyboardShortcuts);
    return () =>
      document.removeEventListener('keydown', handleKeyboardShortcuts);
  }, []);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        saveCurrentPlayProgress();
        releaseWakeLock();
      } else if (document.visibilityState === 'visible') {
        const p = playerRef.current;
        if (p && !p.isDisposed() && !p.paused()) requestWakeLock();
      }
    };

    const handleBeforeUnload = () => {
      saveCurrentPlayProgress();
      releaseWakeLock();
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      releaseWakeLock();
    };
  }, []);

  if (loading) {
    return (
      <PageLayout activePath='/play'>
        <div className='flex flex-col items-center justify-center min-h-[50vh] mt-20'>
          <div className='animate-in fade-in zoom-in duration-500'>
            <div className='relative mx-auto w-36 aspect-2/3 bg-gray-200 dark:bg-gray-800 rounded-xl shadow-2xl overflow-hidden transform hover:scale-105 transition-transform duration-300 ring-4 ring-white/20 dark:ring-black/20'>
              {videoCover ? (
                <img
                  src={processImageUrl(videoCover)}
                  alt={videoTitle}
                  className='w-full h-full object-cover'
                />
              ) : (
                <div className='w-full h-full bg-linear-to-br from-gray-300 to-gray-400 dark:from-gray-700 dark:to-gray-800 flex items-center justify-center'>
                  <span className='text-4xl'>🎬</span>
                </div>
              )}
              <div className='absolute inset-0 bg-black/40 flex items-center justify-center backdrop-blur-[2px]'>
                <div className='w-16 h-16 bg-white/10 backdrop-blur-md rounded-full flex items-center justify-center shadow-lg ring-1 ring-white/20'>
                  <div className='text-3xl animate-bounce'>
                    {loadingStage === 'searching' && '🔍'}
                    {loadingStage === 'preferring' && '⚡'}
                    {loadingStage === 'fetching' && '🎬'}
                    {loadingStage === 'ready' && '✨'}
                  </div>
                </div>
              </div>
            </div>
            <div className='mt-5 text-center px-4'>
              <h2 className='text-xl md:text-2xl font-bold bg-clip-text text-transparent bg-linear-to-r from-gray-900 to-gray-600 dark:from-white dark:to-gray-300 line-clamp-2'>
                {convert(videoTitle || '正在加载...')}
              </h2>
              {videoYear && (
                <span className='inline-block mt-2 px-3 py-1 bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 text-xs font-medium rounded-full'>
                  {videoYear}
                </span>
              )}
            </div>
          </div>
          <div className='mb-6 mt-6 w-80 mx-auto'>
            <div className='w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2 overflow-hidden'>
              <div
                className='h-full bg-linear-to-r from-green-500 to-emerald-600 rounded-full transition-all duration-1000 ease-out'
                style={{
                  width:
                    loadingStage === 'searching' || loadingStage === 'fetching'
                      ? '33%'
                      : loadingStage === 'preferring'
                        ? '66%'
                        : '100%',
                }}
              ></div>
            </div>
          </div>
          <div className='space-y-2'>
            <p className='text-xl font-semibold text-gray-800 dark:text-gray-200 animate-pulse'>
              {convert(loadingMessage)}
            </p>
          </div>
          <div className='mt-6 max-w-lg mx-auto px-4 w-full'>
            <div className='h-24 overflow-hidden relative'>
              <div className='animate-scroll-y will-change-transform space-y-4'>
                <p className='text-sm text-gray-500 dark:text-gray-400 text-center leading-relaxed'>
                  {convert(videoDesc || '正在加载影片简介...')}
                </p>
                {/* duplicate for seamless loop */}
                <p
                  className='text-sm text-gray-500 dark:text-gray-400 text-center leading-relaxed'
                  aria-hidden='true'
                >
                  {convert(videoDesc || '正在加载影片简介...')}
                </p>
              </div>
            </div>
          </div>
        </div>
      </PageLayout>
    );
  }

  if (error) {
    return (
      <PageLayout activePath='/play'>
        <div className='flex items-center justify-center min-h-screen bg-transparent'>
          <div className='text-center max-w-md mx-auto px-6'>
            <div className='space-y-4 mb-8'>
              <h2 className='text-2xl font-bold text-gray-800 dark:text-gray-200'>
                哎呀，出现了一些问题
              </h2>
              <div className='bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4'>
                <p className='text-red-600 dark:text-red-400 font-medium'>
                  {error}
                </p>
              </div>
            </div>
            <div className='space-y-3'>
              <button
                onClick={() =>
                  videoTitle
                    ? router.push(`/search?q=${encodeURIComponent(videoTitle)}`)
                    : router.back()
                }
                className='w-full px-6 py-3 bg-linear-to-r from-green-500 to-emerald-600 text-white rounded-xl font-medium'
              >
                {videoTitle ? convert('🔍 返回搜索') : convert('← 返回上页')}
              </button>
              <button
                onClick={() => window.location.reload()}
                className='w-full px-6 py-3 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-xl font-medium'
              >
                {convert('🔄 重新尝试')}
              </button>
            </div>
          </div>
        </div>
      </PageLayout>
    );
  }

  return (
    <PageLayout activePath='/play'>
      <div className='flex flex-col gap-3 py-0 md:py-4 px-0 md:px-5 lg:px-12 2xl:px-20'>
        <div className='py-1'>
          <h1 className='text-xl font-semibold text-gray-900 dark:text-gray-100'>
            {convert(videoTitle || '影片标题')}
            {totalEpisodes > 1 && (
              <span className='text-gray-500 dark:text-gray-400'>{` > ${detail?.episodes_titles?.[currentEpisodeIndex] || `第 ${currentEpisodeIndex + 1} 集`}`}</span>
            )}
          </h1>
        </div>

        <div className='space-y-2'>
          <div className='hidden lg:flex justify-end'>
            <button
              onClick={() =>
                setIsEpisodeSelectorCollapsed(!isEpisodeSelectorCollapsed)
              }
              className='group relative flex items-center space-x-1.5 px-3 py-1.5 rounded-full bg-white/80 hover:bg-white dark:bg-gray-800/80 dark:hover:bg-gray-800 backdrop-blur-sm border border-gray-200/50 dark:border-gray-700/50 shadow-sm hover:shadow-md transition-all duration-200'
              title={
                isEpisodeSelectorCollapsed ? '显示选集面板' : '隐藏选集面板'
              }
            >
              <span className='text-xs font-medium text-gray-600 dark:text-gray-300'>
                {isEpisodeSelectorCollapsed ? '显示' : '隐藏'}
              </span>
              <div
                className={`absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full transition-all duration-200 ${isEpisodeSelectorCollapsed ? 'bg-orange-400 animate-pulse' : 'bg-green-400'}`}
              ></div>
            </button>
          </div>

          <div
            className={`grid gap-4 lg:h-[500px] xl:h-[650px] 2xl:h-[750px] transition-all duration-300 ease-in-out ${isEpisodeSelectorCollapsed ? 'grid-cols-1' : 'grid-cols-1 md:grid-cols-4'}`}
          >
            <div
              className={`h-full transition-all duration-300 ease-in-out rounded-xl border border-white/0 dark:border-white/30 ${isEpisodeSelectorCollapsed ? 'col-span-1' : 'md:col-span-3'}`}
            >
              <div className='relative w-full aspect-video lg:aspect-auto lg:h-full bg-black rounded-xl overflow-hidden shadow-2xl'>
                {/* 核心播放器组件 */}
                <div className='w-full h-full'>
                  {debugEnabled && (
                    <div className='fixed top-20 left-20 z-50 bg-red-600 text-white p-4 font-bold text-xl border-4 border-yellow-400 pointer-events-none'>
                      DEBUG MODE ACTIVE
                    </div>
                  )}
                  <VideoJsPlayer
                    debug={debugEnabled}
                    url={videoUrl}
                    poster={processImageUrl(videoCover)}
                    autoPlay={true}
                    onReady={handlePlayerReady}
                    onTimeUpdate={handleTimeUpdate}
                    onEnded={handleEnded}
                    onLoadedMetadata={() => setIsVideoLoading(false)}
                    onPlay={() => setIsVideoLoading(false)}
                    onError={(err: any) => {
                      if (process.env.NODE_ENV !== 'production') {
                        console.error('播放器报错:', err);
                      }
                      // The original logic for error handling and failover
                      setIsVideoLoading(false);
                      const code =
                        typeof err === 'object' && err !== null
                          ? Number(
                              (err as any).code ??
                                (err as any).raw?.code ??
                                (err as any).responseCode,
                            )
                          : NaN;
                      const message =
                        typeof err === 'object' && err !== null
                          ? String(
                              (err as any).message ||
                                (err as any).details ||
                                (err as any).responseText ||
                                '',
                            )
                          : '';

                      const retryableByCode = [2, 3, 4].includes(code);
                      const retryableByMessage =
                        /network|manifest|frag|timeout|forbidden|403|500|502|source/i.test(
                          message.toLowerCase(),
                        );
                      if (!retryableByCode && !retryableByMessage) return;

                      const episodeIdx = currentEpisodeIndex;
                      const failKey = `${currentSource}|${currentId}|${episodeIdx}`;
                      const nextCount =
                        (sourceFailCountRef.current[failKey] || 0) + 1;
                      sourceFailCountRef.current[failKey] = nextCount;

                      // Trigger source failover as soon as we see a retryable error.
                      if (nextCount < 1) return;
                      if (sourceFailoverLockRef.current) return;
                      sourceFailoverLockRef.current = true;
                      void (async () => {
                        const pickCandidates = (sources: SearchResult[]) =>
                          sources.filter((s) => {
                            if (
                              s.source === currentSource &&
                              s.id === currentId
                            )
                              return false;
                            if (!s.episodes || episodeIdx >= s.episodes.length)
                              return false;
                            const candidateKey = `${s.source}|${s.id}|${episodeIdx}`;
                            return (
                              (sourceFailCountRef.current[candidateKey] || 0) <
                              2
                            );
                          });

                        let candidates = pickCandidates(availableSources);
                        if (candidates.length === 0) {
                          const query = (
                            searchTitleRef.current ||
                            videoTitleRef.current ||
                            ''
                          ).trim();
                          if (query) {
                            try {
                              const res = await fetch(
                                `/api/search?q=${encodeURIComponent(query)}`,
                                { cache: 'no-store' },
                              );
                              if (res.ok) {
                                const data = (await res.json()) as {
                                  results?: SearchResult[];
                                };
                                const refreshedResults = Array.isArray(
                                  data.results,
                                )
                                  ? data.results
                                  : [];
                                if (refreshedResults.length > 0) {
                                  setAvailableSources(refreshedResults);
                                  candidates = pickCandidates(refreshedResults);
                                }
                              }
                            } catch {
                              // Ignore refresh errors and continue.
                            }
                          }
                        }

                        if (candidates.length === 0) {
                          setError(
                            convert(
                              '当前集所有播放源都不可用，请切换剧集或稍后重试',
                            ),
                          );
                          setVideoUrl('');
                          setIsVideoLoading(false);
                          return;
                        }

                        const rankedCandidates = sortSourcesByScore(candidates);
                        for (const candidate of rankedCandidates) {
                          const candidateEpisode =
                            candidate.episodes?.[episodeIdx] || '';
                          const ok = await probeEpisodePlayable(
                            candidateEpisode,
                            candidate.source,
                            candidate.id,
                          );
                          if (!ok) continue;

                          await handleSourceChange(
                            candidate.source,
                            candidate.id,
                            candidate.title,
                          );
                          return;
                        }

                        setError(
                          convert(
                            '当前集所有播放源都不可用，请切换剧集或稍后重试',
                          ),
                        );
                        setVideoUrl('');
                        setIsVideoLoading(false);
                      })().finally(() => {
                        setTimeout(() => {
                          sourceFailoverLockRef.current = false;
                        }, 1000);
                      });
                    }}
                    enableSkip={skipConfigRef.current.enable}
                    skipIntroTime={skipConfigRef.current.intro_time}
                    skipOutroTime={skipConfigRef.current.outro_time}
                    customHlsLoaderFactory={
                      blockAdEnabled ? createCustomHlsJsLoader : undefined
                    }
                    onNextEpisode={handleNextEpisode}
                    hasNextEpisode={currentEpisodeIndex < totalEpisodes - 1}
                    seriesId={currentId}
                  />
                </div>

                {/* 加载遮罩 */}
                {isVideoLoading && (
                  <div
                    className='absolute inset-0 bg-black/85 backdrop-blur-sm rounded-xl flex items-center justify-center z-500 transition-all duration-300 cursor-pointer active:scale-[0.99] select-none'
                    onClick={() => {
                      // GESTURE REFRESH: Clicking here gives us a fresh user gesture context
                      // so the player can actually auto-play when the URL is ready.
                      if (playerRef.current) {
                        try {
                          playerRef.current.play()?.catch(() => {});
                        } catch {
                          /* ignore */
                        }
                      }
                      console.log(
                        '[Gesture] Refreshing user context via loading mask click',
                      );
                    }}
                  >
                    <div className='text-center max-w-md mx-auto px-6 pointer-events-none'>
                      <div className='relative mb-8'>
                        <div className='relative mx-auto w-24 h-24 bg-linear-to-r from-green-500 to-emerald-600 rounded-2xl shadow-2xl flex items-center justify-center transform hover:scale-105 transition-transform duration-300'>
                          <div className='text-white text-4xl'>🎬</div>
                          <div className='absolute -inset-2 bg-linear-to-r from-green-500 to-emerald-600 rounded-2xl opacity-20 animate-spin'></div>
                        </div>
                      </div>
                      <div className='space-y-4'>
                        <p className='text-xl font-semibold text-white animate-pulse'>
                          {videoLoadingStage === 'sourceChanging'
                            ? convert('🔄 切换播放源...')
                            : convert('🔄 视频加载中...')}
                        </p>
                        <p className='text-sm text-gray-400 opacity-60'>
                          {convert('加载中，可点击此处保持唤醒...')}
                        </p>
                        {videoDesc && (
                          <div className='max-w-xs mx-auto overflow-hidden relative h-12 flex items-center'>
                            <div className='whitespace-nowrap flex animate-scroll-x will-change-transform'>
                              <span className='text-gray-300 text-sm px-4'>
                                {convert(videoDesc)}
                              </span>
                              <span className='text-gray-300 text-sm px-4'>
                                {convert(videoDesc)}
                              </span>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div
              className={`h-[300px] lg:h-full md:overflow-hidden transition-all duration-300 ease-in-out ${isEpisodeSelectorCollapsed ? 'md:col-span-1 lg:hidden lg:opacity-0 lg:scale-95' : 'md:col-span-1 lg:opacity-100 lg:scale-100'} ${isVideoLoading ? 'opacity-80' : ''}`}
            >
              <EpisodeSelector
                totalEpisodes={totalEpisodes}
                episodes_titles={detail?.episodes_titles || []}
                value={currentEpisodeIndex + 1}
                onChange={handleEpisodeChange}
                onSourceChange={handleSourceChange}
                currentSource={currentSource}
                currentId={currentId}
                videoTitle={searchTitle || videoTitle}
                availableSources={availableSources}
                sourceSearchLoading={sourceSearchLoading}
                sourceSearchError={sourceSearchError}
                precomputedVideoInfo={precomputedVideoInfo}
              />
            </div>
          </div>
        </div>

        <div className='grid grid-cols-1 md:grid-cols-4 gap-4'>
          <div className='md:col-span-3'>
            <div className='p-6 flex flex-col min-h-0'>
              <h1 className='text-3xl font-bold mb-2 tracking-wide flex items-center shrink-0 text-center md:text-left w-full'>
                {convert(videoTitle || '影片标题')}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleToggleFavorite();
                  }}
                  className='ml-3 shrink-0 hover:opacity-80 transition-opacity'
                >
                  <Heart
                    className={`w-6 h-6 ${favorited ? 'text-red-500 fill-red-500' : 'text-gray-400'}`}
                  />
                </button>
              </h1>
              <div className='flex flex-wrap items-center gap-3 text-base mb-4 opacity-80 shrink-0'>
                {detail?.class && (
                  <span className='text-green-600 font-semibold'>
                    {convert(detail.class)}
                  </span>
                )}
                {(detail?.year || videoYear) && (
                  <span>{detail?.year || videoYear}</span>
                )}
                {detail?.source_name && (
                  <span className='border border-gray-500/60 px-2 py-px rounded'>
                    {convert(detail.source_name)}
                  </span>
                )}
                {detail?.type_name && <span>{convert(detail.type_name)}</span>}
              </div>
              {detail?.desc && (
                <ScrollableDescription
                  content={convert(detail.desc)}
                  className='mt-0 text-base leading-relaxed opacity-90 h-40 md:h-60'
                />
              )}
            </div>
          </div>
          <div className='hidden md:block md:col-span-1 md:order-first'>
            <div className='pl-0 py-4 pr-6'>
              <div className='relative bg-gray-300 dark:bg-gray-700 aspect-2/3 flex items-center justify-center rounded-xl overflow-hidden'>
                {videoCover ? (
                  <>
                    <img
                      src={processImageUrl(videoCover)}
                      alt={videoTitle}
                      className='w-full h-full object-cover'
                    />
                    {videoDoubanId !== 0 && (
                      <a
                        href={`https://movie.douban.com/subject/${videoDoubanId.toString()}`}
                        target='_blank'
                        rel='noopener noreferrer'
                        className='absolute top-3 left-3'
                      >
                        <div className='bg-green-500 text-white text-xs font-bold w-8 h-8 rounded-full flex items-center justify-center shadow-md hover:bg-green-600 hover:scale-[1.1] transition-all duration-300 ease-out'>
                          <svg
                            width='16'
                            height='16'
                            viewBox='0 0 24 24'
                            fill='none'
                            stroke='currentColor'
                            strokeWidth='2'
                            strokeLinecap='round'
                            strokeLinejoin='round'
                          >
                            <path d='M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71'></path>
                            <path d='M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71'></path>
                          </svg>
                        </div>
                      </a>
                    )}
                  </>
                ) : (
                  <span className='text-gray-600 dark:text-gray-400'>
                    封面图片
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </PageLayout>
  );
}

export default function PlayPage() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <PlayPageClient />
    </Suspense>
  );
}
