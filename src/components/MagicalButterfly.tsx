'use client';

import React, { useEffect, useRef, useState } from 'react';

// ========================================
// Math & Noise Helpers
// ========================================

class SimplexNoise {
  private p: number[] = [];
  constructor(seed = (Math.random() * 1e9) | 0) {
    let t = seed >>> 0;
    const rand = () => {
      t += 0x6d2b79f5;
      let x = t;
      x = Math.imul(x ^ (x >>> 15), x | 1);
      x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
      return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
    };
    const perm: number[] = [];
    for (let i = 0; i < 256; i++) perm[i] = i;
    for (let i = 255; i > 0; i--) {
      const j = (rand() * (i + 1)) | 0;
      [perm[i], perm[j]] = [perm[j], perm[i]];
    }
    this.p = perm.concat(perm);
  }
  private fade(t: number) {
    return t * t * t * (t * (t * 6 - 15) + 10);
  }
  private lerp(a: number, b: number, t: number) {
    return a + t * (b - a);
  }
  private grad(hash: number, x: number, y: number) {
    const h = hash & 3;
    const u = h < 2 ? x : y;
    const v = h < 2 ? y : x;
    return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v);
  }
  noise2D(x: number, y: number): number {
    const X = Math.floor(x) & 255;
    const Y = Math.floor(y) & 255;
    const xf = x - Math.floor(x);
    const yf = y - Math.floor(y);
    const u = this.fade(xf);
    const v = this.fade(yf);
    const aa = this.p[this.p[X] + Y];
    const ab = this.p[this.p[X] + Y + 1];
    const ba = this.p[this.p[X + 1] + Y];
    const bb = this.p[this.p[X + 1] + Y + 1];
    return this.lerp(
      this.lerp(this.grad(aa, xf, yf), this.grad(ba, xf - 1, yf), u),
      this.lerp(this.grad(ab, xf, yf - 1), this.grad(bb, xf - 1, yf - 1), u),
      v,
    );
  }
}

interface Point3D {
  x: number;
  y: number;
  z: number;
}
interface Point2D {
  x: number;
  y: number;
}

// ========================================
// Configuration & Magic Palette
// ========================================

const MAGIC = {
  // Diverse Magical Butterfly Palettes - randomly assigned
  palettes: [
    // Blues (Ocean/Sky)
    ['#0A1628', '#1E90FF', '#00FFFF'], // Deep Navy -> Electric Blue -> Cyan
    ['#0D1B2A', '#3A86FF', '#7DF9FF'], // Dark Blue -> Bright Blue -> Electric Cyan
    ['#1A1A3E', '#4169E1', '#00BFFF'], // Deep Indigo -> Royal Blue -> Deep Sky Blue
    // Purples (Mystic/Galaxy)
    ['#1A0A2E', '#9B59B6', '#E056FD'], // Deep Purple -> Amethyst -> Magenta
    ['#2D1B4E', '#8E44AD', '#DDA0DD'], // Dark Violet -> Purple -> Plum
    ['#1F0F3D', '#6C3483', '#BB8FCE'], // Midnight Purple -> Grape -> Lavender
    // Pinks (Sakura/Romance)
    ['#2A0A1A', '#E91E63', '#FF69B4'], // Dark Rose -> Pink -> Hot Pink
    ['#3D0F2A', '#FF1493', '#FFB6C1'], // Deep Magenta -> Deep Pink -> Light Pink
    // Greens (Forest/Nature)
    ['#0A2818', '#00C853', '#69F0AE'], // Forest -> Green -> Mint
    ['#0F3D1A', '#2ECC71', '#7DCEA0'], // Dark Green -> Emerald -> Light Green
    // Golds (Royal/Sunset)
    ['#2A1A0A', '#FFA500', '#FFD700'], // Brown -> Orange -> Gold
    ['#3D2A0F', '#F39C12', '#F7DC6F'], // Dark Amber -> Amber -> Light Gold
    // Teals (Ocean Depths)
    ['#0A2828', '#00CED1', '#40E0D0'], // Dark Teal -> Dark Cyan -> Turquoise
    // Reds (Phoenix/Fire)
    ['#2A0A0A', '#E74C3C', '#FF6B6B'], // Dark Red -> Crimson -> Coral
  ],
  glowOuter: 20,
  glowInner: 12,
  trailLen: 16,
  trailAlpha: 0.25,
};

