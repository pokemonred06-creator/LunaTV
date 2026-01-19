'use client';

import React, { useCallback, useLayoutEffect, useRef, useState } from 'react';

import MultiLevelSelector from './MultiLevelSelector';
import WeekdaySelector from './WeekdaySelector';

// --- Types ---

interface SelectorOption {
  label: string;
  value: string;
}

interface DoubanSelectorProps {
  type: 'movie' | 'tv' | 'show' | 'anime';
  primarySelection?: string;
  secondarySelection?: string;
  onPrimaryChange: (value: string) => void;
  onSecondaryChange: (value: string) => void;
  onMultiLevelChange?: (values: Record<string, string>) => void;
  onWeekdayChange: (weekday: string) => void;
}

// --- Configuration ---

const OPTIONS_CONFIG = {
  movie: {
    primary: [
      { label: '全部', value: '全部' },
      { label: '热门电影', value: '热门' },
      { label: '最新电影', value: '最新' },
      { label: '豆瓣高分', value: '豆瓣高分' },
      { label: '冷门佳片', value: '冷门佳片' },
    ],
    secondary: [
      { label: '全部', value: '全部' },
      { label: '华语', value: '华语' },
      { label: '欧美', value: '欧美' },
      { label: '韩国', value: '韩国' },
      { label: '日本', value: '日本' },
    ],
    defaultPrimary: '全部',
    defaultSecondary: '全部',
  },
  tv: {
    primary: [
      { label: '全部', value: '全部' },
      { label: '最近热门', value: '最近热门' },
    ],
    secondary: [
      { label: '全部', value: 'tv' },
      { label: '国产', value: 'tv_domestic' },
      { label: '欧美', value: 'tv_american' },
      { label: '日本', value: 'tv_japanese' },
      { label: '韩国', value: 'tv_korean' },
      { label: '动漫', value: 'tv_animation' },
      { label: '纪录片', value: 'tv_documentary' },
    ],
    defaultPrimary: '最近热门',
    defaultSecondary: 'tv',
  },
  show: {
    primary: [
      { label: '全部', value: '全部' },
      { label: '最近热门', value: '最近热门' },
    ],
    secondary: [
      { label: '全部', value: 'show' },
      { label: '国内', value: 'show_domestic' },
      { label: '国外', value: 'show_foreign' },
    ],
    defaultPrimary: '最近热门',
    defaultSecondary: 'show',
  },
  anime: {
    primary: [
      { label: '每日放送', value: '每日放送' },
      { label: '番剧', value: '番剧' },
      { label: '剧场版', value: '剧场版' },
    ],
    secondary: [],
    defaultPrimary: '每日放送',
    defaultSecondary: '',
  },
};

// --- Component ---

