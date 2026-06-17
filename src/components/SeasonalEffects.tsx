'use client';

import { usePathname } from 'next/navigation';
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';

import {
  createRenderer,
  QualityManager,
} from '@/effects/renderer/selectRenderer';
import { Renderer, RenderState } from '@/effects/renderer/types';

import MagicalButterfly from './MagicalButterfly';
import PhysicsSnow from './PhysicsSnow';
import { generateTextures } from './SeasonalEffectsHelpers';
import {
  createSummerPhysicsState,
  stepSummerPhysics,
  SummerPhysicsConfig,
  SummerPhysicsMutableState,
} from './SeasonalEffectsSummerPhysics';

// -- Constants --
const CSS_PREFIX = 'se-fx';
// Cap device-pixel-ratio for all effect canvases. 1.5 gives 44% fewer pixels
// than 2.0 with no perceptible quality loss on soft rain/snow, and keeping a
// single source of truth prevents the init/resize/force-resize paths from
// diverging (a mismatch causes a visible re-scale flicker on every resize).
const DPR_CAP = 1.5;

// -- Types --
export type Season = 'spring' | 'summer' | 'autumn' | 'winter' | 'auto' | 'off';
type ActiveSeason = 'spring' | 'summer' | 'autumn' | 'winter';
type SummerPhysicsWorkerMessage = {
  type: 'state';
  drops: RenderState['drops'];
  trails: RenderState['trails'];
  flash: number;
};
// Keep intensity names aligned with persisted admin config values
export type Intensity = 'light' | 'normal' | 'heavy';

interface SeasonalEffectsProps {
  season?: Season;
  intensity?: Intensity;
  disableMobile?: boolean;
  enabled?: boolean;
  backgroundImageUrl?: string;
}

function useElementRect(element: HTMLElement | null) {
  const [rect, setRect] = useState<DOMRectReadOnly | null>(null);
  useEffect(() => {
    if (!element) return;
    let raf = 0;
    const ro = new ResizeObserver((entries) => {
      const r = entries[0]?.contentRect;
      if (!r) return;
      // console.log('[SeasonalEffects] ResizeObserver fired:', r.width, r.height);
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => setRect(r));
    });

    ro.observe(element);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [element]);
  return rect;
}

