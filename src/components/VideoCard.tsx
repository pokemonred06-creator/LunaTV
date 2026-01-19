/* eslint-disable @typescript-eslint/no-explicit-any */
'use client';

import {
  ExternalLink,
  Heart,
  Link,
  PlayCircleIcon,
  Radio,
  Trash2,
} from 'lucide-react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import React, {
  forwardRef,
  memo,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useState,
} from 'react';

import {
  deleteFavorite,
  deletePlayRecord,
  generateStorageKey,
  isFavorited,
  saveFavorite,
  subscribeToDataUpdates,
} from '@/lib/db.client';
import { processImageUrl } from '@/lib/utils';
import { useLongPress } from '@/hooks/useLongPress';

import { ImagePlaceholder } from '@/components/ImagePlaceholder';
import { useLanguage } from '@/components/LanguageProvider';
import MobileActionSheet from '@/components/MobileActionSheet';

// --- Types ---

export interface VideoCardProps {
  id?: string;
  source?: string;
  title?: string;
  query?: string;
  poster?: string;
  episodes?: number;
  source_name?: string;
  source_names?: string[];
  progress?: number;
  year?: string;
  from: 'playrecord' | 'favorite' | 'search' | 'douban';
  currentEpisode?: number;
  douban_id?: number;
  onDelete?: () => void;
  rate?: string;
  type?: string;
  isBangumi?: boolean;
  isAggregate?: boolean;
  origin?: 'vod' | 'live';
}

export type VideoCardHandle = {
  setEpisodes: (episodes?: number) => void;
  setSourceNames: (names?: string[]) => void;
  setDoubanId: (id?: number) => void;
};

// --- Helpers ---

const getConfig = (from: string, rate?: string) => {
  const configs: Record<string, any> = {
    playrecord: {
      showSourceName: true,
      showProgress: true,
      showPlayButton: true,
      showHeart: true,
      showCheckCircle: true,
      showDoubanLink: false,
      showRating: false,
      showYear: false,
    },
    favorite: {
      showSourceName: true,
      showProgress: false,
      showPlayButton: true,
      showHeart: true,
      showCheckCircle: false,
      showDoubanLink: false,
      showRating: false,
      showYear: false,
    },
    search: {
      showSourceName: true,
      showProgress: false,
      showPlayButton: true,
      showHeart: true,
      showCheckCircle: false,
      showDoubanLink: true,
      showRating: false,
      showYear: true,
    },
    douban: {
      showSourceName: false,
      showProgress: false,
      showPlayButton: true,
      showHeart: true,
      showCheckCircle: false,
      showDoubanLink: true,
      showRating: !!rate,
      showYear: false,
    },
  };
  return configs[from] || configs.search;
};

// --- Custom Hook: Unified Favorite Logic ---

const useFavoriteStatus = (
  shouldCheck: boolean, // If false, we wait for explicit check
  source?: string,
  id?: string,
) => {
  const [favorited, setFavorited] = useState(false);
  const [hasChecked, setHasChecked] = useState(false);

  // DB Check Function
  const checkStatus = useCallback(async () => {
    if (!source || !id) return;
    try {
      const status = await isFavorited(source, id);
      setFavorited(status);
      setHasChecked(true);
    } catch {
      setFavorited(false);
    }
  }, [source, id]);

  // Initial Auto-Check (only for non-lazy contexts)
  useEffect(() => {
    if (shouldCheck && !hasChecked) checkStatus();
  }, [shouldCheck, hasChecked, checkStatus]);

  // Subscription (Always active once we know the ID, to keep UI in sync)
  useEffect(() => {
    if (!source || !id) return;
    const storageKey = generateStorageKey(source, id);
    return subscribeToDataUpdates(
      'favoritesUpdated',
      (newFavorites: Record<string, any>) => {
        setFavorited(!!newFavorites[storageKey]);
      },
    );
  }, [source, id]);

  return { favorited, setFavorited, checkStatus, hasChecked };
};

// --- Main Component ---

