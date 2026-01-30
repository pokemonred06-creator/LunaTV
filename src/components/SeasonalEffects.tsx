'use client';

import { usePathname } from 'next/navigation';
import { memo, useEffect, useMemo, useRef, useState } from 'react';

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

// Texture Storage
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
  // Fix 1: Idempotent initialization guard
  if (shapesInitialized) return;
  shapesInitialized = true;

  // 1. Realistic Snow
  const snowCanvas = createCachedCanvas(15, 15, (ctx) => {
    const grad = ctx.createRadialGradient(7.5, 7.5, 0, 7.5, 7.5, 7.5);
    grad.addColorStop(0, 'rgba(255, 255, 255, 0.9)');
    grad.addColorStop(0.5, 'rgba(255, 255, 255, 0.4)');
    grad.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 15, 15);
  });
  if (snowCanvas) shapes.snow = snowCanvas;

  // 2. High-Fidelity Autumn Leaves
  shapes.leaf = [];
  const leafPalettes = [
    { base: '#D2691E', highlight: '#FF8C00' }, // Chocolate
    { base: '#8B0000', highlight: '#CD5C5C' }, // Deep Red
    { base: '#DAA520', highlight: '#FFD700' }, // Gold
  ];

  leafPalettes.forEach(({ base, highlight }) => {
    // Maple Leaf
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

    // Oak Leaf
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

  // 3. High-Fidelity Spring (Sakura)
  shapes.petal = [];
  const petalColors = ['#FFC0CB', '#FFB7C5', '#FFF0F5'];

  petalColors.forEach((color) => {
    // Single Petal
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

const getCurrentSeason = (): ActiveSeason => {
  const month = new Date().getMonth() + 1;
  if (month >= 3 && month <= 5) return 'spring';
  if (month >= 6 && month <= 8) return 'summer';
  if (month >= 9 && month <= 11) return 'autumn';
  return 'winter';
};

const intensityConfig = {
  light: 50,
  normal: 100,
  heavy: 200,
};

const isActiveSeason = (s: Season): s is ActiveSeason => {
  return ['spring', 'summer', 'autumn', 'winter'].includes(s);
};

// -- Particle Class --
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
        if (shapes.leaf.length > 0) {
          this.texture =
            shapes.leaf[Math.floor(Math.random() * shapes.leaf.length)];
        }
        break;

      case 'spring':
        this.size = (8 + Math.random() * 6) * this.z;
        this.vy = (0.8 + Math.random() * 1.0) * this.z;
        this.vx = (Math.random() - 0.2) * 1.5;
        this.swingSpeed = 0.03 * this.z;
        if (shapes.petal.length > 0) {
          this.texture =
            shapes.petal[Math.floor(Math.random() * shapes.petal.length)];
        }
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

        initParticles();
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
        const baseCount = intensityConfig[intensity];
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

        if (Math.random() < 0.005) {
          windTargetRef.current = (Math.random() - 0.5) * 3;
        }
        windRef.current +=
          (windTargetRef.current - windRef.current) * 0.02 * delta;

        ctx.clearRect(0, 0, width, height);

        particles.current.forEach((p) => {
          p.update(width, height, delta, windRef.current);
          p.draw(ctx);
        });

        requestRef.current = requestAnimationFrame(animate);
      };

      // Fix 2: Listen to VisualViewport events for iOS address bar safety
      const vv = window.visualViewport;
      window.addEventListener('resize', requestResize, { passive: true });
      if (vv) {
        vv.addEventListener('resize', requestResize, { passive: true });
        vv.addEventListener('scroll', requestResize, { passive: true });
      }

      resizeCanvas();
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

    if (!mounted || (resolvedSeason === 'off' && !enabled)) return null;

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

    return (
      <>
        {resolvedSeason !== 'off' && !isPlayPage && (
          <div
            style={{
              position: 'fixed',
              top: 0,
              left: 0,
              width: '100%',
              height: '100%',
              pointerEvents: 'none',
              zIndex: 0,
              background: backgroundGradients[resolvedSeason as ActiveSeason],
              opacity: 0.5,
            }}
            aria-hidden='true'
          />
        )}

        {!shouldDisable && (
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
            }}
            aria-hidden='true'
          />
        )}
      </>
    );
  },
);

SeasonalEffects.displayName = 'SeasonalEffects';

export default SeasonalEffects;
