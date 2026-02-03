'use client';

import { usePathname } from 'next/navigation';
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import {
  createRenderer,
  QualityManager,
} from '@/effects/renderer/selectRenderer';
import {
  DropState,
  Renderer,
  RenderState,
  TrailState,
} from '@/effects/renderer/types';

import PureSnow from './PureSnow';
import { generateTextures } from './SeasonalEffectsHelpers';

// -- Constants --
const CSS_PREFIX = 'se-fx';
const GRID_CELL = 40;

// -- Types --
export type Season = 'spring' | 'summer' | 'autumn' | 'winter' | 'auto' | 'off';
type ActiveSeason = 'spring' | 'summer' | 'autumn' | 'winter';
// Keep intensity names aligned with persisted admin config values
export type Intensity = 'light' | 'normal' | 'heavy';

interface SeasonalEffectsProps {
  season?: Season;
  intensity?: Intensity;
  disableMobile?: boolean;
  enabled?: boolean;
  backgroundImageUrl?: string;
}

// -- Helpers --
const isActiveSeason = (s: string): s is ActiveSeason =>
  ['spring', 'summer', 'autumn', 'winter'].includes(s);

const getCurrentSeason = (): ActiveSeason => {
  const month = new Date().getMonth() + 1;
  if (month >= 3 && month <= 5) return 'spring';
  if (month >= 6 && month <= 8) return 'summer';
  if (month >= 9 && month <= 11) return 'autumn';
  return 'winter';
};

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
    console.log('[SeasonalEffects] Observing element:', element);
    ro.observe(element);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [element]);
  return rect;
}

function usePrefersReducedMotion() {
  const [prefersReduced, setPrefersReduced] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setPrefersReduced(mq.matches);
    const handler = (e: MediaQueryListEvent) => setPrefersReduced(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);
  return prefersReduced;
}

// -- Spatial Hashing Helper for Physics --
const getGridKey = (cx: number, cy: number) => `${cx},${cy}`;

function buildDropGrid(drops: DropState[]) {
  const grid = new Map<string, number[]>();
  for (let i = 0; i < drops.length; i++) {
    const d = drops[i];
    const key = getGridKey((d.x / GRID_CELL) | 0, (d.y / GRID_CELL) | 0);
    const arr = grid.get(key);
    if (arr) arr.push(i);
    else grid.set(key, [i]);
  }
  return grid;
}

function buildTrailGrid(trails: TrailState[]) {
  const grid = new Map<string, number[]>();
  for (let i = 0; i < trails.length; i++) {
    const tr = trails[i];
    const cx0 = (Math.min(tr.x1, tr.x2) / GRID_CELL) | 0;
    const cx1 = (Math.max(tr.x1, tr.x2) / GRID_CELL) | 0;
    const cy0 = (Math.min(tr.y1, tr.y2) / GRID_CELL) | 0;
    const cy1 = (Math.max(tr.y1, tr.y2) / GRID_CELL) | 0;

    for (let cy = cy0; cy <= cy1; cy++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        const key = getGridKey(cx, cy);
        const arr = grid.get(key);
        if (arr) arr.push(i);
        else grid.set(key, [i]);
      }
    }
  }
  return grid;
}

