'use client';

import { Heart, Radio, Tv } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type Player from 'video.js/dist/types/player';
// Import videojs-flvjs if you need FLV support. If not installed, remove this line.
import 'videojs-flvjs';

import {
  deleteFavorite,
  generateStorageKey,
  isFavorited as checkIsFavorited,
  saveFavorite,
  subscribeToDataUpdates,
} from '@/lib/db.client';
import { parseCustomTimeFormat } from '@/lib/time';

import EpgScrollableRow from '@/components/EpgScrollableRow';
import PageLayout from '@/components/PageLayout';
import VideoJsPlayer from '@/components/VideoJsPlayer';

// --- Types ---

interface ChannelApiResponse {
  id: string;
  tvgId?: string;
  name: string;
  logo: string;
  group?: string;
  url: string;
}

interface FavoriteData {
  [key: string]: {
    title: string;
    source_name: string;
    cover: string;
    save_time: number;
    origin: string;
  };
}

interface XhrRequestOptions {
  uri: string;
}

interface LiveChannel {
  id: string;
  tvgId: string;
  name: string;
  logo: string;
  group: string;
  url: string;
}

interface LiveSource {
  key: string;
  name: string;
  url: string;
  ua?: string;
  epg?: string;
  from: 'config' | 'custom';
  channelNumber?: number;
}

interface EpgProgram {
  start: string;
  end: string;
  title: string;
}

interface ProcessedProgram extends EpgProgram {
  startTime: number;
  endTime: number;
}

// --- Utils ---

const cleanEpgData = (programs: EpgProgram[]) => {
  if (!programs || programs.length === 0) return programs;

  const today = new Date();
  const todayStart = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate(),
  ).getTime();
  const todayEnd = todayStart + 86400000;

  const parsedPrograms: ProcessedProgram[] = programs.map((p) => ({
    ...p,
    startTime: parseCustomTimeFormat(p.start).getTime(),
    endTime: parseCustomTimeFormat(p.end).getTime(),
  }));

  const todayPrograms = parsedPrograms
    .filter(
      (p) =>
        (p.startTime >= todayStart && p.startTime < todayEnd) ||
        (p.endTime >= todayStart && p.endTime < todayEnd) ||
        (p.startTime < todayStart && p.endTime >= todayEnd),
    )
    .sort((a, b) => a.startTime - b.startTime);

  const cleanedPrograms: ProcessedProgram[] = [];

  for (const current of todayPrograms) {
    let hasOverlap = false;
    for (let i = 0; i < cleanedPrograms.length; i++) {
      const existing = cleanedPrograms[i];
      if (
        (current.startTime >= existing.startTime &&
          current.startTime < existing.endTime) ||
        (current.endTime > existing.startTime &&
          current.endTime <= existing.endTime) ||
        (current.startTime <= existing.startTime &&
          current.endTime >= existing.endTime)
      ) {
        hasOverlap = true;
        if (
          current.endTime - current.startTime <
          existing.endTime - existing.startTime
        ) {
          cleanedPrograms[i] = current;
        }
        break;
      }
    }
    if (!hasOverlap) cleanedPrograms.push(current);
  }

  return cleanedPrograms.map(({ startTime, endTime, ...rest }) => rest);
};

const getProxiedLogoUrl = (logoUrl: string, sourceKey?: string) => {
  if (!logoUrl) return '';
  if (logoUrl.startsWith('/')) return logoUrl;
  return `/api/proxy/logo?url=${encodeURIComponent(logoUrl)}&source=${sourceKey || ''}`;
};

// --- Custom Hooks ---

