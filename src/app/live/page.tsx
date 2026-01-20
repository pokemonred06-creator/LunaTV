'use client';

import { AlertTriangle, Heart, Loader2, Radio, Tv } from 'lucide-react';
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

// --- Interfaces ---

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

  const now = new Date();
  const startOfDay = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
  ).getTime();
  const endOfDay = startOfDay + 86400000;

  const validPrograms: ProcessedProgram[] = [];
  for (const p of programs) {
    const s = parseCustomTimeFormat(p.start).getTime();
    const e = parseCustomTimeFormat(p.end).getTime();
    if (s < endOfDay && e > startOfDay) {
      validPrograms.push({ ...p, startTime: s, endTime: e });
    }
  }

  validPrograms.sort((a, b) => a.startTime - b.startTime);

  const result: ProcessedProgram[] = [];
  for (const current of validPrograms) {
    if (result.length === 0) {
      result.push(current);
      continue;
    }
    const prev = result[result.length - 1];
    if (current.startTime < prev.endTime) {
      prev.endTime = current.startTime;
      if (prev.startTime >= prev.endTime) {
        result.pop();
      }
    }
    result.push(current);
  }
  return result.map(({ startTime, endTime, ...rest }) => rest);
};

const getProxiedLogoUrl = (logoUrl: string, sourceKey?: string) => {
  if (!logoUrl) return '';
  if (logoUrl.startsWith('/')) return logoUrl;
  return `/api/proxy/logo?url=${encodeURIComponent(logoUrl)}&source=${sourceKey || ''}`;
};

function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState(value);
  useEffect(() => {
    const handler = setTimeout(() => setDebouncedValue(value), delay);
    return () => clearTimeout(handler);
  }, [value, delay]);
  return debouncedValue;
}

