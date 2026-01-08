'use client';

import { useEffect, useRef, useState, memo, useCallback } from 'react';
import { usePathname } from 'next/navigation';

export type Season = 'spring' | 'summer' | 'autumn' | 'winter' | 'auto' | 'off';
type ActiveSeason = 'spring' | 'summer' | 'autumn' | 'winter';

interface CSSParticle {
  id: number;
  x: number;
  size: number;
  duration: number;
  delay: number;
  opacity: number;
  emoji: string;
  swayAmount: number;
  layer: 'front' | 'back';
}

export interface SeasonalEffectsProps {
  season?: Season;
  intensity?: 'light' | 'normal' | 'heavy';
  enabled?: boolean;
}

const getCurrentSeason = (): ActiveSeason => {
  const month = new Date().getMonth() + 1;
  if (month >= 3 && month <= 5) return 'spring';
  if (month >= 6 && month <= 8) return 'summer';
  if (month >= 9 && month <= 11) return 'autumn';
  return 'winter';
};

const seasonConfig: Record<ActiveSeason, {
  primary: { emoji: string; minSize: number; maxSize: number };
  secondary: { emoji: string; minSize: number; maxSize: number };
  particleRatio: number;
  minDuration: number;
  maxDuration: number;
  background: string;
}> = {
  spring: {
    primary: { emoji: '🌸', minSize: 16, maxSize: 26 },
    secondary: { emoji: '💧', minSize: 8, maxSize: 14 },
    particleRatio: 0.6,
    minDuration: 8,
    maxDuration: 15,
    background: 'linear-gradient(180deg, rgba(255,182,193,0.03) 0%, transparent 100%)',
  },
  summer: {
    primary: { emoji: '🍃', minSize: 14, maxSize: 24 },
    secondary: { emoji: '💧', minSize: 10, maxSize: 16 },
    particleRatio: 0.4,
    minDuration: 5,
    maxDuration: 10,
    background: 'linear-gradient(180deg, rgba(144,238,144,0.03) 0%, transparent 100%)',
  },
  autumn: {
    primary: { emoji: '🍁', minSize: 18, maxSize: 30 },
    secondary: { emoji: '🍂', minSize: 16, maxSize: 26 },
    particleRatio: 0.6,
    minDuration: 10,
    maxDuration: 18,
    background: 'linear-gradient(180deg, rgba(255,99,71,0.03) 0%, transparent 100%)',
  },
  winter: {
    primary: { emoji: '❄️', minSize: 12, maxSize: 26 },
    secondary: { emoji: '❅', minSize: 10, maxSize: 20 },
    particleRatio: 0.7,
    minDuration: 12,
    maxDuration: 22,
    background: 'linear-gradient(180deg, rgba(224,255,255,0.05) 0%, transparent 100%)',
  },
};

const intensityConfig = {
  light: 20,
  normal: 35,
  heavy: 55,
};

const isActiveSeason = (s: Season): s is ActiveSeason => {
  return s === 'spring' || s === 'summer' || s === 'autumn' || s === 'winter';
};

// Generate CSS keyframes dynamically for each particle
const generateKeyframes = (swayAmount: number, id: number): string => {
  const keyframeName = `fall-${id}`;
  return `
    @keyframes ${keyframeName} {
      0% {
        transform: translate3d(0, -5vh, 0) rotate(0deg);
      }
      25% {
        transform: translate3d(${swayAmount}px, 25vh, 0) rotate(90deg);
      }
      50% {
        transform: translate3d(${-swayAmount * 0.5}px, 50vh, 0) rotate(180deg);
      }
      75% {
        transform: translate3d(${swayAmount * 0.7}px, 75vh, 0) rotate(270deg);
      }
      100% {
        transform: translate3d(${-swayAmount * 0.3}px, 105vh, 0) rotate(360deg);
      }
    }
  `;
};

