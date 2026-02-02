import { usePathname } from 'next/navigation';
import React, { memo, useEffect, useMemo, useRef, useState } from 'react';

import PureSnow from './PureSnow';
import { generateTextures } from './SeasonalEffectsHelpers';

// -- Constants --
const CSS_PREFIX = 'se-fx';

// -- Types --
export type Season = 'spring' | 'summer' | 'autumn' | 'winter' | 'auto' | 'off';
type ActiveSeason = 'spring' | 'summer' | 'autumn' | 'winter';
export type Intensity = 'gentle' | 'normal' | 'dense';

interface SeasonalEffectsProps {
  season?: Season;
  intensity?: Intensity;
  disableMobile?: boolean;
  enabled?: boolean;
}

// -- Helpers --
const isActiveSeason = (s: string): s is ActiveSeason => {
  return ['spring', 'summer', 'autumn', 'winter'].includes(s);
};

const getCurrentSeason = (): ActiveSeason => {
  const month = new Date().getMonth() + 1;
  if (month >= 3 && month <= 5) return 'spring';
  if (month >= 6 && month <= 8) return 'summer';
  if (month >= 9 && month <= 11) return 'autumn';
  return 'winter';
};

function useSafeResizeObserver<T extends Element>(
  ref: React.RefObject<T | null>,
  callback: (entry: DOMRectReadOnly) => void,
) {
  useEffect(() => {
    if (!ref.current) return;
    const obs = new ResizeObserver((entries) => {
      if (!entries[0]) return;
      callback(entries[0].contentRect);
    });
    obs.observe(ref.current);
    return () => obs.disconnect();
  }, [ref, callback]);
}

// -- Glass Layer (Production Physics - Summer) --

// Types for Physics Engine
type GlassDrop = {
  x: number;
  y: number;
  r: number; // radius
  vx: number;
  vy: number;
  seed: number; // For stable random shape
  wobble: number; // 0..1
  stretch: number; // 0..1
  age: number; // seconds
  falling: boolean;
};

type GlassTrail = {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  w: number;
  life: number; // 0..1
};

// Spatial Hash Helpers
const GRID_CELL = 42;
const getGridKey = (cx: number, cy: number) => (cx << 16) ^ cy;

const buildGrid = (drops: GlassDrop[]) => {
  const grid = new Map<number, number[]>();
  for (let i = 0; i < drops.length; i++) {
    const d = drops[i];
    const k = getGridKey((d.x / GRID_CELL) | 0, (d.y / GRID_CELL) | 0);
    let arr = grid.get(k);
    if (!arr) {
      arr = [];
      grid.set(k, arr);
    }
    arr.push(i);
  }
  return grid;
};

// Drawing Helpers (No Clip Optimization)
const drawDrop = (
  ctx: CanvasRenderingContext2D,
  d: GlassDrop,
  t: number,
  ramp: number,
  cfg: { WOBBLE_AMP: number; WOBBLE_SPEED: number },
) => {
  const wob = d.wobble;
  const baseR = d.r;

  // Stretch: faster falling = more vertical elongation
  const aspect = 1 + d.stretch * 0.55;
  const rx = baseR * (1 - d.stretch * 0.18);
  const ry = baseR * aspect;

  // Irregular outline via few points (poly-blob)
  const steps = 9;
  ctx.beginPath();
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    // Noise function for organic edge
    const n =
      Math.sin(a * 3.0 + d.seed * 9.1 + t * cfg.WOBBLE_SPEED) * 0.6 +
      Math.cos(a * 2.0 + d.seed * 4.7 + t * cfg.WOBBLE_SPEED * 0.8) * 0.4;
    const edge = 1 + n * (cfg.WOBBLE_AMP * wob);
    const px = Math.cos(a) * rx * edge;
    const py = Math.sin(a) * ry * edge;
    if (i === 0) ctx.moveTo(d.x + px, d.y + py);
    else ctx.lineTo(d.x + px, d.y + py);
  }
  ctx.closePath();

  // 1. Body gradient (fake refraction depth)
  const g = ctx.createRadialGradient(
    d.x - rx * 0.22,
    d.y - ry * 0.25,
    Math.max(1, baseR * 0.15),
    d.x,
    d.y,
    baseR * 1.25,
  );
  // Alpha ramps in with condensation
  const alpha = 0.1 * ramp;
  g.addColorStop(0, `rgba(255,255,255,${0.11 * ramp})`);
  g.addColorStop(0.55, `rgba(255,255,255,${0.03 * ramp})`);
  g.addColorStop(1, `rgba(0,0,0,${0.22 * ramp})`);
  ctx.fillStyle = g;
  ctx.fill();

  // 2. Rim (thin bright edge, meniscus)
  ctx.lineWidth = Math.max(0.6, baseR * 0.08);
  ctx.strokeStyle = `rgba(255,255,255,${0.1 * ramp})`;
  ctx.stroke();

  // 3. Specular highlight (Top-Left)
  ctx.beginPath();
  ctx.ellipse(
    d.x - rx * 0.28,
    d.y - ry * 0.33,
    Math.max(0.8, rx * 0.22),
    Math.max(0.6, ry * 0.12),
    -0.35,
    0,
    Math.PI * 2,
  );
  ctx.fillStyle = `rgba(255,255,255,${(0.22 + 0.12 * wob) * ramp})`;
  ctx.fill();

  // 4. Inner shadow (Bottom-Right, fake caustics)
  ctx.beginPath();
  ctx.ellipse(
    d.x + rx * 0.2,
    d.y + ry * 0.22,
    rx * 0.55,
    ry * 0.4,
    0.2,
    0,
    Math.PI * 2,
  );
  ctx.fillStyle = `rgba(0,0,0,${alpha})`;
  ctx.fill();
};

