'use client';

import { usePathname } from 'next/navigation';
import { memo, useCallback, useEffect, useMemo, useState } from 'react';

// -- Types --
export type Season = 'spring' | 'summer' | 'autumn' | 'winter' | 'auto' | 'off';
type ActiveSeason = 'spring' | 'summer' | 'autumn' | 'winter';

interface CSSParticle {
  id: string;
  x: number;
  size: number;
  duration: number;
  delay: number;
  opacity: number;
  emoji: string;
  motionIndex: number;
  layer: 'front' | 'back';
}

export interface SeasonalEffectsProps {
  season?: Season;
  intensity?: 'light' | 'normal' | 'heavy';
  enabled?: boolean;
}

// -- Constants & Module State --
const MOTION_VARIANTS_COUNT = 12;
const STYLE_TAG_ID = 'seasonal-effects-styles';
const STYLE_VERSION = '1.0';

// Singleton Ref-Count
let styleRefCount = 0;

const getCurrentSeason = (): ActiveSeason => {
  const month = new Date().getMonth() + 1;
  if (month >= 3 && month <= 5) return 'spring';
  if (month >= 6 && month <= 8) return 'summer';
  if (month >= 9 && month <= 11) return 'autumn';
  return 'winter';
};

// -- Configuration --
const seasonConfig: Record<
  ActiveSeason,
  {
    primary: { emoji: string; minSize: number; maxSize: number };
    secondary: { emoji: string; minSize: number; maxSize: number };
    particleRatio: number;
    minDuration: number;
    maxDuration: number;
    background: string;
    atmosphere?: {
      type: 'rain' | 'snow';
      opacity: number;
      speed: number;
    };
  }
> = {
  spring: {
    primary: { emoji: '🌸', minSize: 16, maxSize: 26 },
    secondary: { emoji: '💧', minSize: 8, maxSize: 14 },
    particleRatio: 0.6,
    minDuration: 8,
    maxDuration: 15,
    background:
      'linear-gradient(180deg, rgba(255,182,193,0.03) 0%, transparent 100%)',
    atmosphere: { type: 'rain', opacity: 0.08, speed: 0.7 },
  },
  summer: {
    primary: { emoji: '🍃', minSize: 14, maxSize: 24 },
    secondary: { emoji: '💧', minSize: 10, maxSize: 16 },
    particleRatio: 0.4,
    minDuration: 5,
    maxDuration: 10,
    background:
      'linear-gradient(180deg, rgba(144,238,144,0.03) 0%, transparent 100%)',
    atmosphere: { type: 'rain', opacity: 0.1, speed: 0.5 },
  },
  autumn: {
    primary: { emoji: '🍁', minSize: 18, maxSize: 30 },
    secondary: { emoji: '🍂', minSize: 16, maxSize: 26 },
    particleRatio: 0.6,
    minDuration: 10,
    maxDuration: 18,
    background:
      'linear-gradient(180deg, rgba(255,99,71,0.03) 0%, transparent 100%)',
  },
  winter: {
    primary: { emoji: '❄️', minSize: 12, maxSize: 26 },
    secondary: { emoji: '❅', minSize: 10, maxSize: 20 },
    particleRatio: 0.7,
    minDuration: 12,
    maxDuration: 22,
    background:
      'linear-gradient(180deg, rgba(224,255,255,0.05) 0%, transparent 100%)',
    atmosphere: { type: 'snow', opacity: 0.15, speed: 15 },
  },
};

const intensityConfig = {
  light: 20,
  normal: 35,
  heavy: 55,
};

const isActiveSeason = (s: Season): s is ActiveSeason => {
  return ['spring', 'summer', 'autumn', 'winter'].includes(s);
};

// -- Style Generators (GPU Optimized) --

const generateMotionStyles = (): string => {
  let styles = '';
  for (let i = 0; i < MOTION_VARIANTS_COUNT; i++) {
    const swayAmount = 30 + Math.random() * 60;
    styles += `
      @keyframes season-fall-${i} {
        0% { transform: translate3d(0, -10vh, 0) rotate(0deg); }
        25% { transform: translate3d(${swayAmount}px, 25vh, 0) rotate(90deg); }
        50% { transform: translate3d(${-swayAmount * 0.5}px, 50vh, 0) rotate(180deg); }
        75% { transform: translate3d(${swayAmount * 0.7}px, 75vh, 0) rotate(270deg); }
        100% { transform: translate3d(${-swayAmount * 0.3}px, 110vh, 0) rotate(360deg); }
      }
    `;
  }
  return styles;
};