// 1. Core Data Hook
function useLiveCore() {
  const searchParams = useSearchParams();
  const [sources, setSources] = useState<LiveSource[]>([]);
  const [channels, setChannels] = useState<LiveChannel[]>([]);
  const [currentSource, setCurrentSource] = useState<LiveSource | null>(null);
  const [currentChannel, setCurrentChannel] = useState<LiveChannel | null>(
    null,
  );

  const [loadingStage, setLoadingStage] = useState<
    'loading' | 'fetching' | 'ready'
  >('loading');
  const [isChannelLoading, setIsChannelLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const abortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => {
      if (abortControllerRef.current) abortControllerRef.current.abort();
    };
  }, []);

  const fetchChannels = useCallback(
    async (source: LiveSource, targetChannelId?: string) => {
      if (abortControllerRef.current) abortControllerRef.current.abort();
      const controller = new AbortController();
      abortControllerRef.current = controller;

      try {
        setIsChannelLoading(true);
        setError(null);

        const res = await fetch(`/api/live/channels?source=${source.key}`, {
          signal: controller.signal,
        });
        const result = await res.json();

        if (!result.success)
          throw new Error(result.error || 'Failed to fetch channels');

        const rawChannels = result.data || [];

        if (rawChannels.length === 0) {
          setSources((prev) =>
            prev.map((s) =>
              s.key === source.key ? { ...s, channelNumber: 0 } : s,
            ),
          );
          setChannels([]);
          setCurrentChannel(null);
          return { channels: [], initialChannel: null };
        }

        const parsedChannels: LiveChannel[] = rawChannels.map(
          (c: ChannelApiResponse) => ({
            id: c.id,
            tvgId: c.tvgId || c.name,
            name: c.name,
            logo: c.logo,
            group: c.group || '其他',
            url: c.url,
          }),
        );

        setSources((prev) =>
          prev.map((s) =>
            s.key === source.key
              ? { ...s, channelNumber: parsedChannels.length }
              : s,
          ),
        );
        setChannels(parsedChannels);

        const initialChannel = targetChannelId
          ? parsedChannels.find((c) => c.id === targetChannelId) ||
            parsedChannels[0]
          : parsedChannels[0];

        setCurrentChannel(initialChannel);

        return { channels: parsedChannels, initialChannel };
      } catch (err: unknown) {
        if (err instanceof Error && err.name !== 'AbortError') {
          console.error(err);
          setError(err.message || 'Failed to load channels');
          setChannels([]);
        }
        return { channels: [], initialChannel: null };
      } finally {
        if (!controller.signal.aborted) {
          setIsChannelLoading(false);
          abortControllerRef.current = null;
        }
      }
    },
    [],
  );

  useEffect(() => {
    const controller = new AbortController();

    const init = async () => {
      try {
        setLoadingStage('fetching');
        const res = await fetch('/api/live/sources', {
          signal: controller.signal,
        });
        const result = await res.json();

        if (controller.signal.aborted) return;

        if (!result.success)
          throw new Error(result.error || 'Failed to load sources');

        const loadedSources = result.data || [];
        setSources(loadedSources);

        if (loadedSources.length > 0) {
          const urlSource = searchParams.get('source');
          const urlChannel = searchParams.get('id');

          const target =
            loadedSources.find((s: LiveSource) => s.key === urlSource) ||
            loadedSources[0];
          setCurrentSource(target);

          await fetchChannels(target, urlChannel || undefined);

          if (!controller.signal.aborted) {
            window.history.replaceState(null, '', window.location.pathname);
          }
        }

        if (!controller.signal.aborted) {
          setLoadingStage('ready');
        }
      } catch (e: unknown) {
        if (!controller.signal.aborted) {
          console.error(e);
          setError('System initialization failed.');
        }
      }
    };

    init();
    return () => controller.abort();
  }, [searchParams, fetchChannels]);

  return {
    sources,
    channels,
    currentSource,
    currentChannel,
    loadingStage,
    isChannelLoading,
    error,
    setCurrentSource,
    setCurrentChannel,
    fetchChannels,
  };
}

// Helper to guess stream type from URL
const guessType = (url: string) => {
  if (url.includes('.flv') || url.includes('/huya/') || url.includes('douyu') || url.includes('.xs')) return 'flv';
  if (url.includes('.m3u8')) return 'm3u8';
  return 'm3u8'; // default
};