const drawTrails = (ctx: CanvasRenderingContext2D, trails: GlassTrail[]) => {
  ctx.lineCap = 'round';
  for (let i = 0; i < trails.length; i++) {
    const tr = trails[i];
    const a = tr.life;

    // Double stroke for feathering
    // Core
    ctx.globalAlpha = a * 0.1;
    ctx.lineWidth = tr.w * 1.6;
    ctx.strokeStyle = 'rgba(255,255,255,0.6)';
    ctx.beginPath();
    ctx.moveTo(tr.x1, tr.y1);
    ctx.lineTo(tr.x2, tr.y2);
    ctx.stroke();

    // Sharp
    ctx.globalAlpha = a * 0.18;
    ctx.lineWidth = tr.w;
    ctx.strokeStyle = 'rgba(255,255,255,0.45)';
    ctx.beginPath();
    ctx.moveTo(tr.x1, tr.y1);
    ctx.lineTo(tr.x2, tr.y2);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
};

const GlassLayer = memo(({ intensity }: { intensity: Intensity }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // State Refs (Mutable)
  const stateRef = useRef({
    drops: [] as GlassDrop[],
    trails: [] as GlassTrail[],
    startTime: 0,
    spawnAcc: 0,
    width: 0,
    height: 0,
  });

  // Config
  const CONFIG = useMemo(
    () => ({
      // Spawning
      MAX_DROPS:
        intensity === 'dense' ? 900 : intensity === 'normal' ? 500 : 220,
      SPAWN_PER_SEC:
        intensity === 'dense' ? 28 : intensity === 'normal' ? 16 : 7,
      RAMP_TIME: 3.0, // seconds: clear -> full
      CLEAR_HOLD: 0.8, // seconds: hold clear
      MICRO_R_MAX: 2.2, // max radius for new micro drops

      // Physics
      GROWTH_PER_SEC: 0.35,
      MERGE_DIST_FACTOR: 0.62,
      GRAVITY_R: 4.0, // radius threshold to fall
      GRAVITY: 420, // px/s^2
      DRAG_X: 2.5,
      DRAG_Y: 0.7,
      TERM_V: 900,
      DRIFT: 25,

      // Visuals
      WOBBLE_SPEED: 2.2,
      WOBBLE_AMP: 0.14,
      TRAIL_SPAWN_DY: 2.0,
      TRAIL_DECAY: 0.55,
    }),
    [intensity],
  );

  useSafeResizeObserver(canvasRef, (rect) => {
    const c = canvasRef.current;
    if (!c) return;
    const dpr = Math.min(
      2,
      typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1,
    );

    c.width = rect.width * dpr;
    c.height = rect.height * dpr;

    stateRef.current.width = rect.width;
    stateRef.current.height = rect.height;

    // Reset on resize
    stateRef.current.drops = [];
    stateRef.current.trails = [];
    stateRef.current.startTime = Date.now();
  });

  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext('2d');
    if (!ctx) return;

    let raf = 0;
    let lastTime = Date.now();
    stateRef.current.startTime = Date.now();

    const loop = () => {
      const now = Date.now();
      const dt = Math.min((now - lastTime) / 1000, 0.1);
      lastTime = now;

      const { width: w, height: h, drops, trails } = stateRef.current;
      if (w === 0) {
        raf = requestAnimationFrame(loop);
        return;
      }

      const dpr = c.width / w;

      // 1. Ramp Logic
      const elapsed = (now - stateRef.current.startTime) / 1000;
      let ramp = 0;
      if (elapsed > CONFIG.CLEAR_HOLD) {
        const x = Math.min(1, (elapsed - CONFIG.CLEAR_HOLD) / CONFIG.RAMP_TIME);
        ramp = x * x * (3 - 2 * x); // smoothstep
      }

      // 2. Spawning (Condensation)
      const targetCount = Math.floor(CONFIG.MAX_DROPS * ramp);
      if (ramp > 0) {
        stateRef.current.spawnAcc += CONFIG.SPAWN_PER_SEC * ramp * dt;
        while (stateRef.current.spawnAcc >= 1 && drops.length < targetCount) {
          stateRef.current.spawnAcc -= 1;
          drops.push({
            x: Math.random() * w,
            y: Math.random() * h,
            r: 0.7 + Math.random() * Math.min(CONFIG.MICRO_R_MAX, 2.0),
            vx: 0,
            vy: 0,
            seed: Math.random(),
            wobble: Math.random(),
            stretch: 0,
            age: 0,
            falling: false,
          });
        }
      }

      // 3. Physics & Trails
      for (let i = drops.length - 1; i >= 0; i--) {
        const d = drops[i];
        d.age += dt;

        // Growth phase
        if (!d.falling) {
          d.r = Math.min(d.r + CONFIG.GROWTH_PER_SEC * dt, 10);
          if (d.r > CONFIG.GRAVITY_R && d.age > 0.8) d.falling = true;
        }

        // Falling Motion
        if (d.falling) {
          const mass = Math.max(0.4, d.r / 6);
          d.vy = Math.min(CONFIG.TERM_V, d.vy + CONFIG.GRAVITY * mass * dt);

          // Snake drift
          d.vx += Math.sin(d.y * 0.03 + d.seed * 10) * CONFIG.DRIFT * dt;

          // Drag
          d.vx *= Math.exp(-CONFIG.DRAG_X * dt);
          d.vy *= Math.exp(-CONFIG.DRAG_Y * dt);

          const oldX = d.x;
          const oldY = d.y;
          d.x += d.vx * dt;
          d.y += d.vy * dt;

          // Stretch
          const speed = Math.min(600, Math.hypot(d.vx, d.vy));
          d.stretch = Math.min(1, speed / 500);

          // Spawn Trail
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

          // Respawn loop (recycle as micro drop at top)
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
          d.stretch *= Math.exp(-2.0 * dt); // Relax stretch
        }
      }

      // Trail Decay
      for (let i = trails.length - 1; i >= 0; i--) {
        trails[i].life -= CONFIG.TRAIL_DECAY * dt;
        if (trails[i].life <= 0) trails.splice(i, 1);
      }
      // Safety cap (FIFO)
      if (trails.length > 1200) trails.splice(0, trails.length - 1200);

      // 4. Spatial Hash Merging
      // Rebuild grid once per frame then iterate
      // We repeat 3 times to cascade merges fast
      let grid = buildGrid(drops);

      // Let's implement the simpler merge loop provided by user exactly
      // "tryMergeDrops" adapted for valid TS scope
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

                // Dist Check
                const dx = a.x - b.x;
                const dy = a.y - b.y;
                const rr = (a.r + b.r) * CONFIG.MERGE_DIST_FACTOR;
                if (dx * dx + dy * dy > rr * rr) continue;

                // Merge B into A
                const area = a.r * a.r + b.r * b.r;
                const newR = Math.sqrt(area);

                const wa = a.r * a.r,
                  wb = b.r * b.r;
                a.x = (a.x * wa + b.x * wb) / (wa + wb);
                a.y = (a.y * wa + b.y * wb) / (wa + wb);
                a.vx = (a.vx * wa + b.vx * wb) / (wa + wb);
                a.vy = (a.vy * wa + b.vy * wb) / (wa + wb);
                a.r = newR;
                a.wobble = Math.max(a.wobble, b.wobble) * 0.92 + 0.08;
                a.age = Math.min(a.age, b.age);
                a.falling = a.falling || b.falling;

                // Remove B (Swap with last)
                drops[j] = drops[drops.length - 1];
                drops.pop();

                return true; // Rebuild grid
              }
            }
          }
        }
        return false;
      };

      for (let k = 0; k < 4; k++) {
        if (mergePass()) grid = buildGrid(drops);
        else break;
      }

      // 5. Render
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      drawTrails(ctx, trails);

      const timeSec = now / 1000;
      for (let i = 0; i < drops.length; i++) {
        drawDrop(ctx, drops[i], timeSec, ramp, CONFIG);
      }

      raf = requestAnimationFrame(loop);
    };

    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [CONFIG]);

  return (
    <canvas
      ref={canvasRef}
      className={`${CSS_PREFIX}-glass`}
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
        zIndex: 2,
      }}
    />
  );
});
GlassLayer.displayName = 'GlassLayer';

