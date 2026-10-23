'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { ChevronLeft, ChevronRight, Heart, Play, Star } from 'lucide-react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import React, { useEffect, useState } from 'react';

import { deleteFavorite, isFavorited, saveFavorite } from '@/lib/db.client';
import { DoubanItem } from '@/lib/types';
import { processImageUrl } from '@/lib/utils';

import { useLanguage } from '@/components/LanguageProvider';

interface HeroFeaturedBannerProps {
  items: (DoubanItem & { type?: 'movie' | 'tv' })[];
  loading: boolean;
}

export default function HeroFeaturedBanner({
  items,
  loading,
}: HeroFeaturedBannerProps) {
  const router = useRouter();
  const { convert } = useLanguage();
  const [currentIndex, setCurrentIndex] = useState(0);
  const [direction, setDirection] = useState(0); // -1 for left, 1 for right
  const [favorites, setFavorites] = useState<Record<string, boolean>>({});
  const [details, setDetails] = useState<
    Record<string, { intro: string; subtitle: string }>
  >({});
  const [loadingDetails, setLoadingDetails] = useState<Record<string, boolean>>(
    {},
  );

  // Touch swipe states
  const [touchStart, setTouchStart] = useState<number | null>(null);
  const [touchEnd, setTouchEnd] = useState<number | null>(null);

  // Filter items that actually have posters
  const validItems = React.useMemo(() => {
    return items.filter((item) => item.poster && item.title).slice(0, 5);
  }, [items]);

  useEffect(() => {
    if (currentIndex >= validItems.length && validItems.length > 0) {
      setCurrentIndex(0);
    }
  }, [currentIndex, validItems.length]);

  const activeItem =
    validItems.length > 0
      ? validItems[Math.min(currentIndex, validItems.length - 1)]
      : undefined;
  const activeDetails = activeItem ? details[activeItem.id] : undefined;

  // Auto slide every 6 seconds
  useEffect(() => {
    if (validItems.length <= 1) return;
    const timer = setInterval(() => {
      setDirection(1);
      setCurrentIndex((prev) => (prev + 1) % validItems.length);
    }, 6000);
    return () => clearInterval(timer);
  }, [validItems]);

  // Check favorites
  useEffect(() => {
    if (!activeItem) return;
    const checkFavorite = async () => {
      try {
        const favorited = await isFavorited('douban', activeItem.id);
        setFavorites((prev) => ({ ...prev, [activeItem.id]: favorited }));
      } catch {
        // Safe fallback
      }
    };
    checkFavorite();
  }, [activeItem]);

  // Fetch Douban details (synopsis and genres/regions)
  useEffect(() => {
    if (!activeItem) return;
    const itemId = activeItem.id;
    if (details[itemId] || loadingDetails[itemId]) return;

    const fetchDetails = async () => {
      setLoadingDetails((prev) => ({ ...prev, [itemId]: true }));
      try {
        const itemType = activeItem.type || 'movie';
        const response = await fetch(
          `/api/douban/detail?id=${itemId}&type=${itemType}`,
        );
        if (response.ok) {
          const data = await response.json();
          setDetails((prev) => ({
            ...prev,
            [itemId]: {
              intro: data.intro || '',
              subtitle: data.subtitle || '',
            },
          }));
        }
      } catch (err) {
        console.error('Failed to fetch douban details in hero:', err);
      } finally {
        setLoadingDetails((prev) => ({ ...prev, [itemId]: false }));
      }
    };

    fetchDetails();
  }, [activeItem, details, loadingDetails]);

  const handlePrev = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (validItems.length <= 1) return;
    setDirection(-1);
    setCurrentIndex(
      (prev) => (prev - 1 + validItems.length) % validItems.length,
    );
  };

  const handleNext = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (validItems.length <= 1) return;
    setDirection(1);
    setCurrentIndex((prev) => (prev + 1) % validItems.length);
  };

  // Touch Swipe Handlers
  const handleTouchStart = (e: React.TouchEvent) => {
    setTouchEnd(null);
    setTouchStart(e.targetTouches[0].clientX);
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    setTouchEnd(e.targetTouches[0].clientX);
  };

  const handleTouchEnd = () => {
    if (!touchStart || !touchEnd) return;
    const distance = touchStart - touchEnd;
    const isLeftSwipe = distance > 50;
    const isRightSwipe = distance < -50;

    if (isLeftSwipe) {
      setDirection(1);
      setCurrentIndex((prev) => (prev + 1) % validItems.length);
    } else if (isRightSwipe) {
      setDirection(-1);
      setCurrentIndex(
        (prev) => (prev - 1 + validItems.length) % validItems.length,
      );
    }
  };

  const handlePlay = () => {
    if (!activeItem) return;
    const params = new URLSearchParams();
    params.set('title', activeItem.title.trim());
    if (activeItem.year) params.set('year', activeItem.year);
    params.set('cover', activeItem.poster);
    router.push(`/play?${params.toString()}`);
  };

  const handleFavorite = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!activeItem) return;
    const itemId = activeItem.id;
    const isFav = !!favorites[itemId];

    try {
      if (isFav) {
        await deleteFavorite('douban', itemId);
        setFavorites((prev) => ({ ...prev, [itemId]: false }));
      } else {
        await saveFavorite('douban', itemId, {
          title: activeItem.title,
          source_name: '豆瓣推荐',
          year: activeItem.year || '',
          cover: activeItem.poster,
          total_episodes: 1,
          save_time: Date.now(),
          search_title: activeItem.title,
        });
        setFavorites((prev) => ({ ...prev, [itemId]: true }));
      }
    } catch (err) {
      console.error('Failed to toggle favorite on hero:', err);
    }
  };

  if (loading) {
    return (
      <div className='relative w-full rounded-3xl overflow-hidden h-[240px] sm:h-auto sm:aspect-[2.3] md:aspect-[2.8] xl:aspect-[3.2] bg-slate-200 dark:bg-slate-900 border border-slate-200/20 dark:border-white/5 animate-pulse shadow-md'>
        <div className='absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent -translate-x-full animate-[shimmer_1.5s_infinite]'></div>
      </div>
    );
  }

  if (validItems.length === 0) return null;
  if (!activeItem) return null;

  // Animation variants
  const slideVariants = {
    enter: (dir: number) => ({
      x: dir > 0 ? 1000 : -1000,
      opacity: 0,
    }),
    center: {
      zIndex: 1,
      x: 0,
      opacity: 1,
    },
    exit: (dir: number) => ({
      zIndex: 0,
      x: dir < 0 ? 1000 : -1000,
      opacity: 0,
    }),
  };

  return (
    <div
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      style={{ touchAction: 'pan-y' }}
      className='relative w-full rounded-3xl overflow-hidden h-[240px] sm:h-auto sm:aspect-[2.3] md:aspect-[2.8] xl:aspect-[3.2] shadow-2xl border border-slate-200 dark:border-white/5 group bg-slate-100 dark:bg-black'
    >
      {/* Blurred background backdrop */}
      <AnimatePresence initial={false} custom={direction}>
        <motion.div
          key={`bg-${activeItem.id}`}
          custom={direction}
          variants={slideVariants}
          initial='enter'
          animate='center'
          exit='exit'
          transition={{
            x: { type: 'spring', stiffness: 300, damping: 30 },
            opacity: { duration: 0.5 },
          }}
          className='absolute inset-0 w-full h-full'
        >
          <Image
            src={processImageUrl(activeItem.poster)}
            alt=''
            fill
            className='object-cover filter blur-[40px] brightness-[0.85] dark:brightness-[0.15] saturate-[1.3] scale-110'
            unoptimized
            priority
          />
        </motion.div>
      </AnimatePresence>

      {/* Theme-dependent overlay grid */}
      <div className='absolute inset-0 bg-gradient-to-r from-slate-100/95 via-slate-100/60 to-transparent dark:from-black/98 dark:via-black/70 dark:to-transparent z-10' />
      <div className='absolute inset-0 bg-gradient-to-t from-slate-100/95 via-transparent to-transparent dark:from-black dark:via-transparent dark:to-transparent z-10' />

      {/* Hero content */}
      <div className='absolute inset-0 z-20 flex items-center justify-between px-4 sm:px-12 md:px-16 py-4 sm:py-6'>
        {/* Left column: metadata & action buttons */}
        <div className='w-[65%] sm:max-w-[55%] flex flex-col justify-center h-full'>
          <AnimatePresence mode='wait'>
            <motion.div
              key={`text-${activeItem.id}`}
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -15 }}
              transition={{ duration: 0.35, ease: 'easeOut' }}
              className='space-y-2 sm:space-y-4'
            >
              {/* Badge */}
              <div className='inline-flex items-center gap-1 bg-green-500/15 dark:bg-green-500/25 border border-green-500/20 dark:border-green-500/30 text-green-700 dark:text-green-300 px-2 py-0.5 sm:px-3 sm:py-1 rounded-full text-[9px] sm:text-[10px] font-black uppercase tracking-wider shadow-sm w-fit'>
                <Star
                  size={10}
                  className='fill-green-700 dark:fill-green-400 stroke-green-700 dark:stroke-green-400'
                />
                {convert('精选推荐')}
              </div>

              {/* Title */}
              <h1 className='text-lg sm:text-3xl md:text-4xl font-extrabold text-slate-900 dark:text-white tracking-tight line-clamp-1 leading-tight drop-shadow-md'>
                {convert(activeItem.title)}
              </h1>

              {/* Meta tags */}
              <div className='flex items-center flex-wrap gap-1.5 sm:gap-2.5 text-[10px] sm:text-xs text-slate-600 dark:text-slate-300 font-medium'>
                {activeItem.rate && (
                  <span className='flex items-center gap-1 bg-amber-500/90 text-slate-950 font-bold px-1.5 py-0.5 rounded-md shadow-sm'>
                    <Star
                      size={10}
                      className='fill-slate-950 stroke-slate-950'
                    />
                    {activeItem.rate}
                  </span>
                )}
                {activeItem.year && (
                  <span className='bg-slate-900/10 dark:bg-white/10 backdrop-blur-md px-2 py-0.5 rounded-md border border-slate-900/5 dark:border-white/5'>
                    {activeItem.year}
                  </span>
                )}
                <span className='bg-slate-900/10 dark:bg-white/10 backdrop-blur-md px-2.5 py-0.5 rounded-md border border-slate-900/5 dark:border-white/5 hidden sm:inline-block'>
                  {convert('高清资源')}
                </span>
                {activeDetails?.subtitle && (
                  <span className='text-xs text-slate-500 dark:text-slate-400 font-normal line-clamp-1 max-w-[50%] hidden sm:inline-block'>
                    {convert(activeDetails.subtitle)}
                  </span>
                )}
              </div>

              {/* Description/Synopsis */}
              {activeDetails?.intro ? (
                <p className='text-[11px] sm:text-sm text-slate-700 dark:text-slate-300 leading-relaxed line-clamp-2 sm:line-clamp-3 md:line-clamp-4 font-normal mt-1 opacity-90 transition-opacity max-w-[95%]'>
                  {convert(activeDetails.intro)}
                </p>
              ) : loadingDetails[activeItem.id] ? (
                <div className='space-y-2 py-1 max-w-[90%] animate-pulse'>
                  <div className='h-3 bg-slate-300 dark:bg-white/10 rounded-md w-full'></div>
                  <div className='h-3 bg-slate-300 dark:bg-white/10 rounded-md w-[90%]'></div>
                  <div className='h-3 bg-slate-300 dark:bg-white/10 rounded-md w-[75%]'></div>
                </div>
              ) : null}

              {/* Action Buttons */}
              <div className='flex items-center gap-2 sm:gap-3 pt-1 sm:pt-4'>
                <button
                  onClick={handlePlay}
                  className='flex items-center gap-1.5 bg-gradient-to-r from-green-500 to-emerald-500 hover:from-green-600 hover:to-emerald-600 text-white font-bold text-[11px] sm:text-sm px-3.5 py-2 sm:px-5 sm:py-2.5 rounded-xl shadow-lg shadow-green-500/20 hover:scale-[1.03] transition-all duration-200 cursor-pointer'
                >
                  <Play size={12} className='fill-white' />
                  <span>{convert('立即播放')}</span>
                </button>
                <button
                  onClick={handleFavorite}
                  className='flex items-center justify-center p-2 sm:p-2.5 rounded-xl bg-slate-900/10 hover:bg-slate-900/15 dark:bg-white/10 dark:hover:bg-white/20 border border-slate-900/10 dark:border-white/10 text-slate-800 dark:text-white hover:scale-[1.03] transition-all duration-200 cursor-pointer shadow-md'
                  title={
                    favorites[activeItem.id]
                      ? convert('取消收藏')
                      : convert('加入收藏')
                  }
                >
                  <Heart
                    size={13}
                    className={
                      favorites[activeItem.id]
                        ? 'fill-red-500 text-red-500'
                        : 'text-slate-800 dark:text-white'
                    }
                  />
                </button>
              </div>
            </motion.div>
          </AnimatePresence>
        </div>

        {/* Right column: Poster Image card */}
        <div className='flex items-center justify-center h-full w-[35%] sm:max-w-[40%]'>
          <AnimatePresence mode='wait'>
            <motion.div
              key={`poster-${activeItem.id}`}
              initial={{ opacity: 0, scale: 0.9, rotateY: 15 }}
              animate={{ opacity: 1, scale: 1, rotateY: 0 }}
              exit={{ opacity: 0, scale: 0.9, rotateY: -15 }}
              transition={{ duration: 0.4, ease: 'easeOut' }}
              className='relative aspect-[2/3] w-20 sm:w-32 md:w-44 rounded-2xl overflow-hidden shadow-[0_15px_35px_rgba(0,0,0,0.15)] dark:shadow-[0_15px_35px_rgba(0,0,0,0.5)] border border-slate-200/50 dark:border-white/10 hover:scale-[1.03] transition-transform duration-300'
              style={{ perspective: 1000 }}
            >
              <Image
                src={processImageUrl(activeItem.poster)}
                alt={activeItem.title}
                fill
                className='object-cover'
                unoptimized
                priority
              />
            </motion.div>
          </AnimatePresence>
        </div>
      </div>

      {/* Navigation arrows (hover show) */}
      {validItems.length > 1 && (
        <>
          <button
            onClick={handlePrev}
            className='absolute left-3 top-1/2 -translate-y-1/2 z-30 flex w-10 h-10 rounded-full items-center justify-center backdrop-blur-md bg-white/70 dark:bg-slate-950/60 text-slate-800 dark:text-slate-300 border border-slate-200/50 dark:border-white/5 shadow-md opacity-0 group-hover:opacity-100 transition-all duration-300 hover:scale-105 hover:bg-white/95 dark:hover:bg-slate-900/90 hover:text-indigo-600 dark:hover:text-violet-400 hover:border-indigo-500/30 dark:hover:border-violet-500/30 hover:shadow-lg active:scale-95 cursor-pointer'
          >
            <ChevronLeft size={18} />
          </button>
          <button
            onClick={handleNext}
            className='absolute right-3 top-1/2 -translate-y-1/2 z-30 flex w-10 h-10 rounded-full items-center justify-center backdrop-blur-md bg-white/70 dark:bg-slate-950/60 text-slate-800 dark:text-slate-300 border border-slate-200/50 dark:border-white/5 shadow-md opacity-0 group-hover:opacity-100 transition-all duration-300 hover:scale-105 hover:bg-white/95 dark:hover:bg-slate-900/90 hover:text-indigo-600 dark:hover:text-violet-400 hover:border-indigo-500/30 dark:hover:border-violet-500/30 hover:shadow-lg active:scale-95 cursor-pointer'
          >
            <ChevronRight size={18} />
          </button>
        </>
      )}

      {/* Bottom slide dots indicators */}
      {validItems.length > 1 && (
        <div className='absolute bottom-4 left-1/2 -translate-x-1/2 z-35 flex gap-2'>
          {validItems.map((_, idx) => (
            <button
              key={idx}
              onClick={() => {
                setDirection(idx > currentIndex ? 1 : -1);
                setCurrentIndex(idx);
              }}
              className={`h-1.5 rounded-full transition-all duration-300 cursor-pointer ${
                idx === currentIndex
                  ? 'w-6 bg-green-500'
                  : 'w-1.5 bg-slate-900/20 dark:bg-white/40 hover:bg-slate-900/40 dark:hover:bg-white/70'
              }`}
              aria-label={`Slide ${idx + 1}`}
            />
          ))}
        </div>
      )}
    </div>
  );
}