// 2. Player State Hook (Updated with FLV check logic)
function usePlayerState(videoUrl: string, sourceKey?: string) {
  const [proxiedUrl, setProxiedUrl] = useState('');
  const [isStreamLoading, setIsStreamLoading] = useState(false);
  const [unsupportedType, setUnsupportedType] = useState<string | null>(null);
  const [streamType, setStreamType] = useState<
    'm3u8' | 'flv' | 'unknown' | null
  >(null);

  useEffect(() => {
    if (!videoUrl || !sourceKey) {
      setProxiedUrl('');
      setUnsupportedType(null);
      setIsStreamLoading(false);
      setStreamType(null);
      return;
    }

    const controller = new AbortController();
    setIsStreamLoading(true);
    setUnsupportedType(null);
    setProxiedUrl('');

    async function check() {
      try {
        const checkUrl = `/api/live/precheck?url=${encodeURIComponent(videoUrl)}&moontv-source=${sourceKey}`;
        const res = await fetch(checkUrl, { signal: controller.signal });
        const data = await res.json();

        if (!controller.signal.aborted) {
          let detected = data.type;
          
          // Fallback if detection fails or is unknown
          if (!detected || detected === 'unknown') {
             detected = guessType(videoUrl);
          }

          // Allow: m3u8, unknown, and flv (if you have the tech)
          if (
            detected !== 'm3u8' &&
            detected !== 'flv' &&
            detected !== 'unknown'
          ) {
            setUnsupportedType(detected);
          } else {
            setUnsupportedType(null);
            setStreamType(detected as 'm3u8' | 'flv' | 'unknown');
            // Construct proxy URL
            const typeParam = detected === 'flv' ? 'flv' : 'm3u8';
            setProxiedUrl(
              `/api/proxy/${typeParam}?url=${encodeURIComponent(videoUrl)}&moontv-source=${sourceKey}`,
            );
          }
        }
      } catch (e: unknown) {
        if (e instanceof Error && e.name !== 'AbortError') {
          console.warn('Precheck failed, attempting heuristic playback:', e);
          const fallbackType = guessType(videoUrl);
          setUnsupportedType(null);
          setStreamType(fallbackType as 'm3u8' | 'flv');
          const typeParam = fallbackType === 'flv' ? 'flv' : 'm3u8';
          setProxiedUrl(
            `/api/proxy/${typeParam}?url=${encodeURIComponent(videoUrl)}&moontv-source=${sourceKey}`,
          );
        }
      } finally {
        if (!controller.signal.aborted) setIsStreamLoading(false);
      }
    }

    check();
    return () => controller.abort();
  }, [videoUrl, sourceKey]);

  return { proxiedUrl, isStreamLoading, unsupportedType, streamType };
}

// 3. EPG Hook
function useEpg(sourceKey?: string, tvgId?: string) {
  const [epgData, setEpgData] = useState<{ programs: EpgProgram[] } | null>(
    null,
  );
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!sourceKey || !tvgId) {
      setEpgData(null);
      return;
    }

    const controller = new AbortController();
    setIsLoading(true);

    fetch(`/api/live/epg?source=${sourceKey}&tvgId=${tvgId}`, {
      signal: controller.signal,
    })
      .then((res) => res.json())
      .then((data) => {
        if (!controller.signal.aborted) {
          setEpgData(data.success ? data.data : null);
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) setEpgData(null);
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsLoading(false);
      });

    return () => controller.abort();
  }, [sourceKey, tvgId]);

  const processedPrograms = useMemo(
    () => (epgData ? cleanEpgData(epgData.programs) : []),
    [epgData],
  );

  return { programs: processedPrograms, isLoading };
}

// 4. Favorites Hook
function useFavorites(
  source?: LiveSource | null,
  channel?: LiveChannel | null,
) {
  const [isFavorite, setIsFavorite] = useState(false);

  useEffect(() => {
    if (!source || !channel) {
      setIsFavorite(false);
      return;
    }

    const sid = `live_${source.key}`;
    const cid = `live_${channel.id}`;

    checkIsFavorited(sid, cid).then(setIsFavorite);

    const unsub = subscribeToDataUpdates(
      'favoritesUpdated',
      (favs: FavoriteData) => {
        const key = generateStorageKey(sid, cid);
        setIsFavorite(!!favs[key]);
      },
    );
    return unsub;
  }, [source, channel]);

  const toggle = async () => {
    if (!source || !channel) return;
    const newVal = !isFavorite;
    setIsFavorite(newVal);

    try {
      const sid = `live_${source.key}`;
      const cid = `live_${channel.id}`;
      if (newVal) {
        await saveFavorite(sid, cid, {
          title: channel.name,
          source_name: source.name,
          cover: channel.logo,
          save_time: Date.now(),
          origin: 'live',
          year: '',
          total_episodes: 0,
        });
      } else {
        await deleteFavorite(sid, cid);
      }
    } catch {
      setIsFavorite(!newVal);
    }
  };

  return { isFavorite, toggle };
}

// --- Main Client Component ---

