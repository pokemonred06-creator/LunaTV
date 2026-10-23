'use client';

import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Heart,
  Loader2,
  Radio,
  Tv,
} from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import Player from 'video.js/dist/types/player';
import 'videojs-flvjs';

import {
  deleteFavorite,
  generateStorageKey,
  isFavorited as checkIsFavorited,
  saveFavorite,
  subscribeToDataUpdates,
} from '@/lib/db.client';
import {
  guessLiveStreamType,
  liveStreamMimeType,
  type LiveStreamType,
} from '@/lib/live-stream';
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

type ChannelAvailabilityState =
  'unknown' | 'checking' | 'playable' | 'unavailable' | 'unsupported';

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
  return `/api/proxy/logo?url=${encodeURIComponent(logoUrl)}&moontv-source=${sourceKey || ''}`;
};

const getLiveErrorPresentation = (message: string | null) => {
  if (!message) {
    return {
      title: 'No Signal',
      detail: '',
    };
  }

  if (
    message.startsWith('Stream unavailable') ||
    message.startsWith('Precheck failed') ||
    message.includes('HTTP 403') ||
    message.includes('HTTP 404')
  ) {
    return {
      title: 'Channel Unavailable',
      detail: message,
    };
  }

  if (message.startsWith('Unsupported protocol:')) {
    return {
      title: 'Protocol Not Supported',
      detail: message,
    };
  }

  return {
    title: 'Format Not Supported',
    detail: message,
  };
};

const getUnsupportedLiveProtocol = (url: string) => {
  try {
    const scheme = new URL(url).protocol.replace(':', '').toLowerCase();
    if (['http', 'https', 'rtmp', 'rtsp', 'udp', 'rtp'].includes(scheme))
      return null;
  } catch {
    return null;
  }

  return 'Unsupported protocol';
};

