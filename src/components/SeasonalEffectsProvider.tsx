'use client';

import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useState,
} from 'react';

import type { Intensity, Season } from './SeasonalEffects';
import SeasonalEffects from './SeasonalEffects';

interface SeasonalEffectsContextType {
  enabled: boolean;
  season: Season;
  intensity: Intensity;
  loading: boolean;
  getCurrentSeasonName: () => string;
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
      }}
    >
      {children}
      {mounted && (
        <SeasonalEffects
          season={season}
          intensity={intensity}
          enabled={enabled}
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