// Physics Constants
const CONFIG = {
  BASE_SPEED: 80,
  MAX_SPEED_MULT: 1.6,
  TURN_SPEED: 5.0,
  APPROACH_SPEED: 140,
  DRAG: 0.985,
  FLAP_MIN: 8,
  FLAP_MAX: 15,
  FLAP_AMP: Math.PI / 2.2,
  LIFT_IMPULSE: 90,
  GRAVITY: 60,
  LAND_RATE: 0.08,
  GLIDE_RATE: 0.4,
  REST_MS: 3000,
  SPARKLE_RATE: 12.0,
  SIZE_MIN: 2,
  SIZE_MAX: 3,
};

const WING_VERTICES: Point3D[] = [
  { x: 0, y: 0, z: 0 }, // 0: Root
  { x: 2, y: -4, z: 0 }, // 1: Top Inner
  { x: 10, y: -8, z: 0 }, // 2: Top Tip
  { x: 8, y: 0, z: 0 }, // 3: Middle Edge
  { x: 5, y: 7, z: 0 }, // 4: Bottom Tip
  { x: 1, y: 4, z: 0 }, // 5: Bottom Inner
];

interface Butterfly {
  id: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  yaw: number;
  pitch: number;
  roll: number;
  wingPhase: number;
  flapSpeed: number;
  size: number;
  state: 'flying' | 'resting' | 'approaching';
  restTimer: number;
  noiseOffsetX: number;
  baseSpeed: number;
  isGliding: boolean;
  glideTimer: number;
  preferredHeading: number;
  targetX: number;
  targetY: number;

  palette: string[];
  trail: Point2D[];
  trailHead: number;

  rWing2D: Point2D[];
  lWing2D: Point2D[];
  head2D: Point2D;
  tail2D: Point2D;
}

export interface PosterBounds {
  top: number;
  left: number;
  right: number;
  bottom?: number;
}