const generateAtmosphereStyles = (): string => {
  return `
    @keyframes season-rain-move {
      0%   { transform: translate3d(0, -40%, 0); }
      100% { transform: translate3d(10%, 40%, 0); }
    }
    @keyframes season-snow-drift {
      0%   { transform: translate3d(-5%, -2%, 0); opacity: 0.35; }
      50%  { transform: translate3d(5%,  2%, 0); opacity: 0.70; }
      100% { transform: translate3d(-5%, -2%, 0); opacity: 0.35; }
    }
  `;
};

// -- Sub-Component: Atmosphere Layer --
const AtmosphereLayer = memo(function AtmosphereLayer({
  type,
  opacity,
  speed,
  playState,
  baseStyle,
}: {
  type: 'rain' | 'snow';
  opacity: number;
  speed: number;
  playState: 'paused' | 'running';
  baseStyle: React.CSSProperties;
}) {
  const wrapperStyle: React.CSSProperties = {
    ...baseStyle,
    zIndex: 1,
    opacity,
    transform: 'translateZ(0)',
    WebkitTransform: 'translateZ(0)', // iOS Safari optimization
  };

  const sheetCommon: React.CSSProperties = {
    position: 'absolute',
    inset: '-50%',
    transform: 'translate3d(0,0,0)',
    backfaceVisibility: 'hidden',
    willChange: 'transform, opacity',
    animationPlayState: playState,
  };

  if (type === 'rain') {
    return (
      <div style={wrapperStyle} aria-hidden='true'>
        <div
          style={{
            ...sheetCommon,
            backgroundImage:
              'repeating-linear-gradient(100deg, rgba(255,255,255,0) 0 8px, rgba(255,255,255,0.18) 8px 10px, rgba(255,255,255,0) 10px 18px)',
            backgroundSize: 'auto',
            filter: 'blur(0.5px)',
            animation: `season-rain-move ${Math.max(0.2, speed)}s linear infinite`,
          }}
        />
      </div>
    );
  }

  return (
    <div style={wrapperStyle} aria-hidden='true'>
      <div
        style={{
          ...sheetCommon,
          backgroundImage:
            'radial-gradient(circle at 20% 30%, rgba(255,255,255,0.35), transparent 55%),' +
            'radial-gradient(circle at 70% 40%, rgba(255,255,255,0.25), transparent 60%),' +
            'radial-gradient(circle at 50% 80%, rgba(255,255,255,0.22), transparent 60%)',
          filter: 'blur(2px)',
          animation: `season-snow-drift ${Math.max(1, speed)}s ease-in-out infinite`,
        }}
      />
    </div>
  );
});