const VideoCard = forwardRef<VideoCardHandle, VideoCardProps>(
  function VideoCard(
    {
      id,
      title = '',
      query = '',
      poster = '',
      episodes,
      source,
      source_name,
      source_names,
      progress = 0,
      year,
      from,
      currentEpisode,
      douban_id,
      onDelete,
      rate,
      type = '',
      isBangumi = false,
      isAggregate = false,
      origin = 'vod',
    },
    ref,
  ) {
    const router = useRouter();
    const { convert } = useLanguage();

    // State
    const [imageLoaded, setImageLoaded] = useState(false);
    const [showMobileActions, setShowMobileActions] = useState(false);

    // Dynamic props: Initialize from props ONCE.
    // Updates should come via imperative handle or parent remounting with new key.
    const [dynamicEpisodes, setDynamicEpisodes] = useState(episodes);
    const [dynamicSourceNames, setDynamicSourceNames] = useState(source_names);
    const [dynamicDoubanId, setDynamicDoubanId] = useState(douban_id);

    useImperativeHandle(ref, () => ({
      setEpisodes: setDynamicEpisodes,
      setSourceNames: setDynamicSourceNames,
      setDoubanId: setDynamicDoubanId,
    }));

    // Derived values
    const actualEpisodes = dynamicEpisodes;
    const actualDoubanId = dynamicDoubanId;
    const searchType = isAggregate
      ? actualEpisodes === 1
        ? 'movie'
        : 'tv'
      : type;
    const config = useMemo(() => getConfig(from, rate), [from, rate]);

    // Unified Favorite Logic
    // Lazy check only for search results to save DB reads
    const isSearch = from === 'search';
    const { favorited, setFavorited, checkStatus, hasChecked } =
      useFavoriteStatus(
        !isSearch, // Auto-check if NOT search
        source,
        id,
      );

    // Handlers
    const handleToggleFavorite = useCallback(
      async (e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        if (from === 'douban' || !source || !id) return;

        // Ensure we have latest state before toggling
        if (isSearch && !hasChecked) await checkStatus();

        try {
          if (favorited) {
            await deleteFavorite(source, id);
            setFavorited(false); // Optimistic update
          } else {
            await saveFavorite(source, id, {
              title,
              source_name: source_name || '',
              year: year || '',
              cover: poster,
              total_episodes: actualEpisodes ?? 1,
              save_time: Date.now(),
            });
            setFavorited(true); // Optimistic update
          }
        } catch {
          /* safely ignore */
        }
      },
      [
        from,
        source,
        id,
        title,
        source_name,
        year,
        poster,
        actualEpisodes,
        favorited,
        isSearch,
        hasChecked,
        checkStatus,
        setFavorited,
      ],
    );

    const handleDeleteRecord = useCallback(
      async (e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        if (from !== 'playrecord' || !source || !id) return;
        try {
          await deletePlayRecord(source, id);
          onDelete?.();
        } catch {
          /* safely ignore */
        }
      },
      [from, source, id, onDelete],
    );

    const getPlayUrl = useCallback(() => {
      const params = new URLSearchParams();
      if (title) params.set('title', title.trim());
      if (year) params.set('year', year);
      if (searchType) params.set('stype', searchType);
      if (isAggregate) params.set('prefer', 'true');
      if (query) params.set('stitle', query.trim());

      if (!source && !id && poster) params.set('cover', poster);

      if (origin === 'live' && source && id) {
        return `/live?source=${source.replace('live_', '')}&id=${id.replace('live_', '')}`;
      }

      if (
        source &&
        id &&
        !from?.includes('douban') &&
        (!isAggregate || (source && id))
      ) {
        return `/play?source=${source}&id=${id}&${params.toString()}&cover=${encodeURIComponent(poster)}`;
      }

      return `/play?${params.toString()}`;
    }, [
      origin,
      source,
      id,
      title,
      year,
      searchType,
      isAggregate,
      query,
      from,
      poster,
    ]);

    const handleClick = useCallback(
      () => router.push(getPlayUrl()),
      [router, getPlayUrl],
    );
    const handlePlayInNewTab = useCallback(() => {
      window.open(getPlayUrl(), '_blank');
    }, [getPlayUrl]);

    // Interaction Handlers
    const handleInteractionStart = useCallback(() => {
      if (isSearch && !hasChecked) checkStatus();
    }, [isSearch, hasChecked, checkStatus]);

    const handleLongPress = useCallback(() => {
      if (!showMobileActions) {
        setShowMobileActions(true);
        handleInteractionStart();
      }
    }, [showMobileActions, handleInteractionStart]);

    const { isPressed, ...longPressProps } = useLongPress({
      onLongPress: handleLongPress,
      longPressDelay: 500,
      moveThreshold: 50,
    });

    // Context Menu: Only open sheet on touch devices
    const handleContextMenu = useCallback(
      (e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();

        // Check for coarse pointer (touch)
        const isTouch =
          typeof window !== 'undefined' &&
          window.matchMedia('(pointer: coarse)').matches;

        if (isTouch) {
          setShowMobileActions(true);
          handleInteractionStart();
        }
        return false;
      },
      [handleInteractionStart],
    );

    // Action Menu Config
    const mobileActions = useMemo(() => {
      const actions = [];
      if (config.showPlayButton) {
        actions.push({
          id: 'play',
          label: origin === 'live' ? '观看直播' : '播放',
          icon: <PlayCircleIcon size={20} />,
          onClick: handleClick,
          color: 'primary' as const,
        });
        actions.push({
          id: 'play-new-tab',
          label: '新标签页打开',
          icon: <ExternalLink size={20} />,
          onClick: handlePlayInNewTab,
          color: 'default' as const,
        });
      }

      if (config.showHeart && source && id) {
        const loading = isSearch && !hasChecked;
        actions.push({
          id: 'favorite',
          label: loading ? '加载中...' : favorited ? '取消收藏' : '添加收藏',
          icon: (
            <Heart
              size={20}
              className={favorited ? 'fill-red-600 stroke-red-600' : ''}
            />
          ),
          onClick: (e?: any) => {
            if (!loading && e) handleToggleFavorite(e);
          },
          color: (favorited ? 'danger' : 'default') as 'danger' | 'default',
          disabled: loading,
        });
      }

      if (config.showCheckCircle && from === 'playrecord') {
        actions.push({
          id: 'delete',
          label: '删除记录',
          icon: <Trash2 size={20} />,
          onClick: (e?: any) => {
            if (e) handleDeleteRecord(e);
          },
          color: 'danger' as const,
        });
      }

      if (config.showDoubanLink && actualDoubanId) {
        actions.push({
          id: 'douban',
          label: isBangumi ? 'Bangumi' : '豆瓣详情',
          icon: <Link size={20} />,
          onClick: () => {
            window.open(
              isBangumi
                ? `https://bgm.tv/subject/${actualDoubanId}`
                : `https://movie.douban.com/subject/${actualDoubanId}`,
              '_blank',
            );
          },
          color: 'default' as const,
        });
      }
      return actions;
    }, [
      config,
      origin,
      handleClick,
      handlePlayInNewTab,
      source,
      id,
      isSearch,
      hasChecked,
      favorited,
      handleToggleFavorite,
      handleDeleteRecord,
      actualDoubanId,
      isBangumi,
      from,
    ]);

    // Dynamic Styles
    const containerStyle = useMemo(
      () => ({
        transform: showMobileActions
          ? 'scale(1.1)'
          : isPressed
            ? 'scale(0.95)'
            : 'scale(1)',
        opacity: isPressed ? 0.8 : 1,
        zIndex: showMobileActions ? 50 : isPressed ? 10 : 'auto',
        filter: showMobileActions
          ? 'brightness(1.1)'
          : isPressed
            ? 'brightness(0.9)'
            : 'none',
        transition: isPressed ? 'all 0.1s ease-out' : 'all 0.2s ease-out',
      }),
      [showMobileActions, isPressed],
    );

    return (
      <>
        <div
          className='group relative w-full rounded-lg bg-transparent cursor-pointer select-none touch-manipulation'
          onClick={handleClick}
          {...longPressProps}
          style={containerStyle}
          onContextMenu={handleContextMenu}
          onDragStart={(e) => e.preventDefault()}
        >
          {/* Poster */}
          <div
            className={`relative aspect-2/3 overflow-hidden rounded-lg ${origin === 'live' ? 'ring-1 ring-gray-300/80 dark:ring-gray-600/80' : ''}`}
          >
            {!imageLoaded && <ImagePlaceholder aspectRatio='aspect-2/3' />}
            <Image
              src={processImageUrl(poster)}
              alt={title}
              fill
              className={origin === 'live' ? 'object-contain' : 'object-cover'}
              referrerPolicy='no-referrer'
              loading='lazy'
              onLoadingComplete={() => setImageLoaded(true)}
              onError={(e) => {
                const img = e.target as HTMLImageElement;
                if (!img.dataset.retried) {
                  img.dataset.retried = 'true';
                  setTimeout(() => (img.src = processImageUrl(poster)), 2000);
                }
              }}
              unoptimized
            />

            {/* Overlay */}
            <div className='absolute inset-0 bg-linear-to-t from-black/80 via-black/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300' />

            {/* Hover Play Button */}
            {config.showPlayButton && (
              <div className='absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all duration-300 delay-75 scale-90 group-hover:scale-100'>
                <PlayCircleIcon
                  size={50}
                  strokeWidth={0.8}
                  className='text-white hover:fill-green-500 hover:scale-110 transition-transform'
                />
              </div>
            )}

            {/* Badges - Top Left */}
            {config.showYear && year && year !== 'unknown' && (
              <div className='absolute top-2 left-2 bg-black/60 text-white text-xs px-1.5 py-0.5 rounded backdrop-blur-md'>
                {year}
              </div>
            )}

            {/* Badges - Top Right */}
            <div className='absolute top-2 right-2 flex flex-col items-end gap-1'>
              {config.showRating && rate && (
                <div className='bg-pink-500 text-white text-xs font-bold w-6 h-6 rounded-full flex items-center justify-center shadow-sm'>
                  {rate}
                </div>
              )}
              {actualEpisodes && actualEpisodes > 1 && (
                <div className='bg-green-600 text-white text-xs font-semibold px-1.5 py-0.5 rounded shadow-sm'>
                  {currentEpisode
                    ? `${currentEpisode}/${actualEpisodes}`
                    : actualEpisodes}
                </div>
              )}
            </div>

            {/* Actions - Bottom Right */}
            <div className='absolute bottom-2 right-2 flex gap-2 opacity-0 translate-y-2 group-hover:opacity-100 group-hover:translate-y-0 transition-all duration-300'>
              {config.showCheckCircle && (
                <Trash2
                  onClick={handleDeleteRecord}
                  size={18}
                  className='text-white hover:text-red-500'
                />
              )}
              {config.showHeart && from !== 'search' && (
                <Heart
                  onClick={handleToggleFavorite}
                  size={18}
                  className={`hover:scale-110 transition-transform ${favorited ? 'fill-red-600 text-red-600' : 'text-white hover:text-red-400'}`}
                />
              )}
            </div>

            {/* Source Counter - Bottom Left (Moved to prevent collision) */}
            {isAggregate &&
              dynamicSourceNames &&
              dynamicSourceNames.length > 0 && (
                <div className='absolute bottom-2 left-2 opacity-0 group-hover:opacity-100 transition-opacity'>
                  <div className='bg-gray-800/80 backdrop-blur-md text-white text-xs font-bold px-1.5 py-0.5 rounded-md flex items-center justify-center'>
                    {new Set(dynamicSourceNames).size} 源
                  </div>
                </div>
              )}
          </div>

          {/* Progress Bar */}
          {config.showProgress && progress > 0 && (
            <div className='mt-1 h-1 w-full bg-gray-200 rounded-full overflow-hidden'>
              <div
                className='h-full bg-green-500'
                style={{ width: `${progress}%` }}
              />
            </div>
          )}

          {/* Metadata */}
          <div className='mt-2 text-center'>
            <div className='relative group/title'>
              <span className='block text-sm font-semibold truncate text-gray-900 dark:text-gray-100 group-hover:text-green-600 dark:group-hover:text-green-400 transition-colors'>
                {convert(title)}
              </span>
              <div className='absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2 py-1 bg-gray-800 text-white text-xs rounded opacity-0 invisible group-hover/title:opacity-100 group-hover/title:visible transition-all delay-500 whitespace-nowrap z-50 pointer-events-none'>
                {convert(title)}
              </div>
            </div>

            {config.showSourceName && source_name && (
              <div className='mt-1 text-xs text-gray-500 dark:text-gray-400 truncate'>
                {origin === 'live' && (
                  <Radio size={10} className='inline mr-1' />
                )}
                {convert(source_name)}
              </div>
            )}
          </div>
        </div>

        <MobileActionSheet
          isOpen={showMobileActions}
          onClose={() => setShowMobileActions(false)}
          title={convert(title)}
          poster={processImageUrl(poster)}
          actions={mobileActions}
          sources={
            isAggregate && dynamicSourceNames
              ? Array.from(new Set(dynamicSourceNames))
              : undefined
          }
          isAggregate={isAggregate}
          sourceName={convert(source_name || '')}
          currentEpisode={currentEpisode}
          totalEpisodes={actualEpisodes}
          origin={origin}
        />
      </>
    );
  },
);

export default memo(VideoCard);
