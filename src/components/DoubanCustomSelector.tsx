'use client';

import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

interface CustomCategory {
  name: string;
  type: 'movie' | 'tv';
  query: string;
}

interface DoubanCustomSelectorProps {
  customCategories: CustomCategory[];
  primarySelection?: string;
  secondarySelection?: string;
  onPrimaryChange: (value: string) => void;
  onSecondaryChange: (value: string) => void;
}

const DoubanCustomSelector: React.FC<DoubanCustomSelectorProps> = ({
  customCategories,
  primarySelection,
  secondarySelection,
  onPrimaryChange,
  onSecondaryChange,
}) => {
  // Merged Refs: These now handle BOTH positioning and scrolling
  const primaryContainerRef = useRef<HTMLDivElement>(null);
  const secondaryContainerRef = useRef<HTMLDivElement>(null);

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

  // 1. Generate Options
  const primaryOptions = useMemo(() => {
    const types = Array.from(new Set(customCategories.map((cat) => cat.type)));
    const sortedTypes = types.sort((a, b) => {
      if (a === 'movie' && b !== 'movie') return -1;
      if (a !== 'movie' && b === 'movie') return 1;
      return 0;
    });
    return sortedTypes.map((type) => ({
      label: type === 'movie' ? '电影' : '剧集',
      value: type,
    }));
  }, [customCategories]);

  const secondaryOptions = useMemo(() => {
    if (!primarySelection) return [];
    return customCategories
      .filter((cat) => cat.type === primarySelection)
      .map((cat) => ({
        label: cat.name || cat.query,
        value: cat.query,
      }));
  }, [customCategories, primarySelection]);

  // 2. Ref Hygiene
  useEffect(() => {
    primaryButtonRefs.current = [];
  }, [primaryOptions.length]);
  useEffect(() => {
    secondaryButtonRefs.current = [];
  }, [secondaryOptions.length]);

  // 3. Auto-select defaults
  useEffect(() => {
    if (primaryOptions.length > 0 && !primarySelection) {
      onPrimaryChange(primaryOptions[0].value);
    }
  }, [primaryOptions, primarySelection, onPrimaryChange]);

  useEffect(() => {
    if (secondaryOptions.length > 0) {
      const exists = secondaryOptions.find(
        (opt) => opt.value === secondarySelection,
      );
      if (!exists) {
        onSecondaryChange(secondaryOptions[0].value);
      }
    }
  }, [secondaryOptions, secondarySelection, onSecondaryChange]);

  // 4. Indicator Calculation
  // Since container and scroll are merged, offsetLeft is always correct
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

  // 5. Layout & Resize Handling
  useLayoutEffect(() => {
    const handleResize = () => {
      const pIndex = primaryOptions.findIndex(
        (opt) => opt.value === primarySelection,
      );
      updateIndicatorPosition(
        pIndex,
        primaryContainerRef.current,
        primaryButtonRefs.current,
        setPrimaryIndicatorStyle,
      );

      const sIndex = secondaryOptions.findIndex(
        (opt) => opt.value === secondarySelection,
      );
      updateIndicatorPosition(
        sIndex,
        secondaryContainerRef.current,
        secondaryButtonRefs.current,
        setSecondaryIndicatorStyle,
      );
    };

    handleResize();

    // Guard against environments without ResizeObserver
    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(() => {
        window.requestAnimationFrame(handleResize);
      });
      if (primaryContainerRef.current)
        observer.observe(primaryContainerRef.current);
      if (secondaryContainerRef.current)
        observer.observe(secondaryContainerRef.current);
      return () => observer.disconnect();
    } else {
      // Fallback
      window.addEventListener('resize', handleResize);
      return () => window.removeEventListener('resize', handleResize);
    }
  }, [
    primarySelection,
    secondarySelection,
    primaryOptions,
    secondaryOptions,
    updateIndicatorPosition,
  ]);

  // 6. Manual Scroll-to-Center (Replaces scrollIntoView)
  const scrollToActive = (
    container: HTMLDivElement | null,
    buttons: (HTMLButtonElement | null)[],
    selection: string | undefined,
    options: { value: string }[],
  ) => {
    if (!container || !selection) return;
    const index = options.findIndex((opt) => opt.value === selection);
    const button = buttons[index];

    if (button) {
      // Calculate center position
      const scrollLeft =
        button.offsetLeft - container.clientWidth / 2 + button.offsetWidth / 2;
      container.scrollTo({ left: scrollLeft, behavior: 'smooth' });
    }
  };

  useEffect(() => {
    scrollToActive(
      secondaryContainerRef.current,
      secondaryButtonRefs.current,
      secondarySelection,
      secondaryOptions,
    );
  }, [secondarySelection, secondaryOptions]);

  // 7. Optimized Wheel Handler
  const handleWheel = useCallback((e: WheelEvent) => {
    const container = e.currentTarget as HTMLDivElement;
    if (container.scrollWidth <= container.clientWidth) return;

    const isVerticalScroll = Math.abs(e.deltaY) > Math.abs(e.deltaX);
    if (!isVerticalScroll) return;

    const { scrollLeft, scrollWidth, clientWidth } = container;
    const delta = e.deltaY;

    const canScrollRight = scrollLeft + clientWidth < scrollWidth - 1;
    const canScrollLeft = scrollLeft > 1;

    if ((delta > 0 && canScrollRight) || (delta < 0 && canScrollLeft)) {
      e.preventDefault();
      // Use rAF for smoother scroll
      requestAnimationFrame(() => {
        container.scrollLeft += delta;
      });
    }
  }, []);

  useEffect(() => {
    const el = secondaryContainerRef.current;
    if (el) {
      el.addEventListener('wheel', handleWheel, { passive: false });
      return () => el.removeEventListener('wheel', handleWheel);
    }
  }, [handleWheel, secondaryOptions]);

  // Render Helper
  const renderCapsuleSelector = (
    options: { label: string; value: string }[],
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
        {/* Animated Background Indicator */}
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

  if (!customCategories || customCategories.length === 0) return null;

  return (
    <div className='space-y-4'>
      {/* Primary Selector */}
      <div className='flex flex-col sm:flex-row sm:items-center gap-3'>
        <span className='text-sm font-medium text-gray-500 dark:text-gray-400 min-w-[40px] pt-1 sm:pt-0'>
          类型
        </span>
        <div className='w-full sm:w-auto overflow-hidden'>
          {renderCapsuleSelector(
            primaryOptions,
            primarySelection,
            onPrimaryChange,
            true,
          )}
        </div>
      </div>

      {/* Secondary Selector */}
      {secondaryOptions.length > 0 && (
        <div className='flex flex-col sm:flex-row sm:items-center gap-3'>
          <span className='text-sm font-medium text-gray-500 dark:text-gray-400 min-w-[40px] pt-1 sm:pt-0'>
            片单
          </span>
          <div className='w-full overflow-hidden'>
            {renderCapsuleSelector(
              secondaryOptions,
              secondarySelection,
              onSecondaryChange,
              false,
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default DoubanCustomSelector;