function LivePageClient() {
  const {
    sources,
    channels,
    currentSource,
    currentChannel,
    loadingStage,
    isChannelLoading,
    error,
    setCurrentSource,
    setCurrentChannel,
    fetchChannels,
  } = useLiveCore();

  // Passing streamType now to handle tech selection if needed
  const { proxiedUrl, isStreamLoading, unsupportedType, streamType } =
    usePlayerState(currentChannel?.url || '', currentSource?.key);

  const { programs, isLoading: isEpgLoading } = useEpg(
    currentSource?.key,
    currentChannel?.tvgId,
  );

  const { isFavorite, toggle: toggleFavorite } = useFavorites(
    currentSource,
    currentChannel,
  );

  const [activeTab, setActiveTab] = useState<'channels' | 'sources'>(
    'channels',
  );
  const [selectedGroup, setSelectedGroup] = useState<string>('');
  const [isChannelListCollapsed, setIsChannelListCollapsed] = useState(false);
  const [isSwitchingSource, setIsSwitchingSource] = useState(false);
  const [playerFocused, setPlayerFocused] = useState(false);

  const playerRef = useRef<Player | null>(null);
  const playerContainerRef = useRef<HTMLDivElement>(null);
  const channelListRef = useRef<HTMLDivElement>(null);
  const groupButtonRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const groupContainerRef = useRef<HTMLDivElement>(null);
  const sourceRef = useRef<LiveSource | null>(null);

  useEffect(() => {
    sourceRef.current = currentSource;
  }, [currentSource]);

  const groupedChannels = useMemo(() => {
    return channels.reduce(
      (acc, c) => {
        const g = c.group || '其他';
        if (!acc[g]) acc[g] = [];
        acc[g].push(c);
        return acc;
      },
      {} as Record<string, LiveChannel[]>,
    );
  }, [channels]);

  const groupKeys = useMemo(
    () => Object.keys(groupedChannels).sort(),
    [groupedChannels],
  );

  const filteredChannels = useMemo(() => {
    return selectedGroup ? groupedChannels[selectedGroup] || [] : channels;
  }, [selectedGroup, groupedChannels, channels]);

  const isIOS = useMemo(() => {
    if (typeof window === 'undefined') return false;
    return (
      /iPad|iPhone|iPod/.test(navigator.userAgent) && !('MSStream' in window)
    );
  }, []);

  const videoOptions = useMemo(
    () => ({
      autoplay: true,
      controls: true,
      responsive: true,
      fluid: false,
      liveui: true,
      html5: {
        vhs: {
          lowLatencyMode: true,
          overrideNative: !isIOS,
        },
      },
      // Always include flvjs in techOrder to support fallback or auto-detection
      techOrder: ['html5', 'flvjs'],
      controlBar: {
        pictureInPictureToggle: false,
      },
      flvjs: {
        mediaDataSource: {
          isLive: true,
          cors: true,
          withCredentials: false,
        },
      },
    }),
    [isIOS],
  );

  const scrollToChannel = useCallback((id: string) => {
    if (!channelListRef.current) return;
    const el = channelListRef.current.querySelector(
      `[data-channel-id="${id}"]`,
    );
    el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, []);

  // 1. Restore Mouse Wheel Horizontal Scroll
  useEffect(() => {
    const container = groupContainerRef.current;
    if (!container) return;

    const handleWheel = (e: WheelEvent) => {
      if (container.scrollWidth > container.clientWidth) {
        e.preventDefault();
        container.scrollLeft += e.deltaY;
      }
    };

    container.addEventListener('wheel', handleWheel, { passive: false });
    return () => container.removeEventListener('wheel', handleWheel);
  }, [groupKeys]); // Re-bind if keys change

  useEffect(() => {
    if (
      channels.length > 0 &&
      selectedGroup &&
      !groupedChannels[selectedGroup]
    ) {
      const fallback = groupKeys[0] || '';
      setSelectedGroup(fallback);
    }
  }, [channels, selectedGroup, groupedChannels, groupKeys]);

  const handleSourceChange = async (s: LiveSource) => {
    if (isSwitchingSource) return;
    setIsSwitchingSource(true);
    setSelectedGroup('');
    setCurrentSource(s);
    const { initialChannel } = await fetchChannels(s);
    if (initialChannel) {
      setSelectedGroup(initialChannel.group || '其他');
    }
    setIsSwitchingSource(false);
    setActiveTab('channels');
  };

  const handleChannelChange = (c: LiveChannel) => {
    if (isSwitchingSource) return;
    setCurrentChannel(c);
    scrollToChannel(c.id);
  };

  const handleGroupChange = (g: string) => {
    setSelectedGroup(g);
    const btn = groupButtonRefs.current.get(g);
    btn?.scrollIntoView({
      behavior: 'smooth',
      block: 'nearest',
      inline: 'center',
    });
    if (channelListRef.current) channelListRef.current.scrollTop = 0;
  };

  const handlePlayerReady = useCallback((player: Player) => {
    playerRef.current = player;

    // 2. FLV Support: Cleanup logic logic is handled internally by Video.js tech,
    // but we can ensure clean detach on unmount or source change via VideoJsPlayer component.

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const vhs = (player as any).tech?.({ IWillNotUseThisInPlugins: true })?.vhs;
    if (vhs?.xhr) {
      vhs.xhr.beforeRequest = (options: XhrRequestOptions) => {
        try {
          const isDirectConnect =
            localStorage.getItem('liveDirectConnect') === 'true';
          if (isDirectConnect) {
            const base = document.baseURI || window.location.href;
            const u = new URL(options.uri, base);
            const currentKey = sourceRef.current?.key;
            if (currentKey && !u.searchParams.has('moontv-source')) {
              u.searchParams.set('moontv-source', currentKey);
            }
            if (!u.searchParams.has('allowCORS')) {
              u.searchParams.set('allowCORS', 'true');
            }
            options.uri = u.toString();
          }
        } catch {
          /* ignore */
        }
        return options;
      };
    }
  }, []);

  useEffect(() => {
    const handleKeys = (e: KeyboardEvent) => {
      if (['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement).tagName))
        return;
      const p = playerRef.current;
      if (!p) return;

      if (playerFocused) {
        if (e.key === 'ArrowUp') {
          e.preventDefault();
          p.volume(Math.min(1, (p.volume() ?? 0.5) + 0.1));
        }
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          p.volume(Math.max(0, (p.volume() ?? 0.5) - 0.1));
        }
        if (e.key === ' ') {
          e.preventDefault();
          if (p.paused()) {
            p.play();
          } else {
            p.pause();
          }
        }
      }
    };
    document.addEventListener('keydown', handleKeys);
    return () => document.removeEventListener('keydown', handleKeys);
  }, [playerFocused]);

  useEffect(() => {
    const handleGlobalClick = (e: Event) => {
      if (
        playerContainerRef.current &&
        !playerContainerRef.current.contains(e.target as Node)
      ) {
        setPlayerFocused(false);
      }
    };
    document.addEventListener('pointerdown', handleGlobalClick);
    return () => document.removeEventListener('pointerdown', handleGlobalClick);
  }, []);

  useEffect(() => {
    if (currentChannel) {
      if (!selectedGroup) setSelectedGroup(currentChannel.group || '其他');
      requestAnimationFrame(() => scrollToChannel(currentChannel.id));
    }
  }, [currentChannel, selectedGroup, scrollToChannel]);

  if (loadingStage !== 'ready' && !error) {
    return (
      <PageLayout activePath='/live'>
        <div className='flex items-center justify-center min-h-screen'>
          <div className='text-center'>
            <div className='text-4xl mb-4 animate-bounce'>📺</div>
            <p className='animate-pulse'>
              {loadingStage === 'fetching'
                ? 'Fetching sources...'
                : 'Initializing...'}
            </p>
          </div>
        </div>
      </PageLayout>
    );
  }

  if (error) {
    return (
      <PageLayout activePath='/live'>
        <div className='flex items-center justify-center min-h-screen text-red-500 gap-4'>
          <span className='font-bold'>Error:</span> {error}
          <button
            onClick={() => window.location.reload()}
            className='underline hover:text-red-700'
          >
            Retry
          </button>
        </div>
      </PageLayout>
    );
  }

  return (
    <PageLayout activePath='/live'>
      <style>{`
        .video-js { width: 100% !important; height: 100% !important; overflow: hidden; }
        .video-js .vjs-tech { width: 100% !important; height: 100% !important; object-fit: contain; }
        .video-js .vjs-control-bar { display: flex !important; width: 100%; position: absolute; bottom: 0; left: 0; z-index: 2; }
        .video-js .vjs-progress-control { flex: 1 1 auto; width: auto; min-width: 0; }
        .video-js.vjs-fluid { padding-top: 0 !important; }
      `}</style>

      <div className='flex flex-col gap-3 py-4 px-5 lg:px-12 2xl:px-20'>
        <div className='py-1'>
          <h1 className='text-xl font-semibold flex items-center gap-2'>
            <Radio className='w-5 h-5 text-blue-500' />
            <span>
              {currentSource?.name}{' '}
              {currentChannel && `> ${currentChannel.name}`}
            </span>
          </h1>
        </div>

        <div className='space-y-2'>
          <div className='hidden lg:flex justify-end'>
            <button
              onClick={() => setIsChannelListCollapsed(!isChannelListCollapsed)}
              className='text-xs px-3 py-1 bg-gray-100 rounded-full hover:bg-gray-200 transition-colors'
            >
              {isChannelListCollapsed ? 'Show List' : 'Hide List'}
            </button>
          </div>

          <div
            className={`grid gap-4 lg:h-[600px] transition-all duration-300 ${isChannelListCollapsed ? 'grid-cols-1' : 'grid-cols-1 md:grid-cols-4'}`}
          >
            <div
              ref={playerContainerRef}
              className={`h-full ${isChannelListCollapsed ? 'col-span-1' : 'md:col-span-3'} outline-none`}
              tabIndex={0}
              onFocusCapture={() => setPlayerFocused(true)}
              onBlurCapture={(e) => {
                if (
                  playerContainerRef.current?.contains(e.relatedTarget as Node)
                )
                  return;
                setPlayerFocused(false);
              }}
              onPointerDown={(e) => {
                setPlayerFocused(true);
                e.currentTarget.focus();
              }}
            >
              <div
                className={`relative w-full h-[300px] lg:h-full bg-black rounded-xl overflow-hidden transition-all ${playerFocused ? 'ring-2 ring-blue-500/50' : ''}`}
              >
                {proxiedUrl && !unsupportedType && (
                  <VideoJsPlayer
                    key={proxiedUrl}
                    url={proxiedUrl}
                    poster={getProxiedLogoUrl(
                      currentChannel?.logo || '',
                      currentSource?.key,
                    )}
                    type={streamType === 'flv' ? 'video/x-flv' : 'application/x-mpegURL'}
                    autoPlay={true}
                    onReady={handlePlayerReady}
                    className='w-full h-full'
                    isLive={true}
                    videoJsOptions={videoOptions}
                  />
                )}

                {isStreamLoading && (
                  <div className='absolute inset-0 flex items-center justify-center bg-black/80 text-white z-10'>
                    <div className='flex flex-col items-center'>
                      <div className='w-8 h-8 border-4 border-white/20 border-t-white rounded-full animate-spin mb-2' />
                      <div>Loading Stream...</div>
                    </div>
                  </div>
                )}

                {unsupportedType && (
                  <div className='absolute inset-0 flex items-center justify-center bg-black/90 text-red-500 z-10 flex-col'>
                    <h3 className='text-xl font-bold'>Format Not Supported</h3>
                    <p>{unsupportedType.toUpperCase()}</p>
                  </div>
                )}
              </div>
            </div>

            <div
              className={`h-[400px] lg:h-full flex flex-col bg-gray-50 dark:bg-gray-800 rounded-xl overflow-hidden border border-gray-200 dark:border-gray-700 ${isChannelListCollapsed ? 'hidden' : 'block'}`}
            >
              <div className='flex border-b border-gray-200 dark:border-gray-700'>
                <button
                  onClick={() => setActiveTab('channels')}
                  className={`flex-1 py-3 font-medium transition-colors ${activeTab === 'channels' ? 'text-green-600 border-b-2 border-green-600' : 'text-gray-500 hover:text-gray-700'}`}
                >
                  Channels
                </button>
                <button
                  onClick={() => setActiveTab('sources')}
                  className={`flex-1 py-3 font-medium transition-colors ${activeTab === 'sources' ? 'text-green-600 border-b-2 border-green-600' : 'text-gray-500 hover:text-gray-700'}`}
                >
                  Sources
                </button>
              </div>

              {activeTab === 'channels' ? (
                <>
                  <div
                    className='flex overflow-x-auto p-2 gap-2 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800/50'
                    ref={groupContainerRef}
                  >
                    {groupKeys.map((g) => (
                      <button
                        key={g}
                        ref={(el) => {
                          if (el) groupButtonRefs.current.set(g, el);
                          else groupButtonRefs.current.delete(g);
                        }}
                        onClick={() => handleGroupChange(g)}
                        className={`whitespace-nowrap px-3 py-1 rounded-full text-sm transition-colors ${selectedGroup === g ? 'bg-green-600 text-white' : 'bg-gray-200 dark:bg-gray-700 hover:bg-gray-300'}`}
                      >
                        {g}
                      </button>
                    ))}
                  </div>

                  <div
                    className='flex-1 overflow-y-auto p-2 space-y-1 scrollbar-thin'
                    ref={channelListRef}
                  >
                    {isChannelLoading ? (
                      <div className='p-4 text-center text-gray-500'>
                        Loading channels...
                      </div>
                    ) : (
                      filteredChannels.map((c) => (
                        <button
                          key={c.id}
                          data-channel-id={c.id}
                          onClick={() => handleChannelChange(c)}
                          className={`w-full text-left p-2 rounded flex items-center gap-3 transition-colors ${c.id === currentChannel?.id ? 'bg-green-100 dark:bg-green-900/40 text-green-900 dark:text-green-100' : 'hover:bg-gray-200 dark:hover:bg-gray-700'}`}
                        >
                          <div className='w-8 h-8 bg-gray-200 dark:bg-gray-600 rounded overflow-hidden shrink-0 flex items-center justify-center'>
                            {c.logo ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img
                                src={getProxiedLogoUrl(
                                  c.logo,
                                  currentSource?.key,
                                )}
                                className='w-full h-full object-contain'
                                loading='lazy'
                                alt={c.name}
                              />
                            ) : (
                              <Tv className='w-4 h-4 opacity-50' />
                            )}
                          </div>
                          <div className='truncate flex-1'>
                            <div className='text-sm font-medium'>{c.name}</div>
                          </div>
                        </button>
                      ))
                    )}
                  </div>
                </>
              ) : (
                <div className='flex-1 overflow-y-auto p-2 space-y-2'>
                  {sources.map((s) => (
                    <button
                      key={s.key}
                      onClick={() => handleSourceChange(s)}
                      className={`w-full text-left p-3 rounded bg-white dark:bg-gray-700/50 flex items-center gap-3 border border-transparent transition-all ${currentSource?.key === s.key ? 'border-green-500 bg-green-50 dark:bg-green-900/20' : 'hover:border-gray-300'}`}
                    >
                      <Radio className='w-6 h-6 shrink-0 text-gray-400' />
                      <div>
                        <div className='font-medium'>{s.name}</div>
                        <div className='text-xs text-gray-500'>
                          {s.channelNumber || 0} channels
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {currentChannel && (
            <div className='mt-4'>
              <div className='flex items-center justify-between mb-4'>
                <div className='flex items-center gap-3 overflow-hidden'>
                  <div className='w-12 h-12 bg-gray-200 dark:bg-gray-700 rounded-lg shrink-0 flex items-center justify-center overflow-hidden'>
                    {currentChannel.logo ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={getProxiedLogoUrl(
                          currentChannel.logo,
                          currentSource?.key,
                        )}
                        className='w-full h-full object-contain'
                        alt={currentChannel.name}
                      />
                    ) : (
                      <Tv className='w-6 h-6 opacity-50' />
                    )}
                  </div>
                  <h2 className='text-xl font-bold truncate'>
                    {currentChannel.name}
                  </h2>
                </div>
                <button
                  onClick={toggleFavorite}
                  className='hover:scale-110 transition-transform'
                >
                  <FavoriteIcon filled={isFavorite} />
                </button>
              </div>
              <EpgScrollableRow
                programs={programs}
                currentTime={new Date()}
                isLoading={isEpgLoading}
              />
            </div>
          )}
        </div>
      </div>
    </PageLayout>
  );
}

const FavoriteIcon = ({ filled }: { filled: boolean }) =>
  filled ? (
    <Heart fill='#ef4444' className='text-red-500' />
  ) : (
    <Heart className='text-gray-500' />
  );

export default function LivePage() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <LivePageClient />
    </Suspense>
  );
}