const SeasonalEffects: React.FC<SeasonalEffectsProps> = memo(({
  season = 'auto',
  intensity = 'normal',
  enabled = true,
}) => {
  const [particles, setParticles] = useState<CSSParticle[]>([]);
  const styleRef = useRef<HTMLStyleElement | null>(null);
  const pathname = usePathname();
  const isPlayPage = pathname?.startsWith('/play');
  
  const [isVideoPlaying, setIsVideoPlaying] = useState(false);
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);

  // Video detection for play page
  useEffect(() => {
    if (!isPlayPage) {
      setIsVideoPlaying(false);
      return;
    }
    
    const checkVideoPlaying = () => {
      const video = document.querySelector('video');
      if (video) {
        const hasSource = video.src || video.querySelector('source');
        setIsVideoPlaying(!!hasSource);
      }
    };
    
    checkVideoPlaying();
    const observer = new MutationObserver(checkVideoPlaying);
    observer.observe(document.body, { childList: true, subtree: true });
    
    document.addEventListener('play', checkVideoPlaying, true);
    document.addEventListener('loadeddata', checkVideoPlaying, true);
    
    return () => {
      observer.disconnect();
      document.removeEventListener('play', checkVideoPlaying, true);
      document.removeEventListener('loadeddata', checkVideoPlaying, true);
    };
  }, [isPlayPage]);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
      setPrefersReducedMotion(mediaQuery.matches);
      const handler = (e: MediaQueryListEvent) => setPrefersReducedMotion(e.matches);
      mediaQuery.addEventListener('change', handler);
      return () => mediaQuery.removeEventListener('change', handler);
    }
  }, []);

  const resolvedSeason: ActiveSeason | 'off' = season === 'auto' 
    ? getCurrentSeason() 
    : (isActiveSeason(season) ? season : 'off');
  
  const config = isActiveSeason(resolvedSeason) ? seasonConfig[resolvedSeason] : null;
  const particleCount = intensityConfig[intensity];

  // Generate particles with CSS animations
  const generateParticles = useCallback(() => {
    if (!config) return [];
    
    const newParticles: CSSParticle[] = [];
    const width = typeof window !== 'undefined' ? window.innerWidth : 1920;
    
    for (let i = 0; i < particleCount; i++) {
      const isPrimary = Math.random() < config.particleRatio;
      const particleConfig = isPrimary ? config.primary : config.secondary;
      const layer = Math.random() < 0.6 ? 'back' : 'front';
      const sizeMultiplier = layer === 'front' ? 1.15 : 0.9;
      const opacityMultiplier = layer === 'front' ? 1 : 0.7;
      
      newParticles.push({
        id: i,
        x: Math.random() * width,
        size: (particleConfig.minSize + Math.random() * (particleConfig.maxSize - particleConfig.minSize)) * sizeMultiplier,
        duration: config.minDuration + Math.random() * (config.maxDuration - config.minDuration),
        delay: Math.random() * -20, // Negative delay so particles start at random points
        opacity: (0.5 + Math.random() * 0.4) * opacityMultiplier,
        emoji: particleConfig.emoji,
        swayAmount: 30 + Math.random() * 60,
        layer,
      });
    }
    
    return newParticles;
  }, [config, particleCount]);

  // Create and inject CSS keyframes
  useEffect(() => {
    const shouldDisable = !enabled || prefersReducedMotion || resolvedSeason === 'off' || !config || (isPlayPage && isVideoPlaying);
    
    if (shouldDisable) {
      setParticles([]);
      if (styleRef.current) {
        styleRef.current.remove();
        styleRef.current = null;
      }
      return;
    }
    
    const newParticles = generateParticles();
    setParticles(newParticles);
    
    // Generate and inject keyframes CSS
    const keyframesCSS = newParticles.map(p => generateKeyframes(p.swayAmount, p.id)).join('\n');
    
    if (!styleRef.current) {
      styleRef.current = document.createElement('style');
      document.head.appendChild(styleRef.current);
    }
    styleRef.current.textContent = keyframesCSS;
    
    return () => {
      if (styleRef.current) {
        styleRef.current.remove();
        styleRef.current = null;
      }
    };
  }, [enabled, prefersReducedMotion, resolvedSeason, config, isPlayPage, isVideoPlaying, generateParticles]);

  // Handle window resize
  useEffect(() => {
    const handleResize = () => {
      const newParticles = generateParticles();
      setParticles(newParticles);
    };
    
    window.addEventListener('resize', handleResize, { passive: true });
    return () => window.removeEventListener('resize', handleResize);
  }, [generateParticles]);

  const shouldHide = !enabled || prefersReducedMotion || resolvedSeason === 'off' || !config || (isPlayPage && isVideoPlaying);
  
  if (shouldHide || particles.length === 0) {
    return null;
  }

  const backParticles = particles.filter(p => p.layer === 'back');
  const frontParticles = particles.filter(p => p.layer === 'front');

  const containerStyle: React.CSSProperties = {
    position: 'fixed',
    top: 0,
    left: 0,
    width: '100%',
    height: '100%',
    pointerEvents: 'none',
    overflow: 'hidden',
    // GPU acceleration
    transform: 'translate3d(0, 0, 0)',
    backfaceVisibility: 'hidden',
    WebkitBackfaceVisibility: 'hidden',
    contain: 'strict',
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
        // CSS animation - runs on compositor thread, unaffected by main thread
        animation: `fall-${particle.id} ${particle.duration}s linear ${particle.delay}s infinite`,
        // Force GPU layer
        willChange: 'transform',
        backfaceVisibility: 'hidden',
        WebkitBackfaceVisibility: 'hidden',
      }}
    >
      {particle.emoji}
    </div>
  );

  return (
    <>
      {/* Back layer - behind content */}
      <div style={{ ...containerStyle, zIndex: -1, background: config.background }} aria-hidden="true">
        {backParticles.map(renderParticle)}
      </div>
      
      {/* Front layer - in front of cards */}
      <div style={{ ...containerStyle, zIndex: 5 }} aria-hidden="true">
        {frontParticles.map(renderParticle)}
      </div>
    </>
  );
});

SeasonalEffects.displayName = 'SeasonalEffects';

export default SeasonalEffects;
