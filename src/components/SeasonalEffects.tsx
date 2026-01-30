'use client';

import { usePathname } from 'next/navigation';
import {
  type CSSProperties,
  memo,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

// -- Types --
export type Season = 'spring' | 'summer' | 'autumn' | 'winter' | 'auto' | 'off';
export type Intensity = 'light' | 'normal' | 'heavy';
type ActiveSeason = 'spring' | 'summer' | 'autumn' | 'winter';

export interface SeasonalEffectsProps {
  season?: Season;
  intensity?: Intensity;
  enabled?: boolean;
}

// -- Constants & Helpers --
const MAX_DELTA = 3.0;

const isModernMediaQuery = (mq: MediaQueryList): boolean => {
  return typeof mq.addEventListener === 'function';
};

function usePrefersReducedMotion() {
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setPrefersReducedMotion(mediaQuery.matches);
    update();
    if (isModernMediaQuery(mediaQuery)) {
      mediaQuery.addEventListener('change', update);
      return () => mediaQuery.removeEventListener('change', update);
    } else {
      mediaQuery.addListener(update);
      return () => mediaQuery.removeListener(update);
    }
  }, []);
  return prefersReducedMotion;
}

const getCurrentSeason = (): ActiveSeason => {
  const month = new Date().getMonth() + 1;
  if (month >= 3 && month <= 5) return 'spring';
  if (month >= 6 && month <= 8) return 'summer';
  if (month >= 9 && month <= 11) return 'autumn';
  return 'winter';
};

const isActiveSeason = (s: Season): s is ActiveSeason => {
  return ['spring', 'summer', 'autumn', 'winter'].includes(s);
};

// -- Texture Caching System --
const createCachedCanvas = (
  width: number,
  height: number,
  drawFn: (ctx: CanvasRenderingContext2D) => void,
) => {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  drawFn(ctx);
  return canvas;
};

const shapes: {
  leaf: HTMLCanvasElement[];
  petal: HTMLCanvasElement[];
  snow: HTMLCanvasElement | null;
} = {
  leaf: [],
  petal: [],
  snow: null,
};

let shapesInitialized = false;

