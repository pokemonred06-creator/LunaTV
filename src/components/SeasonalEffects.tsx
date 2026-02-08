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
import {
  DropState,
  Renderer,
  RenderState,
  TrailState,
} from '@/effects/renderer/types';

import MagicalButterfly from './MagicalButterfly';
import PhysicsSnow, { type PosterBounds } from './PhysicsSnow';
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
  posterBounds?: PosterBounds[]; // Update to array
  posterElements?: Map<string, HTMLElement>; // New: Direct DOM access
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
  posterBounds,
  posterElements,
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
  const lastForceResizeCheckRef = useRef(0);

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
      TERMINAL_VEL: 1200, // Increased from 600
      GRAVITY_R: 12.0,
      GRAVITY: 150, // Increased from 80
      TERM_V: 1000, // Increased from 200 (was the bottleneck)
      DRIFT: 50,
      WET_SCAN_RADIUS: 28,
      WET_SPRING: 55,
      WET_DAMP: 8.0,
      WET_VY_BOOST: 70,
      MERGE_DIST_FACTOR: 1.0,
      TRAIL_SPAWN_DY: 4.0,
      TRAIL_DECAY: 0.55,
    };

    return cfg;
  }, [intensity]);

  const configRef = useRef(CONFIG);
  useEffect(() => {
    configRef.current = CONFIG;
  }, [CONFIG]);

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
    spawnAccRef.current = 0;
    // Set start time ONCE when effect starts, safe for impurity
    // but better to just use relative time in loop
    startTimeRef.current = performance.now();

    createRenderer(canvas, {
      forceCanvas: forceCanvas || prefersReduced,
      adaptive: true,
    }).then((renderer) => {
      if (!active) return;
      rendererRef.current = renderer;

      const dpr = Math.min(2, window.devicePixelRatio || 1);
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

      const loop = () => {
        if (!active) return;

        const now = performance.now();
        const dt = Math.min((now - lastTime) / 1000, 0.1);
        lastTime = now;
        stateRef.current.time = now / 1000;
        stateRef.current.season = resolvedSeason; // Sync season for Renderer

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
          const dpr = Math.min(2, window.devicePixelRatio || 1);
          const targetW = Math.round(rect.width * dpr);
          const targetH = Math.round(rect.height * dpr);

          // Allow small tolerance (2px)
          if (
            targetW > 0 &&
            targetH > 0 &&
            (Math.abs(canvas.width - targetW) > 2 ||
              Math.abs(canvas.height - targetH) > 2)
          ) {
            // console.log('[SeasonalEffects] Resizing to:', targetW, targetH);
            renderer.resize(rect.width, rect.height, dpr);
            stateRef.current.width = rect.width;
            stateRef.current.height = rect.height;
            stateRef.current.dpr = dpr;
          }
        }

        quality.update();

        // --- PHYSICS UPDATE START ---
        const CONFIG = configRef.current;
        const {
          width: w,
          height: h,
          drops,
          trails,
          sprites,
        } = stateRef.current;

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
        }

        // --- PHYSICS UPDATE ---
        // Branch based on season
        // SUMMER: Drops (Rain/Condense)
        // OTHERS: Sprites (Snow/Petals/Leaves)

        if (resolvedSeason === 'summer') {
          // ... Existing Summer Spawn Logic ...
          while (
            spawnAccRef.current >= 1 &&
            drops.length < CONFIG.MAX_DROPS
            // ... safety ...
          ) {
            spawnAccRef.current -= 1;
            // ... Spawn Drop Code ...
            const isRain = Math.random() < 0.8;
            const isDesktop = w >= 800;
            const r = isRain
              ? 1.5 + Math.random() * 2.5
              : isDesktop
                ? 2.5 + Math.random() * 4.0
                : 3.0 + Math.random() * 4.0;

            drops.push({
              x: 20 + Math.random() * (w - 40), // Add margin to avoid edge clipping
              y: isRain ? -50 : Math.random() * h,
              r: r,
              vx: isRain ? (Math.random() - 0.5) * 50 : 0,
              vy: isRain ? 600 + Math.random() * 200 : 0,
              seed: Math.random(),
              wobble: Math.random(),
              stretch: isRain ? 1.0 : 0,
              age: 0,
              falling: isRain,
              isRain: isRain,
              trailY: 0,
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
              d.vy = 0; // Start from standstill, let gravity accelerate it
            }
          }

          if (d.falling) {
            const mass = Math.max(0.4, d.r / 6);

            // --- NEW: Hanging / Rivulet Speed Modulation ---
            // Procedural "gravity" that occasionally pauses (hangs)
            const speedMod = Math.max(
              0.1,
              Math.sin(d.y * 0.05 + d.seed * 50.0) * 0.5 + 0.5,
            );
            const gravityForce = CONFIG.GRAVITY * mass * speedMod;
            d.vy = Math.min(CONFIG.TERM_V, d.vy + gravityForce * dt);

            // --- NEW: Enhanced Zigzag Drift ---
            const zigzagFrequency = 0.03 + d.seed * 0.02;
            const zigzagAmplitude = CONFIG.DRIFT * 1.5;
            const targetVx =
              Math.sin(d.y * zigzagFrequency + d.seed * 20.0) * zigzagAmplitude;
            d.vx += (targetVx - d.vx) * 4.0 * dt;

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

            if (d.x < 20) d.x = 20;
            else if (d.x > w - 20) d.x = w - 20;

            const speed = Math.hypot(d.vx, d.vy);
            d.stretch = Math.min(1, speed / 500);

            d.trailY = (d.trailY || 0) + (d.y - oldY);

            if (d.trailY > CONFIG.TRAIL_SPAWN_DY && !d.isRain) {
              const trailWidth = d.r * 0.65;
              // Connect from Previous Trail End (CurrentY - AccumulatedY) to CurrentY
              trails.push({
                x1: d.x - d.vx * dt * (d.trailY / (d.y - oldY || 1)), // Approx X backtrace
                y1: d.y - d.trailY,
                x2: d.x,
                y2: d.y,
                w: trailWidth,
                life: 1,
              });

              d.trailY = 0; // Reset accumulator

              // Mass Loss: Drop shrinks as it leaves a trail
              // Reduce radius slightly for every segment spawned
              if (d.r > 1.5) {
                d.r -= 0.05;
              }
            }

            // Recycle with variety
            if (d.y > h + 80) {
              d.y = -30 - Math.random() * 60;
              d.x = 20 + Math.random() * (w - 40); // Add margin here too
              // Mix in small static-ish beads during recycle
              const isBead = Math.random() > 0.6;
              d.r = isBead
                ? 1.0 + Math.random() * 1.5
                : 2.0 + Math.random() * 3.0;
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

                  // Physics Separation: Rain cannot merge with Condensation
                  if (a.isRain !== b.isRain) continue;

                  const dx = a.x - b.x;
                  const dy = a.y - b.y;
                  const rr = (a.r + b.r) * CONFIG.MERGE_DIST_FACTOR;
                  if (dx * dx + dy * dy > rr * rr) continue;

                  const wa = a.r * a.r;
                  const wb = b.r * b.r;
                  const newR = Math.sqrt(wa + wb);
                  a.x = (a.x * wa + b.x * wb) / (wa + wb);
                  a.y = (a.y * wa + b.y * wb) / (wa + wb);
                  // Collision Logic:
                  // If hitting with high speed -> Continue falling (momentum).
                  // If low speed -> Pause (surface tension).
                  const incomingSpeed = Math.max(a.vy, b.vy);

                  if (incomingSpeed > 300) {
                    a.vy = incomingSpeed * 0.9; // Conserve most momentum
                    a.vx = 0;
                  } else {
                    a.vx = 0;
                    a.vy = 10; // Pause moment
                  }

                  a.r = newR;
                  if (a.falling || b.falling) {
                    a.falling = true;
                    // Removed vy += 20;
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

        // 5. Flash Logic (Thunder)
        // Decay existing flash
        if (stateRef.current.flash > 0) {
          stateRef.current.flash *= 0.92; // Rapid decay
          if (stateRef.current.flash < 0.01) stateRef.current.flash = 0;
        }
        // Random Trigger (approx every 30-40 seconds)
        // 0.0005 at 60fps = ~1 flash every 33s
        if (stateRef.current.flash === 0 && Math.random() < 0.0005) {
          // Double flash pattern? Simple single flash for now.
          stateRef.current.flash = 1.0;
        }

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shouldRun, resolvedSeason]); // Intentionally exclude rect to prevent re-init loop

  // New: Handle Resize separately without destroying renderer
  useEffect(() => {
    if (rendererRef.current && rect) {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
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
          mode={resolvedSeason}
          count={intensity === 'heavy' ? 150 : intensity === 'normal' ? 80 : 40}
          posterBounds={posterBounds}
          posterElements={posterElements}
        />
      )}

      {resolvedSeason === 'spring' && (
        <MagicalButterfly
          count={intensity === 'heavy' ? 6 : intensity === 'normal' ? 4 : 2}
          posterBounds={posterBounds}
        />
      )}
    </div>,
    document.body,
  );
};