const scoreChannelUrlForPlayback = (url: string) => {
  const lower = url.trim().toLowerCase();
  let score = 0;

  if (lower.startsWith('https://')) score += 4;
  else if (lower.startsWith('http://')) score += 2;

  if (lower.includes('.m3u8')) score += 10;
  if (lower.includes('.flv')) score += 8;
  if (/\.(mp4|m4v|mov|webm)(\?|$)/i.test(lower)) score += 6;
  if (/\/(rtp|udp)\//i.test(lower) || lower.includes('.ts')) score += 5;

  if (
    lower.includes('.php') ||
    lower.includes('api.php') ||
    lower.includes('live.php')
  )
    score -= 6;

  return score;
};

const sortChannelsForPlayback = (input: LiveChannel[]) =>
  input
    .map((channel, index) => ({
      channel,
      index,
      score: scoreChannelUrlForPlayback(channel.url),
    }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map(({ channel }) => channel);

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
  const initialSelectionRef = useRef({
    source: searchParams.get('source'),
    channel: searchParams.get('id'),
  });
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
        const sortedChannels = sortChannelsForPlayback(parsedChannels);
        setChannels(sortedChannels);

        const initialChannel = targetChannelId
          ? sortedChannels.find((c) => c.id === targetChannelId) ||
            sortedChannels[0]
          : sortedChannels[0];

        setCurrentChannel(initialChannel);
        return { channels: sortedChannels, initialChannel };
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
          const urlSource = initialSelectionRef.current.source;
          const urlChannel = initialSelectionRef.current.channel;
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
  }, [fetchChannels]);

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

function guessType(url: string): {
  type: LiveStreamType;
  unsupportedReason?: string;
} {
  return { type: guessLiveStreamType(url) };
}

function usePlayerState(
  videoUrl: string,
  sourceKey?: string,
  channelId?: string,
) {
  const debouncedUrl = useDebounce(videoUrl, 500);
  const debouncedKey = useDebounce(sourceKey, 500);

  const [proxiedUrl, setProxiedUrl] = useState('');
  const [isStreamLoading, setIsStreamLoading] = useState(false);
  const [unsupportedType, setUnsupportedType] = useState<string | null>(null);
  const [streamType, setStreamType] = useState<LiveStreamType | null>(null);

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
        const checkUrl = `/api/live/precheck?url=${encodeURIComponent(debouncedUrl)}&moontv-source=${encodeURIComponent(debouncedKey)}&moontv-channel=${encodeURIComponent(channelId || '')}`;
        const res = await fetch(checkUrl, { signal: controller.signal });
        if (!res.ok) throw new Error(`Precheck failed with ${res.status}`);
        const data = await res.json();

        if (controller.signal.aborted) return;
        let detected = (data.type || 'unknown') as LiveStreamType;
        let unsupportedReason: string | undefined;
        if (detected === 'unknown') {
          const guessed = guessType(debouncedUrl);
          detected = guessed.type;
          unsupportedReason = guessed.unsupportedReason;
        }

        if (detected === 'unknown') {
          setUnsupportedType(
            unsupportedReason || data.error || 'Unsupported stream type',
          );
          setProxiedUrl('');
          setStreamType('unknown');
        } else {
          const nextProxyUrl = `/api/proxy/${detected}?url=${encodeURIComponent(debouncedUrl)}&moontv-source=${encodeURIComponent(debouncedKey)}&moontv-channel=${encodeURIComponent(channelId || '')}`;
          setStreamType(detected);
          setUnsupportedType(null);
          setProxiedUrl(nextProxyUrl);
        }
      } catch (e) {
        if ((e as Error).name !== 'AbortError') {
          if (controller.signal.aborted) return;
          const fallback = guessType(debouncedUrl);
          const message =
            e instanceof Error ? e.message : 'Unsupported stream type';
          if (
            fallback.type === 'unknown' ||
            message.startsWith('Stream unavailable') ||
            message.startsWith('Precheck failed')
          ) {
            setUnsupportedType(fallback.unsupportedReason || message);
            setProxiedUrl('');
            setStreamType(
              fallback.type === 'unknown' ? 'unknown' : fallback.type,
            );
          } else {
            const typeParam = fallback.type;
            setStreamType(fallback.type);
            setProxiedUrl(
              `/api/proxy/${typeParam}?url=${encodeURIComponent(debouncedUrl)}&moontv-source=${debouncedKey}`,
            );
          }
        }
      } finally {
        if (!controller.signal.aborted) setIsStreamLoading(false);
      }
    };

    check();
    return () => controller.abort();
  }, [debouncedUrl, debouncedKey, videoUrl, channelId]);

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
    usePlayerState(
      currentChannel?.url || '',
      currentSource?.key,
      currentChannel?.id,
    );
  const liveError = getLiveErrorPresentation(unsupportedType);
  const [compatibilityChannel, setCompatibilityChannel] = useState('');
  const [playbackFailure, setPlaybackFailure] = useState('');
  const [playbackRetry, setPlaybackRetry] = useState(0);
  const channelIdentity = `${currentSource?.key || ''}:${currentChannel?.id || ''}`;
  useEffect(() => {
    setPlaybackFailure('');
    setPlaybackRetry(0);
  }, [channelIdentity]);
  const compatibilityPlayback = compatibilityChannel === channelIdentity;
  const playbackUrl = compatibilityPlayback
    ? `/api/live/relay?source=${encodeURIComponent(currentSource?.key || '')}&channel=${encodeURIComponent(currentChannel?.id || '')}`
    : proxiedUrl;

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
  const [selectedChannels, setSelectedChannels] = useState<{
    [category: string]: Record<string, unknown>;
  }>({});
  const [selectedGroup, setSelectedGroup] = useState<string>('');
  const [playerFocused, setPlayerFocused] = useState(false);
  const [isSwitchingSource, setIsSwitchingSource] = useState(false);
  const [channelAvailability, setChannelAvailability] = useState<
    Record<string, ChannelAvailabilityState>
  >({});
  const [channelAvailabilityDetails, setChannelAvailabilityDetails] = useState<
    Record<string, string>
  >({});

  const playerRef = useRef<Player | null>(null);
  const playerWrapperRef = useRef<HTMLDivElement>(null);
  const channelListRef = useRef<HTMLDivElement>(null);
  const groupScrollerRef = useRef<HTMLDivElement>(null);
  const groupButtonRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const sourceRef = useRef<LiveSource | null>(null);

  useEffect(() => {
    sourceRef.current = currentSource;
  }, [currentSource]);

  useEffect(() => {
    setChannelAvailability({});
    setChannelAvailabilityDetails({});
  }, [currentSource?.key]);

  const displayableChannels = useMemo(
    () =>
      channels.filter((channel) => !getUnsupportedLiveProtocol(channel.url)),
    [channels],
  );

  const groupedChannels = useMemo(() => {
    const groups: Record<string, LiveChannel[]> = {};
    displayableChannels.forEach((c) => {
      const g = c.group || '其他';
      if (!groups[g]) groups[g] = [];
      groups[g].push(c);
    });
    return groups;
  }, [displayableChannels]);

  const groupKeys = useMemo(
    () => Object.keys(groupedChannels).sort(),
    [groupedChannels],
  );
  const filteredChannels = useMemo(
    () =>
      selectedGroup
        ? groupedChannels[selectedGroup] || []
        : displayableChannels,
    [selectedGroup, groupedChannels, displayableChannels],
  );
  const getChannelAvailabilityKey = useCallback(
    (channel: LiveChannel) => `${currentSource?.key || 'global'}:${channel.id}`,
    [currentSource?.key],
  );
  const getChannelAvailabilityState = useCallback(
    (channel: LiveChannel): ChannelAvailabilityState => {
      const protocolError = getUnsupportedLiveProtocol(channel.url);
      if (protocolError) return 'unsupported';
      return (
        channelAvailability[getChannelAvailabilityKey(channel)] || 'unknown'
      );
    },
    [channelAvailability, getChannelAvailabilityKey],
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

  const handleChannelSelect = (channel: LiveChannel) => {
    if (isSwitchingSource || channel.id === currentChannel?.id) return;
    setCurrentChannel(channel);
    scrollToChannel(channel.id);
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

  const scrollGroupRail = useCallback((direction: 'left' | 'right') => {
    if (!groupScrollerRef.current) return;
    const amount = Math.max(groupScrollerRef.current.clientWidth * 0.75, 220);
    groupScrollerRef.current.scrollBy({
      left: direction === 'left' ? -amount : amount,
      behavior: 'smooth',
    });
  }, []);

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
    const p = playerRef.current;

    if (!p || (p as unknown as { isDisposed?: () => boolean }).isDisposed?.())
      return;
    switch (e.key) {
      case 'PageUp':
        e.preventDefault();
        window.scrollBy({ top: -window.innerHeight * 0.9, behavior: 'smooth' });
        break;
      case 'PageDown':
        e.preventDefault();
        window.scrollBy({ top: window.innerHeight * 0.9, behavior: 'smooth' });
        break;
      case 'Home':
        e.preventDefault();
        window.scrollTo({ top: 0, behavior: 'smooth' });
        break;
      case 'End':
        e.preventDefault();
        window.scrollTo({
          top: document.body.scrollHeight,
          behavior: 'smooth',
        });
        break;
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
      {/* OUTER CONTAINER: Dark obsidian layout with deep spacing */}
      <div className='flex flex-col lg:flex-row min-h-[calc(100vh-64px)] w-full bg-[#0a0f1d] text-slate-100 p-3 lg:p-6 gap-4 lg:gap-6'>
        {/* === LEFT PANE: PLAYER & INFO === */}
        <div className='flex-none lg:flex-1 flex flex-col min-w-0 bg-[#0f172a]/40 backdrop-blur-md border border-slate-800/60 rounded-3xl p-4 lg:p-6 gap-4 relative lg:min-h-[calc(100vh-64px)] shadow-2xl'>
          {/* PLAYER WRAPPER */}
          <div
            ref={playerWrapperRef}
            className={`
              relative z-30
              w-full shrink-0
              aspect-video lg:flex-1
              bg-black overflow-hidden rounded-2xl
              border border-slate-800/80 shadow-[0_4px_30px_rgba(0,0,0,0.5)]
              transition-all duration-300
              ${playerFocused ? 'ring-2 ring-blue-500/50 shadow-[0_0_25px_rgba(59,130,246,0.3)]' : ''}
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
            {proxiedUrl && !unsupportedType && (
              <button
                className='absolute top-4 right-4 z-40 rounded-full bg-slate-900/80 px-3 py-1.5 text-xs text-white'
                onClick={() =>
                  setCompatibilityChannel(
                    compatibilityPlayback ? '' : channelIdentity,
                  )
                }
              >
                {compatibilityPlayback
                  ? 'Original playback'
                  : 'Compatibility playback'}
              </button>
            )}

            {/* Pulsing Live Badge Overlay */}
            {proxiedUrl && !unsupportedType && (
              <div className='absolute top-4 left-4 z-40 bg-red-600/90 text-white text-[10px] font-bold tracking-wider px-2.5 py-1 rounded-full flex items-center gap-1.5 shadow-lg uppercase backdrop-blur-sm animate-pulse'>
                <span className='w-1.5 h-1.5 bg-white rounded-full'></span>
                Live
              </div>
            )}

            {proxiedUrl && !unsupportedType ? (
              <VideoJsPlayer
                key={playbackUrl}
                url={playbackUrl}
                poster={getProxiedLogoUrl(
                  currentChannel?.logo || '',
                  currentSource?.key,
                )}
                type={liveStreamMimeType(
                  compatibilityPlayback ? 'm3u8' : streamType || 'm3u8',
                  currentChannel?.url,
                )}
                autoPlay={true}
                onReady={handlePlayerReady}
                reloadTrigger={playbackRetry}
                onPlay={() => {
                  setPlaybackFailure('');
                  if (!currentChannel) return;
                  setChannelAvailability((prev) => ({
                    ...prev,
                    [getChannelAvailabilityKey(currentChannel)]: 'playable',
                  }));
                }}
                onError={(error) => {
                  const code = (error as { code?: number })?.code;
                  if (!compatibilityPlayback && (code === 3 || code === 4)) {
                    setPlaybackFailure('');
                    setCompatibilityChannel(channelIdentity);
                    return;
                  }
                  const message =
                    error instanceof Error
                      ? error.message
                      : (error as { message?: string })?.message ||
                        'This source could not be played. Retry or choose another channel.';
                  setPlaybackFailure(message);
                  if (currentChannel)
                    setChannelAvailabilityDetails((prev) => ({
                      ...prev,
                      [getChannelAvailabilityKey(currentChannel)]: message,
                    }));
                }}
                className='w-full h-full'
                isLive={true}
                videoJsOptions={videoOptions}
              />
            ) : (
              <div className='absolute inset-0 flex items-center justify-center text-slate-500 bg-slate-950/60'>
                {unsupportedType ? (
                  <div className='text-center text-red-400 p-6'>
                    <AlertTriangle className='w-12 h-12 mx-auto mb-3 text-red-500/80' />
                    <p className='font-semibold'>{liveError.title}</p>
                    <p className='text-xs text-slate-500 mt-1'>
                      {liveError.detail}
                    </p>
                  </div>
                ) : (
                  <div className='text-center'>
                    <Tv className='w-12 h-12 mx-auto mb-3 opacity-20' />
                    <p className='text-sm tracking-wider'>NO SIGNAL</p>
                  </div>
                )}
              </div>
            )}

            {playbackFailure && (
              <div
                role='alert'
                className='absolute bottom-20 left-4 right-4 z-40 rounded-xl bg-slate-950/95 p-4 text-center text-sm text-white'
              >
                <p>{playbackFailure}</p>
                <button
                  className='mt-2 rounded-lg bg-blue-600 px-4 py-2'
                  onClick={() => {
                    setPlaybackFailure('');
                    setPlaybackRetry((value) => value + 1);
                  }}
                >
                  Retry playback
                </button>
              </div>
            )}

            {/* Overlay Loader */}
            {isStreamLoading && (
              <div className='absolute inset-0 flex items-center justify-center bg-black/80 backdrop-blur-sm text-white z-20 pointer-events-none'>
                <div className='flex flex-col items-center gap-3'>
                  <Loader2 className='w-10 h-10 animate-spin text-blue-500' />
                  <span className='text-sm font-medium tracking-wide text-slate-300'>
                    Connecting Stream...
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* BASIC INFO BAR: logo, name, group, favorite button */}
          <div className='shrink-0 bg-slate-900/50 border border-slate-800/50 rounded-2xl p-4 relative z-20'>
            {currentChannel ? (
              <>
                <div className='flex items-center justify-between gap-4'>
                  <div className='flex items-center gap-3.5 overflow-hidden min-w-0'>
                    <div className='w-12 h-12 bg-slate-950/60 rounded-xl shrink-0 flex items-center justify-center p-1 border border-slate-800/60 shadow-inner'>
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
                        <Tv className='w-6 h-6 opacity-30 text-slate-400' />
                      )}
                    </div>
                    <div className='min-w-0 flex-1'>
                      <h2 className='text-lg font-extrabold truncate text-white leading-tight tracking-wide flex items-center gap-2'>
                        {currentChannel.name}
                        <span className='flex h-2 w-2 relative shrink-0'>
                          <span className='animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75'></span>
                          <span className='relative inline-flex rounded-full h-2 w-2 bg-green-500'></span>
                        </span>
                      </h2>
                      <div className='flex items-center gap-2 text-xs text-slate-400 mt-1'>
                        <span className='px-2 py-0.5 bg-blue-950/40 border border-blue-900/30 text-blue-400 font-medium rounded-md'>
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
                    className={`p-3 rounded-full transition-all duration-200 active:scale-90 border ${
                      isFavorite
                        ? 'bg-red-500/10 border-red-500/30 text-red-500 shadow-[0_0_15px_rgba(239,68,68,0.15)] hover:bg-red-500/20'
                        : 'bg-slate-950/40 border-slate-800/60 text-slate-400 hover:bg-slate-800/60 hover:text-slate-200'
                    }`}
                    title='Toggle Favorite'
                  >
                    <Heart
                      className={`w-5 h-5 ${isFavorite ? 'fill-current' : ''}`}
                    />
                  </button>
                </div>

                {/* EPG Timeline - Visible only on Desktop here */}
                <div className='hidden lg:block mt-4 pt-4 border-t border-slate-800/60'>
                  <EpgScrollableRow
                    programs={programs}
                    currentTime={new Date()}
                    isLoading={isEpgLoading}
                  />
                </div>
              </>
            ) : (
              <div className='text-slate-500 text-center py-4 text-sm font-medium'>
                Select a channel from the list
              </div>
            )}
          </div>
        </div>

        {/* === RIGHT PANE: SIDEBAR & CHANNEL LIST === */}
        <div
          className='
            flex flex-col
            bg-[#0f172a]/40 backdrop-blur-md
            border border-slate-800/60 rounded-3xl
            w-full lg:w-85 lg:shrink-0
            overflow-hidden
            lg:sticky lg:top-6
            lg:h-[calc(100vh-112px)]
            flex-1 lg:flex-none
            shadow-2xl p-4 gap-4
          '
        >
          {/* TABS */}
          <div className='flex p-1 bg-slate-950/40 border border-slate-800/60 rounded-xl shrink-0 gap-1'>
            <button
              onClick={() => setActiveTab('channels')}
              className={`flex-1 py-2 rounded-lg text-sm font-semibold transition-all duration-200 ${
                activeTab === 'channels'
                  ? 'text-white bg-blue-600 shadow-md shadow-blue-900/20'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/30'
              }`}
            >
              Channels
            </button>
            <button
              onClick={() => setActiveTab('sources')}
              className={`flex-1 py-2 rounded-lg text-sm font-semibold transition-all duration-200 ${
                activeTab === 'sources'
                  ? 'text-white bg-blue-600 shadow-md shadow-blue-900/20'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/30'
              }`}
            >
              Sources
            </button>
          </div>

          {/* LIST CONTENT */}
          {activeTab === 'channels' ? (
            <div className='flex flex-col flex-1 overflow-hidden gap-3'>
              {/* Groups Selector (Horizontal Scroll) */}
              <div className='flex items-center gap-2 lg:gap-3 shrink-0'>
                <button
                  type='button'
                  onClick={() => scrollGroupRail('left')}
                  className='hidden lg:flex items-center justify-center w-11 h-11 rounded-xl border border-slate-700/50 bg-slate-900/70 text-slate-200 hover:bg-slate-800 hover:text-white transition-colors'
                  aria-label='Scroll categories left'
                >
                  <ChevronLeft className='w-5 h-5' />
                </button>
                <div
                  ref={groupScrollerRef}
                  className='overflow-x-auto p-1.5 lg:p-2 border border-slate-800/40 bg-slate-950/20 rounded-2xl scrollbar-none shrink-0 flex-1'
                >
                  <div className='flex gap-2'>
                    {groupKeys.map((g) => (
                      <button
                        key={g}
                        ref={(el: HTMLButtonElement | null) => {
                          if (el) groupButtonRefs.current.set(g, el);
                          else groupButtonRefs.current.delete(g);
                        }}
                        onClick={() => handleGroupChange(g)}
                        className={`whitespace-nowrap px-4 py-2.5 lg:px-5 lg:py-3 rounded-xl text-sm font-extrabold tracking-wide border transition-all duration-200 ${
                          selectedGroup === g
                            ? 'bg-blue-600 text-white border-blue-500 shadow-md shadow-blue-900/10'
                            : 'bg-slate-800/40 text-slate-300 border-slate-700/30 hover:bg-slate-800 hover:text-white'
                        }`}
                      >
                        {g}
                      </button>
                    ))}
                  </div>
                </div>
                <button
                  type='button'
                  onClick={() => scrollGroupRail('right')}
                  className='hidden lg:flex items-center justify-center w-11 h-11 rounded-xl border border-slate-700/50 bg-slate-900/70 text-slate-200 hover:bg-slate-800 hover:text-white transition-colors'
                  aria-label='Scroll categories right'
                >
                  <ChevronRight className='w-5 h-5' />
                </button>
              </div>

              {/* Channel Items (Scrollable) */}
              <div
                className='flex-1 overflow-y-auto pr-1 scrollbar-thin scrollbar-thumb-slate-800 hover:scrollbar-thumb-slate-700 scrollbar-track-transparent'
                ref={channelListRef}
              >
                {isChannelLoading ? (
                  <div className='flex flex-col items-center justify-center h-48 text-slate-400'>
                    <Loader2 className='w-8 h-8 animate-spin mb-2 text-blue-500' />
                    <span className='text-xs font-medium'>
                      Loading channel list...
                    </span>
                  </div>
                ) : filteredChannels.length === 0 ? (
                  <div className='p-8 text-center text-sm text-slate-500 border border-dashed border-slate-850 rounded-2xl mt-4'>
                    No channels available in this group.
                  </div>
                ) : (
                  <div className='space-y-1.5 pb-safe'>
                    {filteredChannels.map((c) => {
                      const availabilityKey = getChannelAvailabilityKey(c);
                      const availabilityState = getChannelAvailabilityState(c);
                      const availabilityDetail =
                        channelAvailabilityDetails[availabilityKey] || '';

                      return (
                        <button
                          key={c.id}
                          data-channel-id={c.id}
                          onClick={() => handleChannelSelect(c)}
                          className={`w-full text-left p-2.5 rounded-xl flex items-center gap-3 transition-all duration-200 group border ${
                            c.id === currentChannel?.id
                              ? 'bg-blue-600/10 border-blue-500/40 text-blue-400 shadow-md'
                              : availabilityState === 'unavailable' ||
                                  availabilityState === 'unsupported'
                                ? 'border-transparent text-slate-500 hover:bg-slate-800/20 hover:text-slate-300 opacity-70'
                                : 'border-transparent text-slate-300 hover:bg-slate-800/30 hover:text-slate-100'
                          }`}
                        >
                          <div
                            className={`w-9 h-9 bg-slate-950/60 rounded-lg overflow-hidden shrink-0 flex items-center justify-center border transition-all duration-200 ${
                              c.id === currentChannel?.id
                                ? 'border-blue-500/40'
                                : 'border-slate-850'
                            }`}
                          >
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
                              <Tv className='w-4.5 h-4.5 opacity-20' />
                            )}
                          </div>
                          <div className='flex-1 min-w-0 flex items-center justify-between gap-2'>
                            <span className='text-sm font-semibold truncate group-hover:translate-x-0.5 transition-transform duration-200'>
                              {c.name}
                            </span>
                            {availabilityState === 'checking' && (
                              <span className='shrink-0 rounded-full border border-slate-700/60 bg-slate-900/70 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-slate-400'>
                                Checking
                              </span>
                            )}
                            {availabilityState === 'unavailable' && (
                              <span
                                title={availabilityDetail}
                                className='shrink-0 rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-300'
                              >
                                Offline
                              </span>
                            )}
                            {availabilityState === 'unsupported' && (
                              <span
                                title={availabilityDetail}
                                className='shrink-0 rounded-full border border-rose-500/30 bg-rose-500/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-rose-300'
                              >
                                Unsupported
                              </span>
                            )}
                            {c.id === currentChannel?.id && (
                              <span className='flex h-2 w-2 relative shrink-0'>
                                <span className='animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75'></span>
                                <span className='relative inline-flex rounded-full h-2 w-2 bg-green-500'></span>
                              </span>
                            )}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className='flex-1 overflow-y-auto pr-1 space-y-2 scrollbar-thin scrollbar-thumb-slate-800 scrollbar-track-transparent pb-safe'>
              {sources.map((s) => (
                <button
                  key={s.key}
                  onClick={() => handleSourceChange(s)}
                  className={`w-full text-left p-3.5 rounded-2xl flex items-center gap-3 border transition-all duration-200 ${
                    currentSource?.key === s.key
                      ? 'border-blue-500/50 bg-blue-600/10 shadow-md shadow-blue-900/10'
                      : 'border-transparent bg-slate-900/40 hover:bg-slate-850'
                  }`}
                >
                  <div
                    className={`p-2.5 rounded-xl ${
                      currentSource?.key === s.key
                        ? 'bg-blue-600/20 text-blue-400'
                        : 'bg-slate-850 text-slate-500'
                    }`}
                  >
                    <Radio className='w-5 h-5' />
                  </div>
                  <div>
                    <div className='font-bold text-sm text-slate-200'>
                      {s.name}
                    </div>
                    <div className='text-xs text-slate-400 mt-1 font-medium'>
                      {s.channelNumber ?? 0} channels
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}

          {/* EPG Timeline - Visible only on Mobile here, placing it behind the Channel List flow */}
          {currentChannel && (
            <div className='block lg:hidden mt-2 pt-4 border-t border-slate-800/60 bg-slate-950/20 rounded-xl p-3'>
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