// -- Main Component --
const SeasonalEffects: React.FC<SeasonalEffectsProps> = memo(
  ({ season = 'auto', intensity = 'normal', enabled = true }) => {
    const [particles, setParticles] = useState<CSSParticle[]>([]);
    const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);
    const [isTabHidden, setIsTabHidden] = useState(false);

    const pathname = usePathname();
    const isPlayPage = pathname?.startsWith('/play');

    useEffect(() => {
      if (typeof window === 'undefined') return;
      const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
      setPrefersReducedMotion(mq.matches);
      const handler = (e: MediaQueryListEvent | MediaQueryList) => {
        setPrefersReducedMotion('matches' in e ? e.matches : mq.matches);
      };
      if ('addEventListener' in mq) {
        mq.addEventListener('change', handler as EventListener);
        return () => mq.removeEventListener('change', handler as EventListener);
      } else {
        // @ts-expect-error Legacy Safari
        mq.addListener(handler);
        // @ts-expect-error Legacy Safari
        return () => mq.removeListener(handler);
      }
    }, []);

    useEffect(() => {
      if (typeof document === 'undefined') return;
      const handleVisibilityChange = () => setIsTabHidden(document.hidden);
      document.addEventListener('visibilitychange', handleVisibilityChange);
      return () =>
        document.removeEventListener(
          'visibilitychange',
          handleVisibilityChange,
        );
    }, []);

    const resolvedSeason: ActiveSeason | 'off' = useMemo(() => {
      if (season === 'auto') return getCurrentSeason();
      return isActiveSeason(season) ? season : 'off';
    }, [season]);

    const config = isActiveSeason(resolvedSeason)
      ? seasonConfig[resolvedSeason]
      : null;
    const particleCount = intensityConfig[intensity];
    const shouldDisable =
      !enabled ||
      prefersReducedMotion ||
      resolvedSeason === 'off' ||
      !config ||
      isPlayPage;

    const generateParticles = useCallback(() => {
      if (!config) return [];

      const newParticles: CSSParticle[] = [];
      const width = typeof window !== 'undefined' ? window.innerWidth : 1000;
      const timestamp = Date.now();

      for (let i = 0; i < particleCount; i++) {
        const isPrimary = Math.random() < config.particleRatio;
        const particleConfig = isPrimary ? config.primary : config.secondary;
        const layer = Math.random() < 0.6 ? 'back' : 'front';
        const sizeMultiplier = layer === 'front' ? 1.15 : 0.9;
        const opacityMultiplier = layer === 'front' ? 1 : 0.7;

        newParticles.push({
          id: `${timestamp}-${i}`,
          x: Math.random() * width,
          size:
            (particleConfig.minSize +
              Math.random() *
                (particleConfig.maxSize - particleConfig.minSize)) *
            sizeMultiplier,
          duration:
            config.minDuration +
            Math.random() * (config.maxDuration - config.minDuration),
          delay: Math.random() * -20,
          opacity: (0.5 + Math.random() * 0.4) * opacityMultiplier,
          emoji: particleConfig.emoji,
          motionIndex: Math.floor(Math.random() * MOTION_VARIANTS_COUNT),
          layer,
        });
      }
      return newParticles;
    }, [config, particleCount]);

    // -- 4. Styles Management (Correct Types + Empty Content Check) --
    useEffect(() => {
      if (shouldDisable) {
        setParticles([]);
        return;
      }

      setParticles(generateParticles());

      let acquired = false;
      styleRefCount++;
      acquired = true;

      // Fix 1: Cast to HTMLStyleElement for safe .dataset access
      let styleTag = document.getElementById(
        STYLE_TAG_ID,
      ) as HTMLStyleElement | null;

      if (!styleTag) {
        styleTag = document.createElement('style');
        styleTag.id = STYLE_TAG_ID;
        document.head.appendChild(styleTag);
      }

      // Fix 2: Refresh if version mismatches OR content is empty (HMR resilience)
      const needsRefresh =
        styleTag.dataset.version !== STYLE_VERSION || !styleTag.textContent;

      if (needsRefresh) {
        styleTag.textContent =
          generateMotionStyles() + generateAtmosphereStyles();
        styleTag.dataset.version = STYLE_VERSION;
      }

      return () => {
        if (!acquired) return;
        styleRefCount--;
        if (styleRefCount <= 0) {
          styleRefCount = 0;
          const tag = document.getElementById(STYLE_TAG_ID);
          if (tag) tag.remove();
        }
      };
    }, [shouldDisable, generateParticles]);

    useEffect(() => {
      if (shouldDisable) return;
      let timeoutId: ReturnType<typeof setTimeout>;
      const handleResize = () => {
        clearTimeout(timeoutId);
        timeoutId = setTimeout(() => {
          setParticles(generateParticles());
        }, 300);
      };
      window.addEventListener('resize', handleResize, { passive: true });
      return () => {
        window.removeEventListener('resize', handleResize);
        clearTimeout(timeoutId);
      };
    }, [shouldDisable, generateParticles]);

    if (shouldDisable || particles.length === 0) {
      return null;
    }

    const backParticles = particles.filter((p) => p.layer === 'back');
    const frontParticles = particles.filter((p) => p.layer === 'front');
    const playState = isTabHidden ? 'paused' : 'running';

    const containerStyle: React.CSSProperties = {
      position: 'fixed',
      top: 0,
      left: 0,
      width: '100%',
      height: '100%',
      pointerEvents: 'none',
      overflow: 'hidden',
      contain: 'layout paint size',
      WebkitTransform: 'translateZ(0)', // iOS Optimization
    };

    const renderParticle = (particle: CSSParticle) => (
      <div
        key={particle.id}
        style={{
          position: 'absolute',
          left: particle.x,
          top: 0,
          fontSize: particle.size,
          opacity: particle.opacity,
          animation: `season-fall-${particle.motionIndex} ${particle.duration}s linear ${particle.delay}s infinite`,
          animationPlayState: playState,
        }}
        aria-hidden='true'
      >
        {particle.emoji}
      </div>
    );

    return (
      <>
        <div
          style={{
            ...containerStyle,
            zIndex: 0,
            background: config!.background,
          }}
          aria-hidden='true'
        />

        {config?.atmosphere && (
          <AtmosphereLayer
            type={config.atmosphere.type}
            opacity={config.atmosphere.opacity}
            speed={config.atmosphere.speed}
            playState={playState}
            baseStyle={containerStyle}
          />
        )}

        <div style={{ ...containerStyle, zIndex: 2 }} aria-hidden='true'>
          {backParticles.map(renderParticle)}
        </div>

        <div style={{ ...containerStyle, zIndex: 50 }} aria-hidden='true'>
          {frontParticles.map(renderParticle)}
        </div>
      </>
    );
  },
);

SeasonalEffects.displayName = 'SeasonalEffects';

export default SeasonalEffects;