// -- Rain Layer (Summer Only - Canvas) --
const RainLayer = memo(
  ({ isCoarse, intensity }: { isCoarse: boolean; intensity: Intensity }) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const stateRef = useRef({
      drops: [] as { x: number; y: number; l: number; v: number }[],
      width: 0,
      height: 0,
    });

    useSafeResizeObserver(canvasRef, (rect) => {
      const c = canvasRef.current;
      if (!c) return;
      const dpr = Math.min(
        2,
        typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1,
      );
      c.width = rect.width * dpr;
      c.height = rect.height * dpr;
      stateRef.current.width = rect.width;
      stateRef.current.height = rect.height;

      // Init drops
      const count =
        intensity === 'dense' ? 400 : intensity === 'normal' ? 200 : 80;
      stateRef.current.drops = Array.from({ length: count }, () => ({
        x: Math.random() * rect.width,
        y: Math.random() * rect.height,
        l: Math.random() * 20 + 20,
        v: Math.random() * 20 + 40,
      }));
    });

    useEffect(() => {
      const c = canvasRef.current;
      if (!c) return;
      const ctx = c.getContext('2d');
      if (!ctx) return;

      let raf = 0;
      const loop = () => {
        const { width: w, height: h, drops } = stateRef.current;
        if (w === 0) {
          raf = requestAnimationFrame(loop);
          return;
        }

        const dpr = c.width / w;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, w, h);

        ctx.strokeStyle = 'rgba(255,255,255,0.15)';
        ctx.lineWidth = 1;
        ctx.beginPath();

        for (const d of drops) {
          d.y += d.v * 0.5; // slow down slightly
          if (d.y > h + d.l) {
            d.y = -d.l;
            d.x = Math.random() * w;
          }
          ctx.moveTo(d.x, d.y);
          ctx.lineTo(d.x, d.y + d.l);
        }
        ctx.stroke();
        raf = requestAnimationFrame(loop);
      };
      raf = requestAnimationFrame(loop);
      return () => cancelAnimationFrame(raf);
    }, [intensity]);

    return (
      <canvas
        ref={canvasRef}
        className={`${CSS_PREFIX}-rain`}
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          pointerEvents: 'none',
          zIndex: 1,
        }}
      />
    );
  },
);
RainLayer.displayName = 'RainLayer';