export const SeasonalEffects: React.FC<SeasonalEffectsProps> = ({
  season = 'auto',
  intensity = 'normal',
  enabled = true,
  backgroundImageUrl,
}) => {
  const [mounted, setMounted] = useState(false);
  const [textures, setTextures] = useState<{
    leaves: string[];
    petals: string[];
    snow: string[];
  }>({ leaves: [], petals: [], snow: [] });

  // -- Refs --
  // Use State for host element to trigger effect on mount
  const [hostEl, setHostEl] = useState<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<Renderer | null>(null);
  const rafRef = useRef(0);
  const lastForceResizeCheckRef = useRef(0);
  const summerWorkerRef = useRef<Worker | null>(null);
  const summerWorkerBusyRef = useRef(false);
  const summerPhysicsFallbackRef = useRef<SummerPhysicsMutableState | null>(
    null,
  );
  const startTimeRef = useRef(0);

  // Physics State
  const stateRef = useRef<RenderState>({
    width: 0,
    height: 0,
    dpr: 1,
    season: 'summer', // Default, updated in loop
    drops: [],
    trails: [],
    sprites: [],
    canvas: null as unknown as HTMLCanvasElement,
    backgroundImage: null,
    assets: {},
    time: 0,
    flash: 0,
    dropsVersion: 0,
    trailsVersion: 0,
  });

  // -- Context/Path Hooks --
  const pathname = usePathname();
  const isPlayerPage =
    pathname === '/play' ||
    pathname?.startsWith('/play/') ||
    pathname === '/live' ||
    pathname?.startsWith('/live/');
  const [forceCanvas, setForceCanvas] = useState(false);

  // -- Media Query Hooks --
  const [prefersReduced, setPrefersReduced] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    setPrefersReduced(media.matches);
    const handler = (e: MediaQueryListEvent) => setPrefersReduced(e.matches);
    media.addEventListener('change', handler);
    return () => media.removeEventListener('change', handler);
  }, []);

  // -- Device Capability Detection (force Canvas2D on mobile/low-power) --
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const ua = navigator.userAgent || '';
    const coarse = window.matchMedia
      ? window.matchMedia('(pointer: coarse)').matches
      : false;
    const smallScreen = window.innerWidth < 900;
    const mobile =
      coarse ||
      smallScreen ||
      /Mobi|Android|iPhone|iPad|iPod|webOS|BlackBerry/i.test(ua);
    setIsMobile(mobile);
    setForceCanvas(mobile);
  }, []);

  // -- Season Logic --
  const isActiveSeason = useCallback(
    (s: string): s is ActiveSeason =>
      ['spring', 'summer', 'autumn', 'winter'].includes(s),
    [],
  );

  const getCurrentSeason = useCallback((): ActiveSeason => {
    const month = new Date().getMonth() + 1;
    if (month >= 3 && month <= 5) return 'spring';
    if (month >= 6 && month <= 8) return 'summer';
    if (month >= 9 && month <= 11) return 'autumn';
    return 'winter';
  }, []);

  const resolvedSeason: ActiveSeason | 'off' = useMemo(() => {
    if (!mounted || prefersReduced || isPlayerPage || !enabled) return 'off';
    if (season === 'auto') return getCurrentSeason();
    if (season === 'off') return 'off';
    if (isActiveSeason(season)) return season;
    return 'off';
  }, [
    season,
    mounted,
    prefersReduced,
    isPlayerPage,
    enabled,
    isActiveSeason,
    getCurrentSeason,
  ]);

  const shouldRun = resolvedSeason === 'summer';

  // -- Configuration Hook --
  const CONFIG = useMemo<SummerPhysicsConfig>(() => {
    // Mobile uses significantly reduced counts to maintain 60fps
    const mobileMult = isMobile ? 0.35 : 1.0;
    const cfg: SummerPhysicsConfig = {
      MAX_DROPS: Math.round(
        (intensity === 'heavy' ? 300 : intensity === 'normal' ? 150 : 80) *
          mobileMult,
      ),
      SPAWN_PER_SEC: Math.round(
        (intensity === 'heavy' ? 30 : intensity === 'normal' ? 15 : 8) *
          mobileMult,
      ),
      RAMP_TIME: 3.0,
      CLEAR_HOLD: 0.8,
      GROWTH_PER_SEC: 0.5,
      SHRINK_PER_SEC: 1.0,
      TRAIL_LIFE: 3.5,
      TRAIL_WIDTH: 3.0,
      GRAVITY_ACC: 450,
      TERMINAL_VEL: 2400, // Faster terminal velocity for rain
      GRAVITY_R: 12.0,
      GRAVITY: 300, // Stronger gravity
      TERM_V: 2000, // Higher maximum fall speed
      DRIFT: 100, // More wind drift
      WET_SCAN_RADIUS: 28,
      WET_SPRING: 55,
      WET_DAMP: 8.0,
      WET_VY_BOOST: 70,
      MERGE_DIST_FACTOR: 1.0,
      TRAIL_SPAWN_DY: isMobile ? 6.0 : 4.0, // Fewer trail segments on mobile
      TRAIL_DECAY: isMobile ? 0.8 : 0.55, // Trails die faster on mobile
    };

    return cfg;
  }, [intensity, isMobile]);

  const configRef = useRef(CONFIG);
  useEffect(() => {
    configRef.current = CONFIG;
  }, [CONFIG]);

  useEffect(() => {
    if (!shouldRun) return;
    if (summerWorkerRef.current) {
      summerWorkerRef.current.postMessage({
        type: 'config',
        config: CONFIG,
      });
    }
  }, [CONFIG, shouldRun]);

  const rect = useElementRect(hostEl);

  // Load BG
  useEffect(() => {
    if (!backgroundImageUrl) {
      stateRef.current.backgroundImage = null;
      return;
    }
    const img = new Image();
    img.crossOrigin = 'Anonymous';
    img.src = backgroundImageUrl;
    img.onload = () => {
      stateRef.current.backgroundImage = img;
    };
  }, [backgroundImageUrl]);

  useEffect(() => {
    setMounted(true);
    setTextures(generateTextures());
    return () => {
      cancelAnimationFrame(rafRef.current);
      summerWorkerRef.current?.terminate();
      summerWorkerRef.current = null;
      rendererRef.current?.destroy();
    };
  }, []);

  // --- RENDER LOOP & INIT ---
  useEffect(() => {
    // Note: We don't block on !rect anymore, to allow init and then resize later
    if (!shouldRun || !canvasRef.current) return;
    const rectSafe = rect || {
      width: 0,
      height: 0,
      top: 0,
      left: 0,
      bottom: 0,
      right: 0,
      x: 0,
      y: 0,
      toJSON: () => {},
    };

    const canvas = canvasRef.current;
    let active = true;

    // Reset physics on restart
    stateRef.current.drops = [];
    stateRef.current.trails = [];
    stateRef.current.flash = 0;
    // Set start time ONCE when effect starts, safe for impurity
    // but better to just use relative time in loop
    startTimeRef.current = performance.now();
    summerWorkerBusyRef.current = false;
    summerPhysicsFallbackRef.current = createSummerPhysicsState(
      startTimeRef.current,
    );

    if (typeof Worker !== 'undefined') {
      try {
        const worker = new Worker(
          new URL('./SeasonalEffectsSummerWorker.ts', import.meta.url),
        );
        worker.onmessage = (
          event: MessageEvent<SummerPhysicsWorkerMessage>,
        ) => {
          if (!active || event.data.type !== 'state') return;
          stateRef.current.drops = event.data.drops;
          stateRef.current.trails = event.data.trails;
          stateRef.current.flash = event.data.flash;
          // Bump version counters so renderer knows to re-upload GPU buffers
          stateRef.current.dropsVersion++;
          stateRef.current.trailsVersion++;
          summerWorkerBusyRef.current = false;
        };
        worker.postMessage({
          type: 'reset',
          startTime: startTimeRef.current,
          config: configRef.current,
        });
        summerWorkerRef.current?.terminate();
        summerWorkerRef.current = worker;
      } catch {
        summerWorkerRef.current = null;
      }
    } else {
      summerWorkerRef.current = null;
    }

    createRenderer(canvas, {
      forceCanvas: forceCanvas || prefersReduced,
      adaptive: true,
    }).then((renderer) => {
      if (!active) return;
      rendererRef.current = renderer;

      const dpr = Math.min(DPR_CAP, window.devicePixelRatio || 1);
      renderer.resize(rectSafe.width, rectSafe.height, dpr);
      stateRef.current.width = rectSafe.width;
      stateRef.current.height = rectSafe.height;
      stateRef.current.dpr = dpr;

      // Safe Context Restore Wiring
      const onLost = (e: Event) => {
        e.preventDefault();
        renderer.onContextLost();
      };
      const onRestored = async () => {
        await renderer.onContextRestored();
        // Force resize trigger after restore
        if (active && rect) renderer.resize(rect.width, rect.height, dpr);
      };
      canvas.addEventListener('webglcontextlost', onLost);
      canvas.addEventListener('webglcontextrestored', onRestored);

      let lastTime = performance.now();
      const quality = new QualityManager();
      let frameCount = 0;
      // Render gate: only call renderer.render() at 24fps max.
      // Rain is ambient — 24fps is visually identical to 60fps.
      // This alone cuts GPU command submission by ~60%.
      const RENDER_INTERVAL = 1000 / 24; // ms per render frame
      let renderAccum = 0;
      // Physics gate: tick worker at 20fps max to cut serialization overhead.
      const PHYSICS_INTERVAL = 1000 / 20; // ms per physics tick
      let physicsAccum = PHYSICS_INTERVAL; // Start ready to tick immediately

      const loop = () => {
        if (!active) return;

        const now = performance.now();
        const rawMs = now - lastTime; // elapsed ms — computed BEFORE updating lastTime
        const dt = Math.min(rawMs / 1000, 0.1);
        lastTime = now;
        stateRef.current.time = now / 1000;
        stateRef.current.season = resolvedSeason;

        if (document.hidden) {
          rafRef.current = requestAnimationFrame(loop);
          return;
        }

        // --- FORCE RESIZE (Fix Magnification) ---
        // Ensure canvas resolution matches DOM 1:1 every frame
        // Use getBoundingClientRect to account for potential CSS transforms
        if (now - lastForceResizeCheckRef.current > 250) {
          lastForceResizeCheckRef.current = now;
          const rect = canvas.getBoundingClientRect();
          const dpr = Math.min(DPR_CAP, window.devicePixelRatio || 1);
          const targetW = Math.round(rect.width * dpr);
          const targetH = Math.round(rect.height * dpr);

          // Allow small tolerance (2px)
          if (
            targetW > 0 &&
            targetH > 0 &&
            (Math.abs(canvas.width - targetW) > 2 ||
              Math.abs(canvas.height - targetH) > 2)
          ) {
            renderer.resize(rect.width, rect.height, dpr);
            stateRef.current.width = rect.width;
            stateRef.current.height = rect.height;
            stateRef.current.dpr = dpr;
          }
        }

        quality.update();
        frameCount++;

        // --- PHYSICS TICK (20fps max) ---
        // Worker postMessage + structured-clone is expensive; 20fps is plenty for rain.
        physicsAccum += rawMs;
        const physicsConfig = configRef.current;
        if (physicsAccum >= PHYSICS_INTERVAL) {
          physicsAccum = Math.min(
            physicsAccum - PHYSICS_INTERVAL,
            PHYSICS_INTERVAL,
          ); // carry remainder, cap to 1 tick debt
          if (summerWorkerRef.current) {
            if (!summerWorkerBusyRef.current) {
              summerWorkerBusyRef.current = true;
              summerWorkerRef.current.postMessage({
                type: 'tick',
                now,
                dt: PHYSICS_INTERVAL / 1000,
                width: stateRef.current.width,
                height: stateRef.current.height,
              });
            }
          } else if (summerPhysicsFallbackRef.current) {
            const nextState = stepSummerPhysics(
              summerPhysicsFallbackRef.current,
              {
                now,
                dt: PHYSICS_INTERVAL / 1000,
                width: stateRef.current.width,
                height: stateRef.current.height,
                config: physicsConfig,
              },
            );
            stateRef.current.drops = nextState.drops;
            stateRef.current.trails = nextState.trails;
            stateRef.current.flash = nextState.flash;
            stateRef.current.dropsVersion++;
            stateRef.current.trailsVersion++;
          }
        }

        // --- RENDER GATE (24fps max) ---
        // Rain at 24fps is visually identical to 60fps — cuts GPU work by ~60%.
        renderAccum += rawMs;
        if (renderAccum >= RENDER_INTERVAL) {
          renderAccum = Math.min(
            renderAccum - RENDER_INTERVAL,
            RENDER_INTERVAL,
          ); // carry, cap to 1-frame debt
          renderer.render(stateRef.current);
        }
        rafRef.current = requestAnimationFrame(loop);
      };

      rafRef.current = requestAnimationFrame(loop);

      return () => {
        canvas.removeEventListener('webglcontextlost', onLost);
        canvas.removeEventListener('webglcontextrestored', onRestored);
      };
    });

    return () => {
      active = false;
      cancelAnimationFrame(rafRef.current);
      summerWorkerRef.current?.terminate();
      summerWorkerRef.current = null;
      summerPhysicsFallbackRef.current = null;
      rendererRef.current?.destroy();
      rendererRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shouldRun, resolvedSeason]); // Intentionally exclude rect to prevent re-init loop

  // New: Handle Resize separately without destroying renderer
  useEffect(() => {
    if (rendererRef.current && rect) {
      const dpr = Math.min(DPR_CAP, window.devicePixelRatio || 1);
      rendererRef.current.resize(rect.width, rect.height, dpr);
      stateRef.current.width = rect.width;
      stateRef.current.height = rect.height;
      stateRef.current.dpr = dpr;
      // console.log('[SeasonalEffects] Resized:', rect.width, rect.height);
    }
  }, [rect]);

  if (!enabled || !mounted || resolvedSeason === 'off') return null;

  return createPortal(
    <div
      ref={setHostEl}
      className={`${CSS_PREFIX}-container`}
      style={{
        position: 'fixed',
        inset: 0,
        pointerEvents: 'none',
        zIndex: 50,
        overflow: 'hidden',
      }}
    >
      {resolvedSeason === 'summer' && (
        <canvas
          ref={canvasRef}
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
          }}
        />
      )}

      {resolvedSeason !== 'summer' && (
        <PhysicsSnow
          mode={resolvedSeason as 'spring' | 'autumn' | 'winter'}
          count={CONFIG.MAX_DROPS}
        />
      )}

      {resolvedSeason === 'spring' && (
        <MagicalButterfly
          count={intensity === 'heavy' ? 6 : intensity === 'normal' ? 4 : 2}
        />
      )}
    </div>,
    document.body,
  );
};