const DoubanSelector: React.FC<DoubanSelectorProps> = ({
  type,
  primarySelection,
  secondarySelection,
  onPrimaryChange,
  onSecondaryChange,
  onMultiLevelChange,
  onWeekdayChange,
}) => {
  // Merged Refs for Position + Scrolling
  const primaryContainerRef = useRef<HTMLDivElement>(null);
  const secondaryContainerRef = useRef<HTMLDivElement>(null);

  // Refs rely on array indices, no need to manually reset
  const primaryButtonRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const secondaryButtonRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const [primaryIndicatorStyle, setPrimaryIndicatorStyle] = useState({
    left: 0,
    width: 0,
  });
  const [secondaryIndicatorStyle, setSecondaryIndicatorStyle] = useState({
    left: 0,
    width: 0,
  });

  // 1. Get Config
  const currentConfig = OPTIONS_CONFIG[type];
  const primaryOptions = currentConfig.primary;
  const secondaryOptions = currentConfig.secondary;

  // 2. Logic: Should we show the secondary row?
  const currentPrimary = primarySelection || currentConfig.defaultPrimary;

  const showSecondary =
    (type === 'movie' && currentPrimary !== '全部') ||
    ((type === 'tv' || type === 'show') && currentPrimary === '最近热门');

  // 3. Indicator Calculation Logic
  const updateIndicatorPosition = useCallback(
    (
      activeIndex: number,
      container: HTMLDivElement | null,
      buttons: (HTMLButtonElement | null)[],
      setIndicator: React.Dispatch<
        React.SetStateAction<{ left: number; width: number }>
      >,
    ) => {
      if (activeIndex >= 0 && buttons[activeIndex] && container) {
        const button = buttons[activeIndex];
        if (button) {
          setIndicator({
            left: button.offsetLeft,
            width: button.offsetWidth,
          });
        }
      } else if (activeIndex === -1) {
        setIndicator({ left: 0, width: 0 });
      }
    },
    [],
  );

  // 4. Handle Resize & Layout Changes
  useLayoutEffect(() => {
    const handleResize = () => {
      // Update Primary
      const pIndex = primaryOptions.findIndex(
        (opt) => opt.value === currentPrimary,
      );
      updateIndicatorPosition(
        pIndex,
        primaryContainerRef.current,
        primaryButtonRefs.current,
        setPrimaryIndicatorStyle,
      );

      // Update Secondary (Only if visible)
      if (showSecondary && secondaryContainerRef.current) {
        const currentSecondary =
          secondarySelection || currentConfig.defaultSecondary;
        const sIndex = secondaryOptions.findIndex(
          (opt) => opt.value === currentSecondary,
        );
        updateIndicatorPosition(
          sIndex,
          secondaryContainerRef.current,
          secondaryButtonRefs.current,
          setSecondaryIndicatorStyle,
        );
      }
    };

    // Use rAF to ensure refs are populated before first measurement
    requestAnimationFrame(handleResize);

    // Robust Observer
    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(() =>
        window.requestAnimationFrame(handleResize),
      );
      if (primaryContainerRef.current)
        observer.observe(primaryContainerRef.current);
      if (secondaryContainerRef.current)
        observer.observe(secondaryContainerRef.current);
      return () => observer.disconnect();
    } else {
      window.addEventListener('resize', handleResize);
      return () => window.removeEventListener('resize', handleResize);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    type,
    currentPrimary,
    secondarySelection,
    showSecondary,
    updateIndicatorPosition,
    // Note: options arrays removed from deps as they are derived from stable config + type
  ]);

  // 5. Scroll to Active Item (Secondary Only)
  useLayoutEffect(() => {
    if (!showSecondary || !secondaryContainerRef.current || !secondarySelection)
      return;

    const index = secondaryOptions.findIndex(
      (opt) => opt.value === secondarySelection,
    );
    const button = secondaryButtonRefs.current[index];

    if (button) {
      const container = secondaryContainerRef.current;
      const scrollLeft =
        button.offsetLeft - container.clientWidth / 2 + button.offsetWidth / 2;
      container.scrollTo({ left: scrollLeft, behavior: 'smooth' });
    }
  }, [secondarySelection, showSecondary, secondaryOptions]);

  // 6. Helper: Render Capsule
  const renderCapsuleSelector = (
    options: SelectorOption[],
    activeValue: string | undefined,
    onChange: (value: string) => void,
    isPrimary: boolean,
  ) => {
    const containerRef = isPrimary
      ? primaryContainerRef
      : secondaryContainerRef;
    const buttonRefs = isPrimary ? primaryButtonRefs : secondaryButtonRefs;
    const indicatorStyle = isPrimary
      ? primaryIndicatorStyle
      : secondaryIndicatorStyle;

    return (
      <div
        ref={containerRef}
        className='relative flex items-center overflow-x-auto bg-gray-200/60 dark:bg-gray-700/60 rounded-full p-1 backdrop-blur-sm [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]'
      >
        <div
          className='absolute top-1 bottom-1 bg-white dark:bg-gray-600 rounded-full shadow-sm transition-all duration-300 ease-out pointer-events-none'
          style={{
            left: `${indicatorStyle.left}px`,
            width: `${indicatorStyle.width}px`,
            opacity: indicatorStyle.width > 0 ? 1 : 0,
          }}
        />
        {options.map((option, index) => {
          const isActive = activeValue === option.value;
          return (
            <button
              key={option.value}
              ref={(el) => {
                buttonRefs.current[index] = el;
              }}
              onClick={() => onChange(option.value)}
              className={`relative z-10 px-4 py-1.5 text-sm font-medium rounded-full transition-colors duration-200 whitespace-nowrap outline-none focus-visible:ring-2 focus-visible:ring-blue-500 shrink-0 ${
                isActive
                  ? 'text-gray-900 dark:text-gray-100'
                  : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
              }`}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    );
  };

  // --- Logic for displaying Second Row ---
  const renderSecondRow = () => {
    // Special Case: Anime
    if (type === 'anime') {
      if (currentPrimary === '每日放送') {
        return (
          <div className='flex flex-col sm:flex-row sm:items-center gap-3'>
            <span className='text-sm font-medium text-gray-500 dark:text-gray-400 min-w-[40px] pt-1 sm:pt-0'>
              星期
            </span>
            <div className='w-full overflow-hidden'>
              <WeekdaySelector onWeekdayChange={onWeekdayChange} />
            </div>
          </div>
        );
      }

      const contentType =
        currentPrimary === '番剧' ? 'anime-tv' : 'anime-movie';
      return (
        <div className='flex flex-col sm:flex-row sm:items-center gap-3'>
          <span className='text-sm font-medium text-gray-500 dark:text-gray-400 min-w-[40px] pt-1 sm:pt-0'>
            筛选
          </span>
          <div className='overflow-x-auto w-full'>
            <MultiLevelSelector
              key={`anime-${contentType}-${currentPrimary}`}
              onChange={onMultiLevelChange || (() => {})}
              contentType={contentType}
            />
          </div>
        </div>
      );
    }

    // Standard Cases (Movie, TV, Show)
    if (showSecondary) {
      return (
        <div className='flex flex-col sm:flex-row sm:items-center gap-3'>
          <span className='text-sm font-medium text-gray-500 dark:text-gray-400 min-w-[40px] pt-1 sm:pt-0'>
            {type === 'movie' ? '地区' : '类型'}
          </span>
          <div className='w-full overflow-hidden'>
            {renderCapsuleSelector(
              secondaryOptions,
              secondarySelection || currentConfig.defaultSecondary,
              onSecondaryChange,
              false,
            )}
          </div>
        </div>
      );
    }

    // Fallback: MultiLevel (when primary is '全部')
    return (
      <div className='flex flex-col sm:flex-row sm:items-center gap-3'>
        <span className='text-sm font-medium text-gray-500 dark:text-gray-400 min-w-[40px] pt-1 sm:pt-0'>
          筛选
        </span>
        <div className='overflow-x-auto w-full'>
          <MultiLevelSelector
            key={`${type}-${currentPrimary}`}
            onChange={onMultiLevelChange || (() => {})}
            contentType={type}
          />
        </div>
      </div>
    );
  };

  return (
    <div className='space-y-4'>
      {/* Primary Row */}
      <div className='flex flex-col sm:flex-row sm:items-center gap-3'>
        <span className='text-sm font-medium text-gray-500 dark:text-gray-400 min-w-[40px] pt-1 sm:pt-0'>
          分类
        </span>
        <div className='w-full overflow-hidden'>
          {renderCapsuleSelector(
            primaryOptions,
            primarySelection || currentConfig.defaultPrimary,
            onPrimaryChange,
            true,
          )}
        </div>
      </div>

      {/* Secondary / Filter Row */}
      {renderSecondRow()}
    </div>
  );
};

export default DoubanSelector;
