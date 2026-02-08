'use client';

import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useState,
} from 'react';

import type { PosterBounds } from './PhysicsSnow';
import type { Intensity, Season } from './SeasonalEffects';
import { SeasonalEffects } from './SeasonalEffects';

interface SeasonalEffectsContextType {
  enabled: boolean;
  season: Season;
  intensity: Intensity;
  loading: boolean;
  getCurrentSeasonName: () => string;
  backgroundImage: string | null;
  setBackgroundImage: (url: string | null) => void;
  posterBounds: PosterBounds[]; // Change to array
  posterElements: Map<string, HTMLElement>; // Expose direct elements
  registerPosterFrame: (id: string, element: HTMLElement | null) => void; // Add ID for tracking
}

const SeasonalEffectsContext = createContext<
  SeasonalEffectsContextType | undefined
>(undefined);

const seasonNames: Record<Season, string> = {
  spring: '春季 🌸',
  summer: '夏季 🍃',
  autumn: '秋季 🍁',
  winter: '冬季 ❄️',
  auto: '自动',
  off: '关闭',
};

export const SeasonalEffectsProvider: React.FC<{ children: ReactNode }> = ({
  children,
}) => {
  const [enabled, setEnabled] = useState(false);
  const [season, setSeason] = useState<Season>('auto');
  const [intensity, setIntensity] = useState<Intensity>('normal');
  const [loading, setLoading] = useState(true);
  const [mounted, setMounted] = useState(false);
  const [backgroundImage, setBackgroundImage] = useState<string | null>(null);
  const [posterElements, setPosterElements] = useState<
    Map<string, HTMLElement>
  >(new Map());
  const [posterBounds, setPosterBounds] = useState<PosterBounds[]>([]);

  // Register poster frame element and track its bounds
  const registerPosterFrame = useCallback(
    (id: string, element: HTMLElement | null) => {
      setPosterElements((prev) => {
        // Prevent update if reference hasn't changed
        if (prev.get(id) === element) return prev;

        const next = new Map(prev);
        if (element) {
          next.set(id, element);
        } else {
          next.delete(id);
        }
        return next;
      });
    },
    [],
  );

  // Update bounds for all registered elements
  useEffect(() => {
    if (posterElements.size === 0) {
      setPosterBounds([]);
      return;
    }

    const updateAllBounds = () => {
      const newBounds: PosterBounds[] = [];
      posterElements.forEach((element, key) => {
        const rect = element.getBoundingClientRect();
        newBounds.push({
          key,
          top: rect.top,
          left: rect.left,
          right: rect.right,
          width: rect.width,
          height: rect.height,
          bottom: rect.bottom,
        });
      });
      setPosterBounds(newBounds);
    };

    // Throttle to one layout read/write per animation frame.
    let raf = 0;
    let scheduled = false;
    const scheduleUpdate = () => {
      if (scheduled) return;
      scheduled = true;
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        scheduled = false;
        updateAllBounds();
      });
    };

    scheduleUpdate();

    window.addEventListener('scroll', scheduleUpdate, { passive: true });
    window.addEventListener('resize', scheduleUpdate, { passive: true });

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('scroll', scheduleUpdate);
      window.removeEventListener('resize', scheduleUpdate);
    };
  }, [posterElements]);

  // Fetch config from server on mount
  useEffect(() => {
    const fetchConfig = async () => {
      try {
        const response = await fetch('/api/seasonal-effects');
        if (response.ok) {
          const config = await response.json();
          setEnabled(config.enabled ?? false);
          setSeason(config.season ?? 'auto');
          setIntensity(config.intensity ?? 'normal');
        }
      } catch (error) {
        console.warn('Failed to fetch seasonal effects config:', error);
      } finally {
        setLoading(false);
        setMounted(true);
      }
    };

    fetchConfig();
  }, []);

  const getCurrentSeasonName = useCallback(() => {
    if (season === 'auto') {
      const month = new Date().getMonth() + 1;
      if (month >= 3 && month <= 5) return seasonNames.spring;
      if (month >= 6 && month <= 8) return seasonNames.summer;
      if (month >= 9 && month <= 11) return seasonNames.autumn;
      return seasonNames.winter;
    }
    return seasonNames[season];
  }, [season]);

  return (
    <SeasonalEffectsContext.Provider
      value={{
        enabled,
        season,
        intensity,
        loading,
        getCurrentSeasonName,
        backgroundImage,
        setBackgroundImage,
        posterBounds,
        posterElements, // Expose direct elements for physics engine
        registerPosterFrame,
      }}
    >
      {children}
      {mounted && (
        <SeasonalEffects
          season={season}
          intensity={intensity}
          enabled={enabled}
          backgroundImageUrl={backgroundImage || undefined}
          posterBounds={posterBounds}
          posterElements={posterElements} // Pass to SeasonalEffects
        />
      )}
    </SeasonalEffectsContext.Provider>
  );
};

export const useSeasonalEffects = () => {
  const context = useContext(SeasonalEffectsContext);
  if (context === undefined) {
    throw new Error(
      'useSeasonalEffects must be used within a SeasonalEffectsProvider',
    );
  }
  return context;
};

// Export season options for admin settings UI
export const seasonOptions: { value: Season; label: string }[] = [
  { value: 'auto', label: '自动（根据月份）' },
  { value: 'spring', label: '春季 - 樱花雨 🌸💧' },
  { value: 'summer', label: '夏季 - 绿叶雨 🍃💧' },
  { value: 'autumn', label: '秋季 - 红枫落叶 🍁🍂' },
  { value: 'winter', label: '冬季 - 雪花飘落 ❄️' },
  { value: 'off', label: '关闭效果' },
];

export const intensityOptions: { value: Intensity; label: string }[] = [
  { value: 'light', label: '轻柔' },
  { value: 'normal', label: '正常' },
  { value: 'heavy', label: '浓密' },
];