function trailXAtY(tr: TrailState, y: number) {
  const dy = tr.y2 - tr.y1;
  if (Math.abs(dy) < 1e-4) return tr.x2;
  const t = Math.max(0, Math.min(1, (y - tr.y1) / dy));
  return tr.x1 + (tr.x2 - tr.x1) * t;
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
  // Ref for spawn accumulator to avoid React state updates in loop
  const spawnAccRef = useRef(0);
  const startTimeRef = useRef(0);

  // Physics State
  const stateRef = useRef<RenderState>({
    width: 0,
    height: 0,
    dpr: 1,
    drops: [],
    trails: [],
    canvas: null as unknown as HTMLCanvasElement,
    backgroundImage: null,
    time: 0,
  });

  // -- Context/Path Hooks --
  const pathname = usePathname();
  const isPlayerPage = pathname?.startsWith('/play/');

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

  // Debug: Monitor props
  useEffect(() => {
    if (shouldRun) {
      console.log('[SeasonalEffects] Props:', {
        activeSeason: resolvedSeason,
        intensity,
        enabled,
        hasCanvas: !!canvasRef.current,
      });
    }
  }, [resolvedSeason, intensity, enabled, shouldRun]);

  // -- Configuration Hook --
  const CONFIG = useMemo(() => {
    const cfg = {
      MAX_DROPS:
        intensity === 'heavy' ? 400 : intensity === 'normal' ? 200 : 100,
      SPAWN_PER_SEC:
        intensity === 'heavy' ? 40 : intensity === 'normal' ? 20 : 10,
      RAMP_TIME: 3.0,
      CLEAR_HOLD: 0.8,
      GROWTH_PER_SEC: 0.5,
      SHRINK_PER_SEC: 1.0,
      TRAIL_LIFE: 3.5,
      TRAIL_WIDTH: 3.0,
      GRAVITY_ACC: 450,
      TERMINAL_VEL: 600,
      GRAVITY_R: 12.0,
      GRAVITY: 180,
      TERM_V: 400,
      DRIFT: 50,
      WET_SCAN_RADIUS: 28,
      WET_SPRING: 55,
      WET_DAMP: 8.0,
      WET_VY_BOOST: 70,
      MERGE_DIST_FACTOR: 0.75,
      TRAIL_SPAWN_DY: 4.0,
      TRAIL_DECAY: 0.55,
    };
    console.log('[SeasonalEffects] Derived Config:', cfg);
    return cfg;
  }, [intensity]);

  const configRef = useRef(CONFIG);
  useEffect(() => {
    configRef.current = CONFIG;
  }, [CONFIG]);

  const rect = useElementRect(hostEl);

  // Debug: Check why initialization might stall
  useEffect(() => {
    if (shouldRun) {
      console.log('[SeasonalEffects] Init Check:', {
        shouldRun,
        hasCanvas: !!canvasRef.current,
        hasRect: !!rect,
        rectWidth: rect?.width,
        rectHeight: rect?.height,
        hasHost: !!hostEl,
      });
    }
  }, [shouldRun, rect, hostEl]);

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
      rendererRef.current?.destroy();
    };
  }, []);

  // --- RENDER LOOP & INIT ---
  useEffect(() => {
    if (!shouldRun || !canvasRef.current || !rect) return;

    const canvas = canvasRef.current;
    let active = true;

    // Reset physics on restart
    stateRef.current.drops = [];
    stateRef.current.trails = [];
    spawnAccRef.current = 0;
    // Set start time ONCE when effect starts, safe for impurity
    // but better to just use relative time in loop
    startTimeRef.current = performance.now();

    createRenderer(canvas).then((renderer) => {
      if (!active) return;
      rendererRef.current = renderer;

      const dpr = Math.min(2, window.devicePixelRatio || 1);
      renderer.resize(rect.width, rect.height, dpr);
      stateRef.current.width = rect.width;
      stateRef.current.height = rect.height;
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

      const loop = () => {
        if (!active) return;

        const now = performance.now();
        const dt = Math.min((now - lastTime) / 1000, 0.1);
        lastTime = now;
        stateRef.current.time = now / 1000;

        if (document.hidden) {
          rafRef.current = requestAnimationFrame(loop);
          return;
        }

        quality.update();

        // --- PHYSICS UPDATE START ---
        const CONFIG = configRef.current;
        const { width: w, height: h, drops, trails } = stateRef.current;

        // 1. Ramp & Spawn
        const elapsed = (now - startTimeRef.current) / 1000;
        let ramp = 0;
        if (elapsed > CONFIG.CLEAR_HOLD) {
          const x = Math.min(
            1,
            (elapsed - CONFIG.CLEAR_HOLD) / CONFIG.RAMP_TIME,
          );
          ramp = x * x * (3 - 2 * x);
        }

        if (ramp > 0) {
          spawnAccRef.current += CONFIG.SPAWN_PER_SEC * ramp * dt;

          let safety = 0;
          while (
            spawnAccRef.current >= 1 &&
            drops.length < CONFIG.MAX_DROPS &&
            safety++ < 20
          ) {
            const isRain = Math.random() < 0.4;
            const isDesktop = w >= 800; // Responsive Tuning

            // Rain: Small radius (2px), falling fast -> Streaks
            // Blob: Huge radius
            //   - Mobile: 5-13px (Looks "just right" per user)
            //   - Desktop: 2.5-6.5px (Looks "too big" if 13px)
            const r = isRain
              ? 1.5 + Math.random() * 2.0 // Rain: 1.5px-3.5px
              : isDesktop
                ? 2.5 + Math.random() * 4.0 // Desktop Blob: 2.5px-6.5px
                : 5.0 + Math.random() * 8.0; // Mobile Blob: 5px-13px

            drops.push({
              x: Math.random() * w,
              y: isRain ? -50 : Math.random() * h,
              r: r,
              vx: isRain ? (Math.random() - 0.5) * 50 : 0,
              vy: isRain ? 500 + Math.random() * 200 : 0,
              seed: Math.random(),
              wobble: Math.random(),
              stretch: isRain ? 1.0 : 0,
              age: 0,
              falling: isRain,
            });
          }
        }

        // 2. Physics & Wet Path
        const trailGrid = trails.length > 0 ? buildTrailGrid(trails) : null;

        for (let i = drops.length - 1; i >= 0; i--) {
          const d = drops[i];
          d.age += dt;

          if (!d.falling) {
            d.r = Math.min(d.r + CONFIG.GROWTH_PER_SEC * dt, 20); // Max size 20
            const threshold = CONFIG.GRAVITY_R + d.seed * 5;
            if (d.r > threshold && d.age > 0.8) {
              d.falling = true;
              d.vy = d.r * 2;
            }
          }

          if (d.falling) {
            const mass = Math.max(0.4, d.r / 6);
            d.vy = Math.min(CONFIG.TERM_V, d.vy + CONFIG.GRAVITY * mass * dt);

            const mainWander = Math.sin(d.y * 0.015 + d.seed * 10);
            const localJitter = Math.sin(d.y * 0.08 + d.seed * 20);
            const targetVx =
              (mainWander * 0.8 + localJitter * 0.2) * CONFIG.DRIFT;
            d.vx += (targetVx - d.vx) * 3.0 * dt;

            // Wet Path Attraction
            let bestDx = 0;
            let bestAbs = Infinity;
            if (trailGrid) {
              const cx = (d.x / GRID_CELL) | 0;
              const cy = (d.y / GRID_CELL) | 0;
              for (let oy = -1; oy <= 1; oy++) {
                for (let ox = -1; ox <= 1; ox++) {
                  const arr = trailGrid.get(getGridKey(cx + ox, cy + oy));
                  if (arr) {
                    for (const idx of arr) {
                      const tr = trails[idx];
                      if (
                        d.y < Math.min(tr.y1, tr.y2) - 12 ||
                        d.y > Math.max(tr.y1, tr.y2) + 12
                      )
                        continue;
                      const xOnTrail = trailXAtY(tr, d.y);
                      const dx = xOnTrail - d.x;
                      const adx = Math.abs(dx);
                      if (adx < CONFIG.WET_SCAN_RADIUS && adx < bestAbs) {
                        bestAbs = adx;
                        bestDx = dx;
                      }
                    }
                  }
                }
              }
            }
            if (bestAbs < Infinity) {
              d.vx += bestDx * CONFIG.WET_SPRING * dt;
              d.vy += CONFIG.WET_VY_BOOST * dt;
              d.vx *= Math.exp(-CONFIG.WET_DAMP * dt);
            }

            d.vx *= Math.exp(-2.5 * dt);
            d.vy *= Math.exp(-0.7 * dt);

            const oldX = d.x;
            const oldY = d.y;
            d.x += d.vx * dt;
            d.y += d.vy * dt;

            if (d.x < -60) d.x = w + 50;
            else if (d.x > w + 60) d.x = -50;

            const speed = Math.hypot(d.vx, d.vy);
            d.stretch = Math.min(1, speed / 500);

            if (d.y - oldY > CONFIG.TRAIL_SPAWN_DY) {
              trails.push({
                x1: oldX,
                y1: oldY,
                x2: d.x,
                y2: d.y,
                w: d.r * 0.65,
                life: 1,
              });
            }

            if (d.y > h + 80) {
              d.y = -30 - Math.random() * 60;
              d.x = Math.random() * w;
              d.r = 0.8 + Math.random() * 1.4;
              d.vx = 0;
              d.vy = 0;
              d.falling = false;
              d.age = 0;
              d.stretch = 0;
            }
          } else {
            d.stretch *= Math.exp(-2.0 * dt);
          }
        }

        // 3. Merging
        let grid = buildDropGrid(drops);
        const mergePass = () => {
          for (let i = 0; i < drops.length; i++) {
            const a = drops[i];
            const cx = (a.x / GRID_CELL) | 0;
            const cy = (a.y / GRID_CELL) | 0;
            for (let oy = -1; oy <= 1; oy++) {
              for (let ox = -1; ox <= 1; ox++) {
                const arr = grid.get(getGridKey(cx + ox, cy + oy));
                if (!arr) continue;
                for (const j of arr) {
                  if (j <= i || j >= drops.length) continue;
                  const b = drops[j];
                  const dx = a.x - b.x;
                  const dy = a.y - b.y;
                  const rr = (a.r + b.r) * CONFIG.MERGE_DIST_FACTOR;
                  if (dx * dx + dy * dy > rr * rr) continue;

                  const wa = a.r * a.r;
                  const wb = b.r * b.r;
                  const newR = Math.sqrt(wa + wb);
                  a.x = (a.x * wa + b.x * wb) / (wa + wb);
                  a.y = (a.y * wa + b.y * wb) / (wa + wb);
                  a.vx = (a.vx * wa + b.vx * wb) / (wa + wb);
                  a.vy = (a.vy * wa + b.vy * wb) / (wa + wb);
                  a.r = newR;
                  if (a.falling || b.falling) {
                    a.falling = true;
                    a.vy += 20;
                  }

                  drops[j] = drops[drops.length - 1];
                  drops.pop();
                  return true;
                }
              }
            }
          }
          return false;
        };

        for (let k = 0; k < 3; k++) {
          if (mergePass()) grid = buildDropGrid(drops);
          else break;
        }

        // 4. Trail Decay
        for (let i = trails.length - 1; i >= 0; i--) {
          trails[i].life -= CONFIG.TRAIL_DECAY * dt;
          if (trails[i].life <= 0) trails.splice(i, 1);
        }
        if (trails.length > 1500) trails.splice(0, trails.length - 1500);
        // --- PHYSICS UPDATE END ---

        renderer.render(stateRef.current);
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
      rendererRef.current?.destroy();
      rendererRef.current = null;
    };
  }, [shouldRun, rect]);

  if (!enabled || !mounted || resolvedSeason === 'off') return null;

  return (
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
        <PureSnow
          mode={resolvedSeason}
          count={intensity === 'heavy' ? 150 : intensity === 'normal' ? 80 : 40}
          textures={
            resolvedSeason === 'autumn'
              ? textures.leaves
              : resolvedSeason === 'spring'
                ? textures.petals
                : textures.snow
          }
        />
      )}
    </div>
  );
};