const initShapes = () => {
  if (shapesInitialized) return;
  shapesInitialized = true;

  // 1. Snow
  const snowCanvas = createCachedCanvas(15, 15, (ctx) => {
    const grad = ctx.createRadialGradient(7.5, 7.5, 0, 7.5, 7.5, 7.5);
    grad.addColorStop(0, 'rgba(255, 255, 255, 0.9)');
    grad.addColorStop(0.5, 'rgba(255, 255, 255, 0.4)');
    grad.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 15, 15);
  });
  if (snowCanvas) shapes.snow = snowCanvas;

  // 2. Leaves (Maple & Oak)
  shapes.leaf = [];
  const leafPalettes = [
    { base: '#D2691E', highlight: '#FF8C00' }, // Chocolate
    { base: '#8B0000', highlight: '#CD5C5C' }, // Red
    { base: '#DAA520', highlight: '#FFD700' }, // Gold
  ];

  leafPalettes.forEach(({ base, highlight }) => {
    // Maple
    const maple = createCachedCanvas(40, 40, (ctx) => {
      const grad = ctx.createLinearGradient(10, 0, 30, 40);
      grad.addColorStop(0, highlight);
      grad.addColorStop(1, base);
      ctx.fillStyle = grad;
      ctx.strokeStyle = 'rgba(0,0,0,0.2)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(20, 40);
      ctx.lineTo(20, 35);
      ctx.bezierCurveTo(10, 35, 0, 25, 0, 15);
      ctx.lineTo(5, 15);
      ctx.lineTo(2, 5);
      ctx.lineTo(10, 10);
      ctx.lineTo(15, 0);
      ctx.lineTo(20, 5);
      ctx.lineTo(25, 0);
      ctx.lineTo(30, 10);
      ctx.lineTo(38, 5);
      ctx.lineTo(35, 15);
      ctx.lineTo(40, 15);
      ctx.bezierCurveTo(40, 25, 30, 35, 20, 35);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(20, 35);
      ctx.lineTo(20, 5);
      ctx.moveTo(20, 25);
      ctx.lineTo(5, 15);
      ctx.moveTo(20, 25);
      ctx.lineTo(35, 15);
      ctx.stroke();
    });
    if (maple) shapes.leaf.push(maple);

    // Oak
    const oak = createCachedCanvas(30, 45, (ctx) => {
      const grad = ctx.createLinearGradient(15, 0, 15, 45);
      grad.addColorStop(0, highlight);
      grad.addColorStop(1, base);
      ctx.fillStyle = grad;
      ctx.strokeStyle = 'rgba(0,0,0,0.15)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(15, 45);
      ctx.quadraticCurveTo(5, 40, 5, 30);
      ctx.bezierCurveTo(0, 25, 0, 15, 5, 10);
      ctx.bezierCurveTo(5, 5, 10, 0, 15, 0);
      ctx.bezierCurveTo(20, 0, 25, 5, 25, 10);
      ctx.bezierCurveTo(30, 15, 30, 25, 25, 30);
      ctx.quadraticCurveTo(25, 40, 15, 45);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(15, 45);
      ctx.lineTo(15, 5);
      ctx.moveTo(15, 35);
      ctx.lineTo(5, 25);
      ctx.moveTo(15, 35);
      ctx.lineTo(25, 25);
      ctx.stroke();
    });
    if (oak) shapes.leaf.push(oak);
  });

  // 3. Petals (Sakura)
  shapes.petal = [];
  const petalColors = ['#FFC0CB', '#FFB7C5', '#FFF0F5'];
  petalColors.forEach((color) => {
    // Single
    const petal = createCachedCanvas(20, 20, (ctx) => {
      const grad = ctx.createRadialGradient(10, 20, 0, 10, 10, 20);
      grad.addColorStop(0, '#FFFFFF');
      grad.addColorStop(0.6, color);
      grad.addColorStop(1, color);
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.moveTo(10, 20);
      ctx.quadraticCurveTo(20, 10, 20, 5);
      ctx.quadraticCurveTo(20, 0, 15, 0);
      ctx.lineTo(10, 4);
      ctx.lineTo(5, 0);
      ctx.quadraticCurveTo(0, 0, 0, 5);
      ctx.quadraticCurveTo(0, 10, 10, 20);
      ctx.closePath();
      ctx.fill();
    });
    if (petal) shapes.petal.push(petal);

    // Whole Flower
    const flower = createCachedCanvas(30, 30, (ctx) => {
      ctx.translate(15, 15);
      const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, 14);
      grad.addColorStop(0, 'rgba(255,255,255,0.9)');
      grad.addColorStop(0.5, color);
      grad.addColorStop(1, color);
      ctx.fillStyle = grad;
      ctx.save();
      for (let i = 0; i < 5; i++) {
        ctx.beginPath();
        ctx.ellipse(0, -8, 4, 8, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.rotate((Math.PI * 2) / 5);
      }
      ctx.restore();
      ctx.fillStyle = '#FFD700';
      ctx.beginPath();
      ctx.arc(0, 0, 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#A0522D';
      ctx.save();
      for (let j = 0; j < 5; j++) {
        ctx.beginPath();
        ctx.arc(0, -3, 0.8, 0, Math.PI * 2);
        ctx.fill();
        ctx.rotate((Math.PI * 2) / 5);
      }
      ctx.restore();
    });
    if (flower) shapes.petal.push(flower);
  });
};

const intensityConfig = {
  light: 50,
  normal: 100,
  heavy: 200,
};