// -- Main Component --
export const SeasonalEffects: React.FC<SeasonalEffectsProps> = ({
  season = 'auto',
  intensity = 'normal',
  disableMobile = false,
  enabled,
}) => {
  const [mounted, setMounted] = useState(false);
  const [textures, setTextures] = useState<{
    leaves: string[];
    petals: string[];
    snow: string[];
  }>({
    leaves: [],
    petals: [],
    snow: [],
  });
  const pathname = usePathname();

  // Disable on Player page to save perf
  const isPlayerPage = pathname?.startsWith('/play');

  useEffect(() => {
    setMounted(true);
    // Generate textures on mount
    setTextures(generateTextures());
  }, []);

  const resolvedSeason: ActiveSeason | 'off' = useMemo(() => {
    if (!mounted) return 'off';
    if (season === 'auto') return getCurrentSeason();
    if (season === 'off') return 'off';
    if (isActiveSeason(season)) return season;
    return 'off';
  }, [season, mounted]);

  if (!mounted || resolvedSeason === 'off' || isPlayerPage) return null;

  return (
    <div
      className={`${CSS_PREFIX}-container`}
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
        zIndex: 0,
        overflow: 'hidden',
      }}
    >
      {/* Background Gradients */}
      {resolvedSeason === 'autumn' && (
        <div
          className={`${CSS_PREFIX}-bg`}
          style={{
            position: 'absolute',
            inset: 0,
            background:
              'linear-gradient(180deg, rgba(60,30,0,0.1) 0%, transparent 100%)',
            zIndex: 1,
            pointerEvents: 'none',
          }}
        />
      )}
      {resolvedSeason === 'winter' && (
        <div
          className={`${CSS_PREFIX}-bg`}
          style={{
            position: 'absolute',
            inset: 0,
            background:
              'linear-gradient(180deg, rgba(224,255,255,0.1) 0%, transparent 100%)',
            zIndex: 1,
            pointerEvents: 'none',
          }}
        />
      )}

      {/* Summer = Canvas Rain + Glass Layer */}
      {resolvedSeason === 'summer' && (
        <>
          <RainLayer isCoarse={false} intensity={intensity} />
          <GlassLayer intensity={intensity} />
        </>
      )}

      {/* Winter/Spring/Autumn = PureSnow (DOM) with Textures */}
      {resolvedSeason !== 'summer' && (
        <PureSnow
          mode={resolvedSeason}
          count={intensity === 'dense' ? 150 : intensity === 'normal' ? 80 : 40}
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