// --- Logic Hooks ---

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

  const channelsAbortRef = useRef<AbortController | null>(null);

  useEffect(() => () => channelsAbortRef.current?.abort(), []);

  const fetchChannels = useCallback(
    async (source: LiveSource, targetChannelId?: string) => {
      channelsAbortRef.current?.abort();
      const controller = new AbortController();
      channelsAbortRef.current = controller;

      try {
        setIsChannelLoading(true);
        setError(null);

        const res = await fetch(`/api/live/channels?source=${source.key}`, {
          signal: controller.signal,
        });

        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const result = await res.json();

        if (controller.signal.aborted)
          return { channels: [], initialChannel: null };
        if (!result.success)
          throw new Error(result.error || 'Failed to fetch channels');

        const rawChannels = result.data || [];
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
        if (!controller.signal.aborted) {
          console.error(err);
          setChannels([]);
          setError(err instanceof Error ? err.message : 'Channel load failed');
        }
        return { channels: [], initialChannel: null };
      } finally {
        if (!controller.signal.aborted) {
          setIsChannelLoading(false);
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

        if (!res.ok) throw new Error(`HTTP ${res.status}`);
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
        if (!controller.signal.aborted) setLoadingStage('ready');
      } catch (e) {
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

const guessType = (url: string) => {
  if (/\.(flv|xs)(\?|$)/i.test(url) || /huya|douyu/i.test(url)) return 'flv';
  return 'm3u8';
};

function usePlayerState(videoUrl: string, sourceKey?: string) {
  const debouncedUrl = useDebounce(videoUrl, 500);
  const debouncedKey = useDebounce(sourceKey, 500);

  const [proxiedUrl, setProxiedUrl] = useState('');
  const [isStreamLoading, setIsStreamLoading] = useState(false);
  const [unsupportedType, setUnsupportedType] = useState<string | null>(null);
  const [streamType, setStreamType] = useState<
    'm3u8' | 'flv' | 'unknown' | null
  >(null);

  useEffect(() => {
    if (videoUrl !== debouncedUrl) {
      setIsStreamLoading(true);
      return;
    }

    if (!debouncedUrl || !debouncedKey) {
      setProxiedUrl('');
      setIsStreamLoading(false);
      return;
    }

    const controller = new AbortController();
    setIsStreamLoading(true);
    setUnsupportedType(null);

    const check = async () => {
      try {
        const checkUrl = `/api/live/precheck?url=${encodeURIComponent(debouncedUrl)}&moontv-source=${debouncedKey}`;
        const res = await fetch(checkUrl, { signal: controller.signal });
        const data = await res.json();

        if (controller.signal.aborted) return;
        let detected = data.type;
        if (!detected || detected === 'unknown')
          detected = guessType(debouncedUrl);

        if (
          detected !== 'm3u8' &&
          detected !== 'flv' &&
          detected !== 'unknown'
        ) {
          setUnsupportedType(detected);
        } else {
          setStreamType(detected as 'm3u8' | 'flv');
          const typeParam = detected === 'flv' ? 'flv' : 'm3u8';
          setProxiedUrl(
            `/api/proxy/${typeParam}?url=${encodeURIComponent(debouncedUrl)}&moontv-source=${debouncedKey}`,
          );
        }
      } catch (e) {
        if ((e as Error).name !== 'AbortError') {
          const fallback = guessType(debouncedUrl);
          setStreamType(fallback as 'm3u8' | 'flv');
          setProxiedUrl(
            `/api/proxy/${fallback === 'flv' ? 'flv' : 'm3u8'}?url=${encodeURIComponent(debouncedUrl)}&moontv-source=${debouncedKey}`,
          );
        }
      } finally {
        if (!controller.signal.aborted) setIsStreamLoading(false);
      }
    };

    check();
    return () => controller.abort();
  }, [debouncedUrl, debouncedKey, videoUrl]);

  return { proxiedUrl, isStreamLoading, unsupportedType, streamType };
}

function useEpg(sourceKey?: string, tvgId?: string) {
  const debouncedKey = useDebounce(sourceKey, 1000);
  const debouncedId = useDebounce(tvgId, 1000);
  const [epgData, setEpgData] = useState<{ programs: EpgProgram[] } | null>(
    null,
  );
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!debouncedKey || !debouncedId) {
      setEpgData(null);
      return;
    }
    const controller = new AbortController();
    setIsLoading(true);
    fetch(`/api/live/epg?source=${debouncedKey}&tvgId=${debouncedId}`, {
      signal: controller.signal,
    })
      .then((res) => res.json())
      .then((data) => {
        if (!controller.signal.aborted)
          setEpgData(data.success ? data.data : null);
      })
      .catch(() => {
        if (!controller.signal.aborted) setEpgData(null);
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsLoading(false);
      });
    return () => controller.abort();
  }, [debouncedKey, debouncedId]);

  const programs = useMemo(
    () => (epgData ? cleanEpgData(epgData.programs) : []),
    [epgData],
  );
  return { programs, isLoading };
}

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
    return subscribeToDataUpdates('favoritesUpdated', (favs: FavoriteData) => {
      const key = generateStorageKey(sid, cid);
      setIsFavorite(!!favs[key]);
    });
  }, [source, channel]);

  const toggle = async () => {
    if (!source || !channel) return;
    const sid = `live_${source.key}`;
    const cid = `live_${channel.id}`;
    const newVal = !isFavorite;
    setIsFavorite(newVal);
    try {
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

// --- Component ---

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
  const [playerFocused, setPlayerFocused] = useState(false);
  const [isSwitchingSource, setIsSwitchingSource] = useState(false);

  const playerRef = useRef<Player | null>(null);
  const playerWrapperRef = useRef<HTMLDivElement>(null);
  const channelListRef = useRef<HTMLDivElement>(null);
  const groupButtonRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const sourceRef = useRef<LiveSource | null>(null);

  useEffect(() => {
    sourceRef.current = currentSource;
  }, [currentSource]);

  const groupedChannels = useMemo(() => {
    const groups: Record<string, LiveChannel[]> = {};
    channels.forEach((c) => {
      const g = c.group || '其他';
      if (!groups[g]) groups[g] = [];
      groups[g].push(c);
    });
    return groups;
  }, [channels]);

  const groupKeys = useMemo(
    () => Object.keys(groupedChannels).sort(),
    [groupedChannels],
  );
  const filteredChannels = useMemo(
    () => (selectedGroup ? groupedChannels[selectedGroup] || [] : channels),
    [selectedGroup, groupedChannels, channels],
  );

  const videoOptions = useMemo(
    () => ({
      autoplay: true,
      controls: true,
      responsive: true,
      fluid: false, // We control sizing via CSS
      liveui: true,
      html5: {
        hls: { overrideNative: false },
        nativeVideoTracks: false,
        nativeAudioTracks: false,
        nativeTextTracks: false,
      },
      controlBar: { pictureInPictureToggle: false },
      techOrder: ['html5', 'flvjs'],
      flvjs: {
        mediaDataSource: { isLive: true, cors: true, withCredentials: false },
      },
    }),
    [],
  );

  const scrollToChannel = useCallback((id: string) => {
    if (!channelListRef.current) return;
    const el = channelListRef.current.querySelector(
      `[data-channel-id="${id}"]`,
    );
    el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, []);

  // Sync group
  useEffect(() => {
    if (
      channels.length > 0 &&
      selectedGroup &&
      !groupedChannels[selectedGroup]
    ) {
      setSelectedGroup(groupKeys[0] || '');
    }
  }, [channels, selectedGroup, groupedChannels, groupKeys]);

  const handleSourceChange = async (s: LiveSource) => {
    if (isSwitchingSource || s.key === currentSource?.key) return;
    setIsSwitchingSource(true);
    setSelectedGroup('');
    setCurrentSource(s);
    const { initialChannel } = await fetchChannels(s);
    if (initialChannel) setSelectedGroup(initialChannel.group || '其他');
    setIsSwitchingSource(false);
    setActiveTab('channels');
  };

  const handleChannelChange = (c: LiveChannel) => {
    if (isSwitchingSource || c.id === currentChannel?.id) return;
    setCurrentChannel(c);
    scrollToChannel(c.id);
  };

  const handleGroupChange = (g: string) => {
    setSelectedGroup(g);
    groupButtonRefs.current.get(g)?.scrollIntoView({
      behavior: 'smooth',
      block: 'nearest',
      inline: 'center',
    });
    if (channelListRef.current) channelListRef.current.scrollTop = 0;
  };

  const handlePlayerReady = useCallback((player: Player) => {
    playerRef.current = player;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const vhs = (player as any).tech?.({ IWillNotUseThisInPlugins: true })?.vhs;
    if (vhs?.xhr) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      vhs.xhr.beforeRequest = (options: any) => {
        try {
          if (localStorage.getItem('liveDirectConnect') === 'true') {
            const u = new URL(options.uri, document.baseURI);
            if (
              sourceRef.current?.key &&
              !u.searchParams.has('moontv-source')
            ) {
              u.searchParams.set('moontv-source', sourceRef.current.key);
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

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!playerRef.current) return;
    const p = playerRef.current;
    switch (e.key) {
      case 'ArrowUp':
        e.preventDefault();
        p.volume(Math.min(1, (p.volume() ?? 0.5) + 0.1));
        break;
      case 'ArrowDown':
        e.preventDefault();
        p.volume(Math.max(0, (p.volume() ?? 0.5) - 0.1));
        break;
      case ' ':
      case 'k':
        e.preventDefault();
        if (p.paused()) p.play();
        else p.pause();
        break;
      case 'm':
        e.preventDefault();
        p.muted(!p.muted());
        break;
    }
  };

  // Initial scroll
  useEffect(() => {
    if (currentChannel && !isChannelLoading) {
      if (!selectedGroup) setSelectedGroup(currentChannel.group || '其他');
      const timer = setTimeout(() => scrollToChannel(currentChannel.id), 100);
      return () => clearTimeout(timer);
    }
  }, [currentChannel, isChannelLoading, selectedGroup, scrollToChannel]);

  if (loadingStage !== 'ready' && !error) {
    return (
      <PageLayout activePath='/live'>
        <div className='flex flex-col items-center justify-center min-h-[60vh] text-gray-500'>
          <Loader2 className='w-12 h-12 mb-4 animate-spin text-blue-500' />
          <p className='animate-pulse font-medium'>
            {loadingStage === 'fetching'
              ? 'Loading Live Sources...'
              : 'Initializing Channels...'}
          </p>
        </div>
      </PageLayout>
    );
  }

  if (error) {
    return (
      <PageLayout activePath='/live'>
        <div className='flex flex-col items-center justify-center min-h-[60vh] text-red-500 gap-4'>
          <AlertTriangle className='w-16 h-16' />
          <h2 className='text-xl font-bold'>System Error</h2>
          <p className='text-gray-600 dark:text-gray-400 max-w-md text-center'>
            {error}
          </p>
          <button
            onClick={() => window.location.reload()}
            className='px-4 py-2 bg-red-100 hover:bg-red-200 text-red-700 rounded-lg transition-colors'
          >
            Reload Page
          </button>
        </div>
      </PageLayout>
    );
  }

  return (
    <PageLayout activePath='/live'>
      {/* 
        LAYOUT STRATEGY (Attempt #3 - Robust Fix):
        Mobile: Flex-Col. Player Top (Sticky). Info Middle. List Bottom (fills rest).
        Desktop: Flex-Row. Player+Info Left. List Right (Sidebar).
        No 'hidden' classes depending on state to ensure visibility.
      */}
      {/* OUTER CONTAINER: Enforce full viewport height minus header */}
      <div className='flex flex-col lg:flex-row h-[calc(100vh-64px)] w-full overflow-hidden'>
        {/* === LEFT PANE: PLAYER & INFO === 
            Mobile: flex-none (take only natural height). 
            Desktop: flex-1 (grow to fill width), h-full (fill height).
            removed 'overflow-y-auto' so mobile doesn't scroll this container.
        */}
        <div className='flex-none lg:flex-1 flex flex-col min-w-0 bg-black relative lg:h-full overflow-hidden'>
          {/* PLAYER WRAPPER: Removed sticky, just relative now */}
          <div
            ref={playerWrapperRef}
            className={`
              relative z-30
              w-full shrink-0
              aspect-video lg:aspect-auto lg:flex-1
              bg-black overflow-hidden
              transition-ring duration-200
              ${playerFocused ? 'ring-2 ring-blue-500/50' : ''}
              [&_.video-js]:w-full [&_.video-js]:h-full
              [&_.vjs-tech]:object-contain
            `}
            tabIndex={0}
            onKeyDown={handleKeyDown}
            onFocus={() => setPlayerFocused(true)}
            onBlur={() => setPlayerFocused(false)}
            onMouseDown={() => {
              setPlayerFocused(true);
              playerWrapperRef.current?.focus();
            }}
          >
            {proxiedUrl && !unsupportedType ? (
              <VideoJsPlayer
                key={proxiedUrl}
                url={proxiedUrl}
                poster={getProxiedLogoUrl(
                  currentChannel?.logo || '',
                  currentSource?.key,
                )}
                type={
                  streamType === 'flv' ? 'video/x-flv' : 'application/x-mpegURL'
                }
                autoPlay={true}
                onReady={handlePlayerReady}
                className='w-full h-full'
                isLive={true}
                videoJsOptions={videoOptions}
              />
            ) : (
              <div className='absolute inset-0 flex items-center justify-center text-gray-500'>
                {unsupportedType ? (
                  <div className='text-center text-red-400'>
                    <AlertTriangle className='w-10 h-10 mx-auto mb-2' />
                    <p>Format Not Supported: {unsupportedType}</p>
                  </div>
                ) : (
                  <p>No Signal</p>
                )}
              </div>
            )}

            {/* Overlay Loader */}
            {isStreamLoading && (
              <div className='absolute inset-0 flex items-center justify-center bg-black/60 backdrop-blur-sm text-white z-20 pointer-events-none'>
                <div className='flex flex-col items-center gap-2'>
                  <Loader2 className='w-8 h-8 animate-spin' />
                  <span className='text-sm font-medium'>Connecting...</span>
                </div>
              </div>
            )}
          </div>

          {/* INFO BAR: shrink-0 ensures it doesn't collapse if space is tight */}
          <div className='shrink-0 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 lg:border-t lg:border-b-0 p-4 relative z-20'>
            {/* ... Info Content ... */}
            {currentChannel ? (
              <>
                <div className='flex items-center justify-between mb-4 gap-4'>
                  <div className='flex items-center gap-3 overflow-hidden min-w-0'>
                    <div className='w-10 h-10 sm:w-12 sm:h-12 bg-gray-50 dark:bg-gray-800 rounded-lg shrink-0 flex items-center justify-center p-1 border border-gray-100 dark:border-gray-700'>
                      {currentChannel.logo ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={getProxiedLogoUrl(
                            currentChannel.logo,
                            currentSource?.key,
                          )}
                          className='w-full h-full object-contain'
                          alt={currentChannel.name}
                          loading='lazy'
                        />
                      ) : (
                        <Tv className='w-6 h-6 opacity-30' />
                      )}
                    </div>
                    <div className='min-w-0 flex-1'>
                      <h2 className='text-base sm:text-lg font-bold truncate text-gray-900 dark:text-gray-100 leading-tight'>
                        {currentChannel.name}
                      </h2>
                      <div className='flex items-center gap-2 text-xs text-gray-500 mt-0.5'>
                        <span className='px-1.5 py-0.5 bg-gray-100 dark:bg-gray-800 rounded'>
                          {currentSource?.name}
                        </span>
                        <span className='truncate opacity-70'>
                          {currentChannel.group}
                        </span>
                      </div>
                    </div>
                  </div>

                  <button
                    onClick={toggleFavorite}
                    className={`p-2.5 rounded-full transition-colors active:scale-95 ${
                      isFavorite
                        ? 'bg-red-50 dark:bg-red-900/20 text-red-500'
                        : 'bg-gray-100 dark:bg-gray-800 text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'
                    }`}
                    title='Toggle Favorite'
                  >
                    <Heart
                      className={`w-5 h-5 ${isFavorite ? 'fill-current' : ''}`}
                    />
                  </button>
                </div>
                <EpgScrollableRow
                  programs={programs}
                  currentTime={new Date()}
                  isLoading={isEpgLoading}
                />
              </>
            ) : (
              <div className='text-gray-500 text-center py-4'>
                Select a channel
              </div>
            )}
          </div>
        </div>

        {/* === RIGHT PANE: CHANNEL LIST === 
            Mobile: flex-1 (GROW to fill remaining vertical space).
            Desktop: flex-none (Fixed width), h-full (Fill height).
        */}
        <div
          className='
            flex flex-col 
            bg-white dark:bg-gray-900 
            border-t lg:border-t-0 lg:border-l border-gray-200 dark:border-gray-800
            w-full lg:w-80 lg:shrink-0
            h-full lg:h-auto
            overflow-hidden
            flex-1 lg:flex-none
          '
        >
          {/* TABS */}
          <div className='flex border-b border-gray-200 dark:border-gray-800 shrink-0'>
            <button
              onClick={() => setActiveTab('channels')}
              className={`flex-1 py-3 text-sm font-medium transition-colors ${activeTab === 'channels' ? 'text-blue-600 border-b-2 border-blue-600 bg-blue-50/50 dark:bg-blue-900/10' : 'text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-700/50'}`}
            >
              Channels
            </button>
            <button
              onClick={() => setActiveTab('sources')}
              className={`flex-1 py-3 text-sm font-medium transition-colors ${activeTab === 'sources' ? 'text-blue-600 border-b-2 border-blue-600 bg-blue-50/50 dark:bg-blue-900/10' : 'text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-700/50'}`}
            >
              Sources
            </button>
          </div>

          {/* LIST CONTENT (Scrollable) */}
          {activeTab === 'channels' ? (
            <>
              {/* Groups Sticky Header */}
              <div className='overflow-x-auto p-2 border-b border-gray-100 dark:border-gray-800 scrollbar-hide shrink-0 bg-white dark:bg-gray-900'>
                <div className='flex gap-2'>
                  {groupKeys.map((g) => (
                    <button
                      key={g}
                      ref={(el) => {
                        if (el) groupButtonRefs.current.set(g, el);
                        else groupButtonRefs.current.delete(g);
                      }}
                      onClick={() => handleGroupChange(g)}
                      className={`whitespace-nowrap px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${selectedGroup === g ? 'bg-blue-600 text-white shadow-md' : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'}`}
                    >
                      {g}
                    </button>
                  ))}
                </div>
              </div>

              {/* Channel Items */}
              <div
                className='flex-1 overflow-y-auto p-2 scrollbar-thin scrollbar-thumb-gray-200 dark:scrollbar-thumb-gray-700'
                ref={channelListRef}
              >
                {isChannelLoading ? (
                  <div className='flex flex-col items-center justify-center h-32 text-gray-400'>
                    <Loader2 className='w-6 h-6 animate-spin mb-2' />
                    <span className='text-xs'>Loading List...</span>
                  </div>
                ) : filteredChannels.length === 0 ? (
                  <div className='p-4 text-center text-sm text-gray-500'>
                    No channels in this group.
                  </div>
                ) : (
                  <div className='space-y-1 pb-safe'>
                    {filteredChannels.map((c) => (
                      <button
                        key={c.id}
                        data-channel-id={c.id}
                        onClick={() => handleChannelChange(c)}
                        className={`w-full text-left p-2 rounded-lg flex items-center gap-3 transition-all ${c.id === currentChannel?.id ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 ring-1 ring-blue-200 dark:ring-blue-800' : 'hover:bg-gray-50 dark:hover:bg-gray-800'}`}
                      >
                        <div className='w-8 h-8 bg-gray-100 dark:bg-gray-800 rounded-md overflow-hidden shrink-0 flex items-center justify-center'>
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
                            <Tv className='w-4 h-4 opacity-30' />
                          )}
                        </div>
                        <span className='text-sm font-medium truncate'>
                          {c.name}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className='flex-1 overflow-y-auto p-2 space-y-2 scrollbar-thin scrollbar-thumb-gray-200 dark:scrollbar-thumb-gray-700 pb-safe'>
              {sources.map((s) => (
                <button
                  key={s.key}
                  onClick={() => handleSourceChange(s)}
                  className={`w-full text-left p-3 rounded-xl flex items-center gap-3 border transition-all ${currentSource?.key === s.key ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20 shadow-sm' : 'border-transparent bg-gray-50 dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-700'}`}
                >
                  <div
                    className={`p-2 rounded-full ${currentSource?.key === s.key ? 'bg-blue-100 text-blue-600' : 'bg-gray-200 dark:bg-gray-700 text-gray-500'}`}
                  >
                    <Radio className='w-5 h-5' />
                  </div>
                  <div>
                    <div className='font-semibold text-sm'>{s.name}</div>
                    <div className='text-xs text-gray-500 mt-0.5'>
                      {s.channelNumber ?? 0} channels
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </PageLayout>
  );
}

export default function LivePage() {
  return (
    <Suspense
      fallback={
        <div className='h-screen w-full flex items-center justify-center bg-gray-50'>
          <Loader2 className='animate-spin w-8 h-8 text-gray-400' />
        </div>
      }
    >
      <LivePageClient />
    </Suspense>
  );
}