// -- Glass Layer (Atmosphere & Condensation) --
const GlassLayer = memo(({ season }: { season: ActiveSeason }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  type Droplet = {
    x: number;
    y: number;
    px: number;
    py: number;
    r: number;
    vy: number;
    isFalling: boolean;
    phase: number;
    dead?: boolean; // Mark for removal
  };

  type TrailSeg = {
    x1: number;
    y1: number;
    x2: number;
    y2: number;
    w: number;
    life: number;
  };

  const dropsRef = useRef<Droplet[]>([]);
  const trailsRef = useRef<TrailSeg[]>([]);
  const rafRef = useRef<number>(0);

  const [isCoarse, setIsCoarse] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mq = window.matchMedia('(pointer: coarse)');
    const update = () => setIsCoarse(mq.matches);
    update();
    if (isModernMediaQuery(mq)) {
      mq.addEventListener('change', update);
      return () => mq.removeEventListener('change', update);
    } else {
      mq.addListener(update);
      return () => mq.removeListener(update);
    }
  }, []);

  const isWinter = season === 'winter';
  const isSummer = season === 'summer';

  const supportsBackdrop =
    typeof CSS !== 'undefined' &&
    (CSS.supports('backdrop-filter: blur(1px)') ||
      CSS.supports('-webkit-backdrop-filter: blur(1px)'));

  const supportsMask =
    typeof CSS !== 'undefined' &&
    (CSS.supports(
      'mask-image: radial-gradient(circle at center, transparent 40%, black 100%)',
    ) ||
      CSS.supports(
        '-webkit-mask-image: radial-gradient(circle at center, transparent 40%, black 100%)',
      ));

  const baseStyle: CSSProperties = {
    position: 'fixed',
    inset: 0,
    pointerEvents: 'none',
    zIndex: 10,
    willChange: 'transform',
  };

  // ---- SUMMER SIMULATION ----
  useEffect(() => {
    if (!isSummer) return;

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) return;

    // Config
    const DROP_LIMIT = isCoarse ? 220 : 520;
    const TRAIL_LIMIT = isCoarse ? 260 : 650;
    const SPAWN_PER_SEC = isCoarse ? 18 : 32;
    const GROW_PER_SEC = 0.1;
    const GRAVITY_R_THRESHOLD = 3.6;
    const GRAVITY = 700;
    const WAVY_AMP = 10;
    const WAVY_FREQ = 0.02;

    const CELL = 24;
    const cellKey = (cx: number, cy: number) => `${cx},${cy}`;
    const grid = new Map<string, number[]>();

    let lastT = 0;
    let spawnAcc = 0;
    let running = true;
    let resizeRaf = 0;

    const getViewport = () => {
      const vv = window.visualViewport;
      return {
        width: vv ? vv.width : window.innerWidth,
        height: vv ? vv.height : window.innerHeight,
      };
    };

    const resizeCanvas = () => {
      const dpr = window.devicePixelRatio || 1;
      const { width, height } = getViewport();
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const requestResize = () => {
      if (resizeRaf) cancelAnimationFrame(resizeRaf);
      resizeRaf = requestAnimationFrame(() => {
        resizeRaf = 0;
        resizeCanvas();
      });
    };

    const drawDroplet = (d: Droplet) => {
      const g = ctx.createRadialGradient(d.x, d.y, d.r * 0.15, d.x, d.y, d.r);
      g.addColorStop(0, 'rgba(255,255,255,0.06)');
      g.addColorStop(0.75, 'rgba(0,0,0,0.08)');
      g.addColorStop(1, 'rgba(0,0,0,0.16)');
      ctx.beginPath();
      ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2);
      ctx.fillStyle = g;
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(
        d.x - d.r * 0.32,
        d.y - d.r * 0.32,
        d.r * 0.34,
        d.r * 0.18,
        Math.PI / 4,
        0,
        Math.PI * 2,
      );
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      ctx.fill();
    };

    const drawTrail = (t: TrailSeg) => {
      ctx.save();
      ctx.globalAlpha = 0.22 * t.life;
      ctx.lineCap = 'round';
      ctx.lineWidth = t.w;
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.beginPath();
      ctx.moveTo(t.x1, t.y1);
      ctx.lineTo(t.x2, t.y2);
      ctx.stroke();
      ctx.restore();
    };

    const addTrail = (d: Droplet) => {
      const dx = d.x - d.px;
      const dy = d.y - d.py;
      if (dx * dx + dy * dy < 2) return;
      trailsRef.current.push({
        x1: d.px,
        y1: d.py,
        x2: d.x,
        y2: d.y,
        w: Math.max(1, d.r * 0.55),
        life: 1,
      });
      if (trailsRef.current.length > TRAIL_LIMIT) {
        trailsRef.current.splice(0, trailsRef.current.length - TRAIL_LIMIT);
      }
    };

    const spawnDrop = (w: number, h: number) => {
      const d: Droplet = {
        x: Math.random() * w,
        y: Math.random() * h,
        px: 0,
        py: 0,
        r: 0.6 + Math.random() * 1.3,
        vy: 0,
        isFalling: false,
        phase: Math.random() * Math.PI * 2,
      };
      d.px = d.x;
      d.py = d.y;
      dropsRef.current.push(d);
    };

    // Correct Grid Building (Ignore dead/falling)
    const rebuildGrid = () => {
      grid.clear();
      const drops = dropsRef.current;
      for (let i = 0; i < drops.length; i++) {
        const d = drops[i];
        if (d.dead || d.isFalling) continue;
        const cx = Math.floor(d.x / CELL);
        const cy = Math.floor(d.y / CELL);
        const k = cellKey(cx, cy);
        const bucket = grid.get(k);
        if (bucket) bucket.push(i);
        else grid.set(k, [i]);
      }
    };

    // Correct Coalescence Logic: Mark Dead
    const tryCoalesce = (fallIdx: number) => {
      const drops = dropsRef.current;
      const d = drops[fallIdx];
      if (!d || d.dead) return;

      const cx = Math.floor(d.x / CELL);
      const cy = Math.floor(d.y / CELL);

      for (let oy = -1; oy <= 1; oy++) {
        for (let ox = -1; ox <= 1; ox++) {
          const k = cellKey(cx + ox, cy + oy);
          const bucket = grid.get(k);
          if (!bucket) continue;

          for (let bi = bucket.length - 1; bi >= 0; bi--) {
            const j = bucket[bi];
            if (j === fallIdx) continue;

            const t = drops[j];
            if (!t || t.dead || t.isFalling) continue;

            const dx = d.x - t.x;
            const dy = d.y - t.y;
            const rr = d.r + t.r;

            if (dx * dx + dy * dy <= rr * rr) {
              d.r = Math.sqrt(d.r * d.r + t.r * t.r);
              t.dead = true; // Safe: mark for removal
              return; // Stop processing this droplet
            }
          }
        }
      }
    };

    const tick = (t: number) => {
      if (!running) return;
      if (!lastT) lastT = t;
      const dt = Math.min(0.05, (t - lastT) / 1000);
      lastT = t;

      const { width, height } = getViewport();

      // Spawn
      spawnAcc += SPAWN_PER_SEC * dt;
      while (spawnAcc >= 1 && dropsRef.current.length < DROP_LIMIT) {
        spawnAcc -= 1;
        spawnDrop(width, height);
      }

      // Trail Update
      const trails = trailsRef.current;
      for (let i = trails.length - 1; i >= 0; i--) {
        trails[i].life -= dt * 0.3;
        if (trails[i].life <= 0) {
          // Swap-remove for trails is safe as order doesn't matter
          const last = trails.length - 1;
          if (i !== last) trails[i] = trails[last];
          trails.pop();
        }
      }

      rebuildGrid();
      ctx.clearRect(0, 0, width, height);

      // Draw Trails
      for (let i = 0; i < trails.length; i++) drawTrail(trails[i]);

      const drops = dropsRef.current;

      // Update Loop
      for (let i = drops.length - 1; i >= 0; i--) {
        const d = drops[i];
        if (d.dead) continue; // Skip dead

        d.px = d.x;
        d.py = d.y;

        if (!d.isFalling) {
          d.r += GROW_PER_SEC * dt;
          if (d.r > GRAVITY_R_THRESHOLD) {
            d.isFalling = true;
            d.vy = 60;
          }
        } else {
          d.vy += GRAVITY * dt;
          d.y += d.vy * dt;
          d.x += Math.sin(d.y * WAVY_FREQ + d.phase) * (WAVY_AMP * dt);

          addTrail(d);
          tryCoalesce(i);
        }

        if (d.y > height + 30) {
          d.dead = true;
          continue;
        }

        drawDroplet(d);
      }

      // Compact: Remove dead droplets once per frame
      if (drops.some((d) => d.dead)) {
        dropsRef.current = drops.filter((d) => !d.dead);
      }

      rafRef.current = requestAnimationFrame(tick);
    };

    const vv = window.visualViewport;
    window.addEventListener('resize', requestResize, { passive: true });
    if (vv) {
      vv.addEventListener('resize', requestResize, { passive: true });
      vv.addEventListener('scroll', requestResize, { passive: true });
    }

    requestResize();
    rafRef.current = requestAnimationFrame(tick);

    return () => {
      running = false;
      window.removeEventListener('resize', requestResize);
      if (vv) {
        vv.removeEventListener('resize', requestResize);
        vv.removeEventListener('scroll', requestResize);
      }
      if (resizeRaf) cancelAnimationFrame(resizeRaf);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      dropsRef.current = [];
      trailsRef.current = [];
    };
  }, [isSummer, isCoarse]);

  if (isWinter) {
    const blurPx = isCoarse ? 2 : 4;
    const maskImage =
      'radial-gradient(circle at center, transparent 40%, black 100%)';
    const canBlur = supportsBackdrop && supportsMask;
    const backdrop = canBlur ? `blur(${blurPx}px)` : undefined;

    return (
      <div
        style={{
          ...baseStyle,
          backdropFilter: backdrop,
          WebkitBackdropFilter: backdrop,
          ...(supportsMask ? { maskImage, WebkitMaskImage: maskImage } : {}),
          background:
            'radial-gradient(circle at center, transparent 40%, rgba(255, 255, 255, 0.2) 100%)',
        }}
        aria-hidden='true'
      />
    );
  }

  if (isSummer) {
    return <canvas ref={canvasRef} style={baseStyle} aria-hidden='true' />;
  }

  return null;
});
GlassLayer.displayName = 'GlassLayer';