const MagicalButterfly: React.FC<{
  count?: number;
  posterBounds?: PosterBounds[];
}> = ({ count = 5, posterBounds }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const butterfliesRef = useRef<Butterfly[]>([]);
  const noiseRef = useRef<SimplexNoise | null>(null);
  const rafRef = useRef<number>(0);
  const lastTimeRef = useRef<number>(0);
  const posterBoundsRef = useRef(posterBounds);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    posterBoundsRef.current = posterBounds;
  }, [posterBounds]);

  useEffect(() => {
    setMounted(true);
    noiseRef.current = new SimplexNoise();

    butterfliesRef.current = Array.from({ length: count }).map((_, i) => {
      const startX = Math.random() * window.innerWidth;
      const startY = Math.random() * window.innerHeight;

      return {
        id: i,
        x: startX,
        y: startY,
        z: 0.5 + Math.random() * 0.5,
        vx: (Math.random() - 0.5) * CONFIG.BASE_SPEED,
        vy: (Math.random() - 0.5) * CONFIG.BASE_SPEED,
        yaw: -Math.PI / 2,
        pitch: 0,
        roll: 0,
        wingPhase: Math.random() * 100,
        flapSpeed:
          CONFIG.FLAP_MIN + Math.random() * (CONFIG.FLAP_MAX - CONFIG.FLAP_MIN),
        size:
          CONFIG.SIZE_MIN + Math.random() * (CONFIG.SIZE_MAX - CONFIG.SIZE_MIN),
        state: 'flying',
        restTimer: 0,
        noiseOffsetX: Math.random() * 1000,
        baseSpeed: CONFIG.BASE_SPEED,
        isGliding: false,
        glideTimer: 0,
        preferredHeading: Math.random() * Math.PI * 2,
        targetX: 0,
        targetY: 0,

        palette:
          MAGIC.palettes[Math.floor(Math.random() * MAGIC.palettes.length)],
        trail: Array.from({ length: MAGIC.trailLen }).map(() => ({
          x: startX,
          y: startY,
        })),
        trailHead: 0,

        rWing2D: WING_VERTICES.map(() => ({ x: 0, y: 0 })),
        lWing2D: WING_VERTICES.map(() => ({ x: 0, y: 0 })),
        head2D: { x: 0, y: 0 },
        tail2D: { x: 0, y: 0 },
      };
    });
  }, [count]);

  useEffect(() => {
    if (!mounted) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) return;

    // PATCH 3: A11y Check
    const prefersReduced =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    let active = true;
    lastTimeRef.current = performance.now();
    const fov = 1000;

    // --- Transform Logic ---
    const transformAndProject = (
      bx: number,
      by: number,
      size: number,
      vx: number,
      vy: number,
      vz: number,
      mirror: boolean,
      wingAngle: number,
      roll: number,
      pitch: number,
      yaw: number,
      out: Point2D,
    ): number => {
      let x = mirror ? -vx : vx;
      let y = vy;
      let z = vz;
      const flapDir = mirror ? -1 : 1;
      // Flap
      const a1 = wingAngle * flapDir;
      const c1 = Math.cos(a1);
      const s1 = Math.sin(a1);
      let tx = x * c1 + z * s1;
      let tz = -x * s1 + z * c1;
      x = tx;
      z = tz;
      // Roll
      const c2 = Math.cos(roll);
      const s2 = Math.sin(roll);
      tx = x * c2 - y * s2;
      let ty = x * s2 + y * c2;
      x = tx;
      y = ty;
      // Pitch
      const c3 = Math.cos(pitch);
      const s3 = Math.sin(pitch);
      ty = y * c3 - z * s3;
      tz = y * s3 + z * c3;
      y = ty;
      z = tz;
      // Yaw
      const c4 = Math.cos(yaw);
      const s4 = Math.sin(yaw);
      tx = x * c4 - y * s4;
      ty = x * s4 + y * c4;
      x = tx;
      y = ty;
      // Project
      const scaleZ = fov / (fov + z);
      out.x = bx + x * size * scaleZ;
      out.y = by + y * size * scaleZ;
      return z;
    };

    // --- Drawing Helpers ---

    const drawDiamondStar = (
      cx: number,
      cy: number,
      r: number,
      color: string,
    ) => {
      ctx.beginPath();
      ctx.moveTo(cx, cy - r);
      ctx.quadraticCurveTo(cx + r * 0.1, cy - r * 0.1, cx + r, cy);
      ctx.quadraticCurveTo(cx + r * 0.1, cy + r * 0.1, cx, cy + r);
      ctx.quadraticCurveTo(cx - r * 0.1, cy + r * 0.1, cx - r, cy);
      ctx.quadraticCurveTo(cx - r * 0.1, cy - r * 0.1, cx, cy - r);
      ctx.closePath();
      ctx.fillStyle = color;
      ctx.fill();
    };

    const drawTrail = (b: Butterfly) => {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      for (let i = 0; i < b.trail.length - 1; i++) {
        const idx0 = (b.trailHead - 1 - i + b.trail.length) % b.trail.length;
        const idx1 = (idx0 - 1 + b.trail.length) % b.trail.length;
        const p0 = b.trail[idx0];
        const p1 = b.trail[idx1];
        if (Math.abs(p0.x - p1.x) > 100 || Math.abs(p0.y - p1.y) > 100)
          continue;

        const age = i / b.trail.length;
        const alpha = MAGIC.trailAlpha * (1 - age);

        ctx.beginPath();
        ctx.moveTo(p0.x, p0.y);
        ctx.lineTo(p1.x, p1.y);

        ctx.strokeStyle = b.palette[1];
        ctx.shadowColor = b.palette[2];
        ctx.shadowBlur = 8 * (1 - age);
        ctx.lineWidth = b.size * 0.35 * (1 - age);
        ctx.globalAlpha = alpha;
        ctx.stroke();
      }
      ctx.restore();
    };

    const drawWingMagical = (
      points: Point2D[],
      palette: string[],
      z: number,
      size: number,
    ) => {
      const mx = (points[2].x + points[4].x) * 0.5;
      const my = (points[2].y + points[4].y) * 0.5;
      const g = ctx.createRadialGradient(mx, my, 1, mx, my, size * 3.0);
      g.addColorStop(0.0, palette[0]);
      g.addColorStop(0.6, palette[1]);
      g.addColorStop(1.0, palette[2]);

      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.shadowBlur = MAGIC.glowOuter;
      ctx.shadowColor = palette[1];

      ctx.beginPath();
      ctx.moveTo(points[0].x, points[0].y);
      ctx.quadraticCurveTo(points[1].x, points[1].y, points[2].x, points[2].y);
      ctx.quadraticCurveTo(points[3].x, points[3].y, points[4].x, points[4].y);
      const bx = points[5].x;
      const by = points[5].y;
      ctx.quadraticCurveTo(
        (bx + points[4].x) * 0.5,
        (by + points[4].y) * 0.5 + size * 0.5,
        bx,
        by,
      );
      ctx.quadraticCurveTo(
        (points[0].x + bx) * 0.5,
        (points[0].y + by) * 0.5,
        points[0].x,
        points[0].y,
      );
      ctx.closePath();

      ctx.fillStyle = g;
      ctx.fill();

      // Delicate rim light
      ctx.shadowBlur = MAGIC.glowInner;
      ctx.shadowColor = palette[0];
      ctx.lineWidth = size * 0.08;
      ctx.strokeStyle = 'rgba(255,255,255,0.4)';
      ctx.stroke();
      ctx.restore();
    };

    const drawBody = (b: Butterfly) => {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';

      const hx = b.head2D.x;
      const hy = b.head2D.y;
      const tx = b.tail2D.x;
      const ty = b.tail2D.y;

      // Spinal Cord (Glowing Line)
      ctx.shadowBlur = 10;
      ctx.shadowColor = b.palette[2];
      ctx.strokeStyle = 'rgba(255,255,255,0.4)';
      ctx.lineWidth = b.size * 0.12;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(hx, hy);
      ctx.lineTo(tx, ty);
      ctx.stroke();

      // Chest Gem
      ctx.shadowBlur = 15;
      ctx.shadowColor = b.palette[0];
      ctx.fillStyle = '#FFF';
      ctx.beginPath();
      const gx = hx * 0.6 + tx * 0.4;
      const gy = hy * 0.6 + ty * 0.4;
      ctx.arc(gx, gy, b.size * 0.15, 0, Math.PI * 2);
      ctx.fill();

      ctx.restore();
    };

    const renderButterfly = (b: Butterfly) => {
      const flapSine = Math.sin(b.wingPhase);
      const up = Math.max(0, flapSine);
      const down = Math.max(0, -flapSine);
      const wingAngle = -up * CONFIG.FLAP_AMP + down * (CONFIG.FLAP_AMP * 0.4);

      let rZSum = 0;
      let lZSum = 0;

      for (let i = 0; i < WING_VERTICES.length; i++) {
        const v = WING_VERTICES[i];
        rZSum += transformAndProject(
          b.x,
          b.y,
          b.size,
          v.x,
          v.y,
          v.z,
          false,
          wingAngle,
          b.roll,
          b.pitch,
          b.yaw,
          b.rWing2D[i],
        );
        lZSum += transformAndProject(
          b.x,
          b.y,
          b.size,
          v.x,
          v.y,
          v.z,
          true,
          wingAngle,
          b.roll,
          b.pitch,
          b.yaw,
          b.lWing2D[i],
        );
      }
      transformAndProject(
        b.x,
        b.y,
        b.size,
        0,
        -4,
        0,
        false,
        0,
        b.roll,
        b.pitch,
        b.yaw,
        b.head2D,
      );
      transformAndProject(
        b.x,
        b.y,
        b.size,
        0,
        4,
        0,
        false,
        0,
        b.roll,
        b.pitch,
        b.yaw,
        b.tail2D,
      );

      drawTrail(b);

      const rZAvg = rZSum / 6;
      const lZAvg = lZSum / 6;

      if (rZAvg > lZAvg) {
        drawWingMagical(b.rWing2D, b.palette, rZAvg, b.size);
        drawBody(b);
        drawWingMagical(b.lWing2D, b.palette, lZAvg, b.size);
      } else {
        drawWingMagical(b.lWing2D, b.palette, lZAvg, b.size);
        drawBody(b);
        drawWingMagical(b.rWing2D, b.palette, rZAvg, b.size);
      }
    };

    const loop = (now: number) => {
      if (!active) return;

      // PATCH 3: Battery & Tab Focus Guard
      if (document.hidden) {
        lastTimeRef.current = now;
        rafRef.current = requestAnimationFrame(loop);
        return;
      }

      // Time Step with clamp for glitches/reduced motion
      const dtRaw = (now - lastTimeRef.current) / 1000;
      const dt = Math.min(dtRaw, prefersReduced ? 0.02 : 0.05);
      lastTimeRef.current = now;

      const w = window.innerWidth;
      const h = window.innerHeight;
      const dpr = Math.min(2, window.devicePixelRatio || 1);

      if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
        canvas.width = w * dpr;
        canvas.height = h * dpr;
        canvas.style.width = `${w}px`;
        canvas.style.height = `${h}px`;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      }

      // PATCH 2: Canvas State Hygiene
      ctx.clearRect(0, 0, w, h);
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
      ctx.shadowBlur = 0;
      ctx.shadowColor = 'transparent';

      const noise = noiseRef.current!;
      const posters = posterBoundsRef.current;

      const landProb = 1 - Math.exp(-CONFIG.LAND_RATE * dt);
      const glideProb = 1 - Math.exp(-CONFIG.GLIDE_RATE * dt);
      const sparkleProb = 1 - Math.exp(-CONFIG.SPARKLE_RATE * dt);

      butterfliesRef.current.forEach((b) => {
        // Trail Logic
        const lastIdx = (b.trailHead - 1 + b.trail.length) % b.trail.length;
        const lastP = b.trail[lastIdx];
        const distSq = (b.x - lastP.x) ** 2 + (b.y - lastP.y) ** 2;

        if (distSq > 4) {
          b.trail[b.trailHead].x = b.x;
          b.trail[b.trailHead].y = b.y;
          b.trailHead = (b.trailHead + 1) % b.trail.length;
        }

        // Anime Sparkles
        if (Math.random() < sparkleProb) {
          ctx.save();
          ctx.globalCompositeOperation = 'lighter';
          ctx.shadowColor = b.palette[2];
          ctx.shadowBlur = 10;
          const sx = b.x + (Math.random() - 0.5) * b.size * 4;
          const sy = b.y + (Math.random() - 0.5) * b.size * 4;
          drawDiamondStar(sx, sy, 2 + Math.random() * 3, '#FFF');
          ctx.restore();
        }

        // Physics/AI
        if (
          b.state === 'flying' &&
          posters?.length &&
          Math.random() < landProb
        ) {
          const p = posters[(Math.random() * posters.length) | 0];
          b.targetX = (p.left + p.right) * 0.5 + (Math.random() - 0.5) * 40;
          b.targetY = p.top - b.size * 2;
          b.state = 'approaching';
        }

        if (b.state === 'approaching') {
          const dx = b.targetX - b.x;
          const dy = b.targetY - b.y;
          const dist = Math.hypot(dx, dy);

          // PATCH 1: Robust NaN / Zero division guard
          if (!Number.isFinite(dist) || dist < 2) {
            b.state = 'resting';
            b.restTimer = CONFIG.REST_MS;
            b.vx = 0;
            b.vy = 0;
          } else {
            const inv = 1 / dist;
            const speed = Math.min(CONFIG.APPROACH_SPEED, dist * 3);
            b.vx += dx * inv * speed * dt * 4;
            b.vy += dy * inv * speed * dt * 4;
            b.vx *= 0.9;
            b.vy *= 0.9;
            b.yaw = Math.atan2(b.vy, b.vx) + Math.PI / 2;
            b.wingPhase += b.flapSpeed * dt * Math.PI * 2;
          }
        } else if (b.state === 'resting') {
          b.restTimer -= dt * 1000;
          b.wingPhase += dt * 3;
          b.pitch *= 0.9;
          b.roll *= 0.9;
          if (b.restTimer <= 0) {
            b.state = 'flying';
            b.vx = (Math.random() - 0.5) * CONFIG.BASE_SPEED;
            b.vy = -CONFIG.BASE_SPEED;
          }
        } else {
          const t = now * 0.001;
          const n1 = noise.noise2D(b.noiseOffsetX + t * 0.3, b.id * 10.5);
          const desiredHeading = b.preferredHeading + n1 * 1.5;
          const desiredYaw = desiredHeading + Math.PI / 2;
          let diff = desiredYaw - b.yaw;
          while (diff < -Math.PI) diff += Math.PI * 2;
          while (diff > Math.PI) diff -= Math.PI * 2;
          const maxTurn = CONFIG.TURN_SPEED * dt;
          b.yaw += Math.max(-maxTurn, Math.min(maxTurn, diff));
          b.roll += (diff * 1.2 - b.roll) * 4 * dt;
          const vxT = Math.cos(desiredHeading) * b.baseSpeed;
          const vyT = Math.sin(desiredHeading) * b.baseSpeed;
          b.vx += (vxT - b.vx) * 2 * dt;
          b.vy += (vyT - b.vy) * 2 * dt;

          if (!b.isGliding && Math.random() < glideProb) {
            b.isGliding = true;
            b.glideTimer = 500 + Math.random() * 1000;
          }
          if (b.isGliding) {
            b.glideTimer -= dt * 1000;
            b.pitch = 0.2;
            if (b.glideTimer <= 0) b.isGliding = false;
          } else {
            b.wingPhase += b.flapSpeed * dt * Math.PI * 2;
            b.pitch = Math.sin(b.wingPhase) * 0.1;
            const flap = Math.sin(b.wingPhase);
            if (flap < 0) b.vy -= CONFIG.LIFT_IMPULSE * -flap * dt;
            b.vy += CONFIG.GRAVITY * dt;
          }
        }

        const dragFactor = Math.pow(CONFIG.DRAG, dt * 60);
        b.vx *= dragFactor;
        b.vy *= dragFactor;
        const maxSpeed = b.baseSpeed * CONFIG.MAX_SPEED_MULT;
        const currentSpeed = Math.hypot(b.vx, b.vy);
        if (currentSpeed > maxSpeed) {
          const scale = maxSpeed / currentSpeed;
          b.vx *= scale;
          b.vy *= scale;
        }

        b.x += b.vx * dt;
        b.y += b.vy * dt;
        const margin = 50;
        let wrapped = false;
        if (b.x < -margin) {
          b.x = w + margin;
          wrapped = true;
        } else if (b.x > w + margin) {
          b.x = -margin;
          wrapped = true;
        }
        if (b.y < -margin) {
          b.y = h + margin;
          wrapped = true;
        } else if (b.y > h + margin) {
          b.y = -margin;
          wrapped = true;
        }

        if (wrapped) {
          // "Respawn" with new color and reset trail to prevent long lines across screen
          b.palette =
            MAGIC.palettes[Math.floor(Math.random() * MAGIC.palettes.length)];
          b.trail = Array.from({ length: MAGIC.trailLen }).map(() => ({
            x: b.x,
            y: b.y,
          }));
          if (b.state === 'approaching') b.state = 'flying'; // Reset state if it got lost
        }

        renderButterfly(b);
      });
      rafRef.current = requestAnimationFrame(loop);
    };

    rafRef.current = requestAnimationFrame(loop);
    return () => {
      active = false;
      cancelAnimationFrame(rafRef.current);
    };
  }, [mounted]);

  if (!mounted) return null;

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100vw',
        height: '100vh',
        pointerEvents: 'none',
        zIndex: 50,
      }}
    />
  );
};

export default React.memo(MagicalButterfly);
