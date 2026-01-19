'use client';

import React, { useCallback, useEffect, useState } from 'react';

import type { PlayRecord } from '@/lib/db.client';
import {
  clearAllPlayRecords,
  getAllPlayRecords,
  subscribeToDataUpdates,
} from '@/lib/db.client';

import { useLanguage } from '@/components/LanguageProvider';
import ScrollableRow from '@/components/ScrollableRow';
import VideoCard from '@/components/VideoCard';

interface ContinueWatchingProps {
  className?: string;
}

export default function ContinueWatching({ className }: ContinueWatchingProps) {
  const { convert } = useLanguage();
  const [playRecords, setPlayRecords] = useState<
    (PlayRecord & { key: string })[]
  >([]);
  const [loading, setLoading] = useState(true);

  // Memoize the parsing logic to avoid re-creating function on render
  // Helper to safely parse the compound key (source+id)
  const parseKey = useCallback((key: string) => {
    const parts = key.split('+');
    // Default fallback if key is malformed
    if (parts.length < 2) return { source: 'douban', id: parts[0] || '' };
    return { source: parts[0], id: parts[1] };
  }, []);

  // Update records and sort by time (newest first)
  const updatePlayRecords = useCallback(
    (allRecords: Record<string, PlayRecord>) => {
      const recordsArray = Object.entries(allRecords).map(([key, record]) => ({
        ...record,
        key,
      }));

      // Sort descending by save_time
      recordsArray.sort((a, b) => b.save_time - a.save_time);

      setPlayRecords(recordsArray);
    },
    [],
  );

  useEffect(() => {
    let mounted = true;

    const fetchPlayRecords = async () => {
      try {
        setLoading(true);
        const allRecords = await getAllPlayRecords();
        if (mounted) updatePlayRecords(allRecords);
      } catch (error) {
        console.error('Failed to fetch play records:', error);
        if (mounted) setPlayRecords([]);
      } finally {
        if (mounted) setLoading(false);
      }
    };

    fetchPlayRecords();

    // Subscribe to DB changes
    const unsubscribe = subscribeToDataUpdates(
      'playRecordsUpdated',
      (newRecords: Record<string, PlayRecord>) => {
        if (mounted) updatePlayRecords(newRecords);
      },
    );

    return () => {
      mounted = false;
      unsubscribe();
    };
  }, [updatePlayRecords]);

  // Optimistic UI Delete Handler
  // Removes the item from screen immediately without waiting for DB sync
  const handleDelete = useCallback((keyToDelete: string) => {
    setPlayRecords((prev) => prev.filter((r) => r.key !== keyToDelete));
  }, []);

  const handleClearAll = async () => {
    // Optimistic clear
    setPlayRecords([]);
    await clearAllPlayRecords();
  };

  // Safe Progress Calculation
  const getProgress = (record: PlayRecord) => {
    if (!record.total_time || record.total_time <= 0) return 0;
    const progress = (record.play_time / record.total_time) * 100;
    return Math.min(Math.max(progress, 0), 100); // Clamp between 0-100
  };

  // Don't render empty section (unless loading)
  if (!loading && playRecords.length === 0) {
    return null;
  }

  return (
    <section
      className={`mb-8 animate-in fade-in slide-in-from-bottom-4 duration-500 ${className || ''}`}
    >
      <div className='mb-4 flex items-center justify-between px-1'>
        <h2 className='text-xl font-bold text-gray-800 dark:text-gray-200'>
          {convert('继续观看')}
        </h2>
        {!loading && playRecords.length > 0 && (
          <button
            onClick={handleClearAll}
            className='group flex items-center gap-1 text-sm text-gray-500 hover:text-red-600 dark:text-gray-400 dark:hover:text-red-400 transition-colors'
            aria-label={convert('清空播放记录')}
          >
            <span className='text-xs'>{convert('清空')}</span>
          </button>
        )}
      </div>

      <ScrollableRow>
        {loading
          ? // Skeletons
            Array.from({ length: 6 }).map((_, index) => (
              <div
                key={`skeleton-${index}`}
                className='min-w-[96px] w-24 sm:min-w-[180px] sm:w-44'
              >
                {/* Fixed aspect ratio syntax: aspect-[2/3] -> aspect-2/3 */}
                <div className='relative aspect-2/3 w-full overflow-hidden rounded-lg bg-gray-200 dark:bg-gray-800'>
                  <div className='absolute inset-0 bg-linear-to-r from-transparent via-white/20 to-transparent -translate-x-full animate-[shimmer_1.5s_infinite]'></div>
                </div>
                <div className='mt-2 h-4 w-3/4 bg-gray-200 rounded dark:bg-gray-800'></div>
                <div className='mt-1 h-3 w-1/2 bg-gray-200 rounded dark:bg-gray-800'></div>
              </div>
            ))
          : // Real Data
            playRecords.map((record) => {
              const { source, id } = parseKey(record.key);

              // Skip rendering if data is corrupted (missing id)
              if (!id) return null;

              return (
                <div
                  key={record.key}
                  className='min-w-[96px] w-24 sm:min-w-[180px] sm:w-44 snap-start'
                >
                  <VideoCard
                    id={id}
                    title={record.title}
                    poster={record.cover}
                    year={record.year}
                    source={source}
                    source_name={record.source_name}
                    progress={getProgress(record)}
                    episodes={record.total_episodes}
                    currentEpisode={record.index}
                    query={record.search_title}
                    from='playrecord'
                    // Pass the optimistic delete handler
                    onDelete={() => handleDelete(record.key)}
                    type={record.total_episodes > 1 ? 'tv' : 'movie'}
                  />
                </div>
              );
            })}
      </ScrollableRow>
    </section>
  );
}