// -- Main Physics Particle --
class Particle {
  x = 0;
  y = 0;
  z = 0;
  size = 0;
  vx = 0;
  vy = 0;
  rotation = 0;
  vRotation = 0;
  type: ActiveSeason = 'winter';
  swing = 0;
  swingSpeed = 0;
  flip = 0;
  flipSpeed = 0;
  color = '';
  texture: HTMLCanvasElement | null = null;
  w = 0;
  h = 0;

  constructor(width: number, height: number, type: ActiveSeason) {
    this.type = type;
    this.reset(width, height, true);
  }

  reset(width: number, height: number, initial = false) {
    this.z = 0.2 + Math.random() * 0.8;
    this.x = Math.random() * width;
    this.y = initial ? Math.random() * height : -50;
    this.rotation = Math.random() * Math.PI * 2;
    this.vRotation = (Math.random() - 0.5) * 0.05;
    this.flip = Math.random() * Math.PI * 2;
    this.flipSpeed = (0.02 + Math.random() * 0.05) * this.z;

    switch (this.type) {
      case 'winter':
        this.size = (2 + Math.random() * 4) * this.z;
        this.vy = (0.5 + Math.random() * 1.5) * this.z;
        this.vx = (Math.random() - 0.5) * 0.5;
        this.swingSpeed = 0.02 * this.z;
        this.texture = shapes.snow;
        break;
      case 'summer': // Rain
        this.size = (15 + Math.random() * 15) * this.z;
        this.vy = (25 + Math.random() * 10) * this.z;
        this.vx = -1 * this.z;
        this.color = `rgba(200, 220, 255, ${0.1 + 0.2 * this.z})`;
        break;
      case 'autumn':
        this.size = (12 + Math.random() * 8) * this.z;
        this.vy = (1 + Math.random() * 1.5) * this.z;
        this.vx = (Math.random() - 0.5) * 2;
        this.swingSpeed = 0.05 * this.z;
        if (shapes.leaf.length > 0)
          this.texture =
            shapes.leaf[Math.floor(Math.random() * shapes.leaf.length)];
        break;
      case 'spring':
        this.size = (8 + Math.random() * 6) * this.z;
        this.vy = (0.8 + Math.random() * 1.0) * this.z;
        this.vx = (Math.random() - 0.2) * 1.5;
        this.swingSpeed = 0.03 * this.z;
        if (shapes.petal.length > 0)
          this.texture =
            shapes.petal[Math.floor(Math.random() * shapes.petal.length)];
        break;
    }

    if (this.texture && this.texture.width > 0 && this.texture.height > 0) {
      this.w = this.size;
      this.h = this.size * (this.texture.height / this.texture.width);
    } else {
      this.w = this.size;
      this.h = this.size;
    }
  }

  update(width: number, height: number, delta: number, wind: number) {
    this.y += this.vy * delta;
    this.rotation += this.vRotation * delta;
    this.flip += this.flipSpeed * delta;

    if (this.type === 'summer') {
      this.x += (this.vx + wind * 0.5) * delta;
    } else {
      this.swing += this.swingSpeed * delta;
      const swingMotion =
        Math.sin(this.swing) * (this.type === 'winter' ? 0.5 : 2) * this.z;
      this.x += (this.vx + swingMotion + wind * this.z) * delta;
    }

    if (this.y > height + 50 || this.x < -100 || this.x > width + 100) {
      this.reset(width, height);
    }
  }

  draw(ctx: CanvasRenderingContext2D) {
    if (this.type === 'summer') {
      ctx.strokeStyle = this.color;
      ctx.lineWidth = 1.5 * this.z;
      ctx.beginPath();
      ctx.moveTo(this.x, this.y);
      ctx.lineTo(this.x + this.vx, this.y + this.size);
      ctx.stroke();
      return;
    }
    if (!this.texture) return;

    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.globalAlpha = 0.4 + 0.6 * this.z;

    if (this.type === 'winter') {
      ctx.drawImage(this.texture, -this.w / 2, -this.h / 2, this.w, this.h);
    } else {
      ctx.rotate(this.rotation);
      const flipY = Math.cos(this.flip);
      const safeFlipY =
        (Math.sign(flipY) || 1) * Math.max(0.15, Math.abs(flipY));
      ctx.scale(1, safeFlipY);
      ctx.drawImage(this.texture, -this.w / 2, -this.h / 2, this.w, this.h);
    }
    ctx.restore();
  }
}

// -- Main Component --
const SeasonalEffects: React.FC<SeasonalEffectsProps> = memo(
  ({ season = 'auto', intensity = 'normal', enabled = true }) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const particles = useRef<Particle[]>([]);
    const requestRef = useRef<number>(0);
    const lastTimeRef = useRef<number>(0);
    const windRef = useRef<number>(0);
    const windTargetRef = useRef<number>(0);

    const [mounted, setMounted] = useState(false);
    const prefersReducedMotion = usePrefersReducedMotion();
    const pathname = usePathname();
    const isPlayPage = pathname?.startsWith('/play');

    useEffect(() => {
      initShapes();
      setMounted(true);
    }, []);

    const resolvedSeason: ActiveSeason | 'off' = useMemo(() => {
      if (!mounted) return 'off';
      if (season === 'auto') return getCurrentSeason();
      return isActiveSeason(season) ? season : 'off';
    }, [season, mounted]);

    const shouldDisable =
      !enabled ||
      resolvedSeason === 'off' ||
      isPlayPage ||
      prefersReducedMotion;

    useEffect(() => {
      if (shouldDisable || !mounted) {
        if (requestRef.current) cancelAnimationFrame(requestRef.current);
        particles.current = [];
        const canvas = canvasRef.current;
        if (canvas) {
          const ctx = canvas.getContext('2d');
          ctx?.clearRect(0, 0, canvas.width, canvas.height);
        }
        return;
      }

      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d', { alpha: true });
      if (!ctx) return;

      ctx.lineCap = 'round';
      let running = true;
      let resizeRaf = 0;

      const getViewport = () => {
        const vv = window.visualViewport;
        return {
          width: vv ? vv.width : window.innerWidth,
          height: vv ? vv.height : window.innerHeight,
        };
      };

      const resizeCanvas = () => {
        const dpr = window.devicePixelRatio || 1;
        const { width, height } = getViewport();
        canvas.style.width = `${width}px`;
        canvas.style.height = `${height}px`;
        canvas.width = Math.floor(width * dpr);
        canvas.height = Math.floor(height * dpr);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        // initParticles(); // Removed redundant call on resize to prevent flicker, let raf handle updates
      };

      const requestResize = () => {
        if (resizeRaf) cancelAnimationFrame(resizeRaf);
        resizeRaf = requestAnimationFrame(() => {
          resizeRaf = 0;
          resizeCanvas();
        });
      };

      const initParticles = () => {
        const { width, height } = getViewport();
        const isMobile = width < 768;
        const baseCount = intensityConfig[intensity || 'normal'];
        const count = Math.round(isMobile ? baseCount * 0.6 : baseCount);
        const newParticles: Particle[] = [];
        for (let i = 0; i < count; i++) {
          newParticles.push(
            new Particle(width, height, resolvedSeason as ActiveSeason),
          );
        }
        particles.current = newParticles;
      };

      const animate = (time: number) => {
        if (!running) return;
        if (lastTimeRef.current === 0) lastTimeRef.current = time;
        let delta = (time - lastTimeRef.current) / 16.67;
        lastTimeRef.current = time;
        if (delta > MAX_DELTA) delta = MAX_DELTA;

        const { width, height } = getViewport();
        if (Math.random() < 0.005)
          windTargetRef.current = (Math.random() - 0.5) * 3;
        windRef.current +=
          (windTargetRef.current - windRef.current) * 0.02 * delta;

        ctx.clearRect(0, 0, width, height);
        particles.current.forEach((p) => {
          p.update(width, height, delta, windRef.current);
          p.draw(ctx);
        });
        requestRef.current = requestAnimationFrame(animate);
      };

      const vv = window.visualViewport;
      window.addEventListener('resize', requestResize, { passive: true });
      if (vv) {
        vv.addEventListener('resize', requestResize, { passive: true });
        vv.addEventListener('scroll', requestResize, { passive: true });
      }

      resizeCanvas();
      initParticles(); // Initialize once
      lastTimeRef.current = 0;
      requestRef.current = requestAnimationFrame(animate);

      return () => {
        running = false;
        window.removeEventListener('resize', requestResize);
        if (vv) {
          vv.removeEventListener('resize', requestResize);
          vv.removeEventListener('scroll', requestResize);
        }
        if (resizeRaf) cancelAnimationFrame(resizeRaf);
        if (requestRef.current) cancelAnimationFrame(requestRef.current);
        lastTimeRef.current = 0;
      };
    }, [shouldDisable, resolvedSeason, intensity, mounted]);

    if (!mounted) return null;

    const backgroundGradients: Record<ActiveSeason, string> = {
      spring:
        'linear-gradient(180deg, rgba(255,182,193,0.08) 0%, transparent 100%)',
      summer:
        'linear-gradient(180deg, rgba(144,238,144,0.06) 0%, transparent 100%)',
      autumn:
        'linear-gradient(180deg, rgba(255,99,71,0.08) 0%, transparent 100%)',
      winter:
        'linear-gradient(180deg, rgba(224,255,255,0.1) 0%, transparent 100%)',
    };

    const showEffect = !shouldDisable;

    return (
      <>
        {/* 1. Background Gradient (Bottom) */}
        {showEffect && (
          <div
            style={{
              position: 'fixed',
              inset: 0,
              pointerEvents: 'none',
              zIndex: 0,
              background: backgroundGradients[resolvedSeason as ActiveSeason],
              opacity: 0.5,
              willChange: 'transform',
            }}
            aria-hidden='true'
          />
        )}

        {/* 2. Particle Canvas (Middle) */}
        {showEffect && (
          <canvas
            ref={canvasRef}
            style={{
              position: 'fixed',
              top: 0,
              left: 0,
              width: '100%',
              height: '100%',
              pointerEvents: 'none',
              zIndex: 5,
              willChange: 'transform',
            }}
            aria-hidden='true'
          />
        )}

        {/* 3. Atmosphere/Glass Layer (Top) */}
        {showEffect && <GlassLayer season={resolvedSeason as ActiveSeason} />}
      </>
    );
  },
);

SeasonalEffects.displayName = 'SeasonalEffects';

export default SeasonalEffects;
