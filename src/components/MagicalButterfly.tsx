'use client';

import React, { useEffect, useRef } from 'react';

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
  palettes: [
    ['#0A1628', '#1E90FF', '#00FFFF'],
    ['#0D1B2A', '#3A86FF', '#7DF9FF'],
    ['#1A1A3E', '#4169E1', '#00BFFF'],
    ['#1A0A2E', '#9B59B6', '#E056FD'],
    ['#2D1B4E', '#8E44AD', '#DDA0DD'],
    ['#1F0F3D', '#6C3483', '#BB8FCE'],
    ['#2A0A1A', '#E91E63', '#FF69B4'],
    ['#3D0F2A', '#FF1493', '#FFB6C1'],
    ['#0A2818', '#00C853', '#69F0AE'],
    ['#0F3D1A', '#2ECC71', '#7DCEA0'],
    ['#2A1A0A', '#FFA500', '#FFD700'],
    ['#3D2A0F', '#F39C12', '#F7DC6F'],
    ['#0A2828', '#00CED1', '#40E0D0'],
    ['#2A0A0A', '#E74C3C', '#FF6B6B'],
  ],
  glowOuter: 20,
  glowInner: 12,
  trailLen: 16,
  trailAlpha: 0.25,
};

const CONFIG = {
  BASE_SPEED: 80,
  MAX_SPEED_MULT: 1.6,
  TURN_SPEED: 5.0,
  DRAG: 0.985,
  FLAP_MIN: 8,
  FLAP_MAX: 15,
  FLAP_AMP: Math.PI / 2.2,
  LIFT_IMPULSE: 90,
  GRAVITY: 60,
  GLIDE_RATE: 0.4,
  SPARKLE_RATE: 12.0,
  SIZE_MIN: 2,
  SIZE_MAX: 3,
};

const WING_VERTICES: Point3D[] = [
  { x: 0, y: 0, z: 0 },
  { x: 2, y: -4, z: 0 },
  { x: 8, y: -10, z: 0 },
  { x: 13, y: -7, z: 0 },
  { x: 11, y: 0, z: 1 },
  { x: 12, y: 5, z: 0 },
  { x: 10, y: 10, z: 0 },
  { x: 6, y: 14, z: -1 },
  { x: 3, y: 8, z: 0 },
  { x: 1, y: 3, z: 0 },
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
  noiseOffsetX: number;
  baseSpeed: number;
  isGliding: boolean;
  glideTimer: number;
  preferredHeading: number;
  palette: string[];
  trail: Point2D[];
  trailHead: number;
  rWing2D: Point2D[];
  lWing2D: Point2D[];
  head2D: Point2D;
  thorax2D: Point2D;
  abdomen2D: Point2D;
  antL2D: Point2D;
  antR2D: Point2D;
}

const MagicalButterfly: React.FC<{
  count?: number;
}> = ({ count = 5 }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const butterfliesRef = useRef<Butterfly[]>([]);
  const noiseRef = useRef<SimplexNoise | null>(null);
  const rafRef = useRef<number>(0);
  const lastTimeRef = useRef<number>(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) return;

    noiseRef.current = new SimplexNoise();

    const makeButterflies = () =>
      Array.from({ length: count }).map((_, i) => {
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
            CONFIG.FLAP_MIN +
            Math.random() * (CONFIG.FLAP_MAX - CONFIG.FLAP_MIN),
          size:
            CONFIG.SIZE_MIN +
            Math.random() * (CONFIG.SIZE_MAX - CONFIG.SIZE_MIN),
          noiseOffsetX: Math.random() * 1000,
          baseSpeed: CONFIG.BASE_SPEED,
          isGliding: false,
          glideTimer: 0,
          preferredHeading: Math.random() * Math.PI * 2,
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
          thorax2D: { x: 0, y: 0 },
          abdomen2D: { x: 0, y: 0 },
          antL2D: { x: 0, y: 0 },
          antR2D: { x: 0, y: 0 },
        };
      });

    butterfliesRef.current = makeButterflies();
    const prefersReduced =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let active = true;

    const fov = 1000;
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
      const a1 = wingAngle * flapDir;
      const c1 = Math.cos(a1);
      const s1 = Math.sin(a1);
      let tx = x * c1 + z * s1;
      let tz = -x * s1 + z * c1;
      x = tx;
      z = tz;
      const c2 = Math.cos(roll);
      const s2 = Math.sin(roll);
      tx = x * c2 - y * s2;
      let ty = x * s2 + y * c2;
      x = tx;
      y = ty;
      const c3 = Math.cos(pitch);
      const s3 = Math.sin(pitch);
      ty = y * c3 - z * s3;
      tz = y * s3 + z * c3;
      y = ty;
      z = tz;
      const c4 = Math.cos(yaw);
      const s4 = Math.sin(yaw);
      tx = x * c4 - y * s4;
      ty = x * s4 + y * c4;
      x = tx;
      y = ty;
      const scaleZ = fov / (fov + z);
      out.x = bx + x * size * scaleZ;
      out.y = by + y * size * scaleZ;
      return z;
    };

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
      for (let i = 0; i < b.trail.length - 1; i++) {
        const idx0 = (b.trailHead - 1 - i + b.trail.length) % b.trail.length;
        const idx1 = (idx0 - 1 + b.trail.length) % b.trail.length;
        const p0 = b.trail[idx0],
          p1 = b.trail[idx1];
        if (Math.abs(p0.x - p1.x) > 100 || Math.abs(p0.y - p1.y) > 100)
          continue;
        const age = i / b.trail.length;
        ctx.beginPath();
        ctx.moveTo(p0.x, p0.y);
        ctx.lineTo(p1.x, p1.y);
        ctx.strokeStyle = b.palette[1];
        ctx.shadowColor = b.palette[2];
        ctx.shadowBlur = 8 * (1 - age);
        ctx.lineWidth = b.size * 0.35 * (1 - age);
        ctx.globalAlpha = MAGIC.trailAlpha * (1 - age);
        ctx.stroke();
      }
      ctx.restore();
    };

    const drawWingMagical = (
      points: Point2D[],
      palette: string[],
      size: number,
    ) => {
      const mx = (points[2].x + points[6].x) * 0.5,
        my = (points[2].y + points[6].y) * 0.5;
      const g = ctx.createRadialGradient(mx, my, 1, mx, my, size * 5.0);
      g.addColorStop(0, palette[0]);
      g.addColorStop(0.5, palette[1]);
      g.addColorStop(1, palette[2]);
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.shadowBlur = MAGIC.glowOuter;
      ctx.shadowColor = palette[1];
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(points[0].x, points[0].y);
      ctx.bezierCurveTo(
        points[1].x,
        points[1].y,
        points[2].x,
        points[2].y,
        points[2].x,
        points[2].y,
      );
      ctx.bezierCurveTo(
        points[3].x,
        points[3].y,
        points[4].x,
        points[4].y,
        points[4].x,
        points[4].y,
      );
      ctx.bezierCurveTo(
        points[5].x,
        points[5].y,
        points[6].x,
        points[6].y,
        points[6].x,
        points[6].y,
      );
      ctx.bezierCurveTo(
        points[7].x,
        points[7].y,
        points[8].x,
        points[8].y,
        points[8].x,
        points[8].y,
      );
      ctx.bezierCurveTo(
        points[9].x,
        points[9].y,
        points[0].x,
        points[0].y,
        points[0].x,
        points[0].y,
      );
      ctx.closePath();
      ctx.fill();
      ctx.shadowBlur = MAGIC.glowInner;
      ctx.shadowColor = palette[0];
      ctx.lineWidth = size * 0.1;
      ctx.strokeStyle = 'rgba(255,255,255,0.3)';
      ctx.stroke();
      ctx.restore();
    };

    const drawBody = (b: Butterfly) => {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.shadowBlur = 10;
      ctx.shadowColor = b.palette[2];
      ctx.fillStyle = b.palette[0];
      const hx = b.head2D.x,
        hy = b.head2D.y,
        thx = b.thorax2D.x,
        thy = b.thorax2D.y,
        abx = b.abdomen2D.x,
        aby = b.abdomen2D.y;
      ctx.beginPath();
      ctx.ellipse(
        thx,
        thy,
        b.size * 0.3,
        b.size * 0.5,
        Math.atan2(thy - hy, thx - hx),
        0,
        Math.PI * 2,
      );
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(
        abx,
        aby,
        b.size * 0.2,
        b.size * 1.0,
        Math.atan2(aby - thy, abx - thx),
        0,
        Math.PI * 2,
      );
      ctx.fill();
      ctx.fillStyle = '#FFF';
      ctx.beginPath();
      ctx.arc(hx, hy, b.size * 0.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#FFF';
      ctx.lineWidth = b.size * 0.05;
      ctx.beginPath();
      ctx.moveTo(hx, hy);
      ctx.lineTo(b.antL2D.x, b.antL2D.y);
      ctx.moveTo(hx, hy);
      ctx.lineTo(b.antR2D.x, b.antR2D.y);
      ctx.stroke();
      ctx.restore();
    };

    const renderButterfly = (b: Butterfly) => {
      const flapSine = Math.sin(b.wingPhase);
      const wingAngle =
        -Math.max(0, flapSine) * CONFIG.FLAP_AMP +
        Math.max(0, -flapSine) * (CONFIG.FLAP_AMP * 0.4);
      let rZSum = 0,
        lZSum = 0;
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
        -5,
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
        -2,
        0,
        false,
        0,
        b.roll,
        b.pitch,
        b.yaw,
        b.thorax2D,
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
        b.abdomen2D,
      );
      const antP = b.pitch - Math.sin(b.wingPhase * 0.5) * 0.2;
      transformAndProject(
        b.x,
        b.y,
        b.size,
        -2,
        -10,
        2,
        false,
        0,
        b.roll,
        antP,
        b.yaw,
        b.antL2D,
      );
      transformAndProject(
        b.x,
        b.y,
        b.size,
        2,
        -10,
        2,
        false,
        0,
        b.roll,
        antP,
        b.yaw,
        b.antR2D,
      );
      drawTrail(b);
      if (rZSum > lZSum) {
        drawWingMagical(b.rWing2D, b.palette, b.size);
        drawBody(b);
        drawWingMagical(b.lWing2D, b.palette, b.size);
      } else {
        drawWingMagical(b.lWing2D, b.palette, b.size);
        drawBody(b);
        drawWingMagical(b.rWing2D, b.palette, b.size);
      }
    };

    const loop = (now: number) => {
      if (!active) return;
      if (document.hidden) {
        lastTimeRef.current = now;
        rafRef.current = requestAnimationFrame(loop);
        return;
      }
      const dt = Math.min(
        (now - lastTimeRef.current) / 1000,
        prefersReduced ? 0.02 : 0.05,
      );
      lastTimeRef.current = now;
      const w = window.innerWidth,
        h = window.innerHeight,
        dpr = Math.min(2, window.devicePixelRatio || 1);
      const tw = Math.floor(w * dpr),
        th = Math.floor(h * dpr);
      if (canvas.width !== tw || canvas.height !== th) {
        canvas.width = tw;
        canvas.height = th;
        canvas.style.width = `${w}px`;
        canvas.style.height = `${h}px`;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      }
      ctx.clearRect(0, 0, w, h);
      const noise = noiseRef.current!;
      const glideProb = 1 - Math.exp(-CONFIG.GLIDE_RATE * dt),
        sparkleProb = 1 - Math.exp(-CONFIG.SPARKLE_RATE * dt);

      butterfliesRef.current.forEach((b) => {
        const lastP =
          b.trail[(b.trailHead - 1 + b.trail.length) % b.trail.length];
        if ((b.x - lastP.x) ** 2 + (b.y - lastP.y) ** 2 > 4) {
          b.trail[b.trailHead] = { x: b.x, y: b.y };
          b.trailHead = (b.trailHead + 1) % b.trail.length;
        }
        if (Math.random() < sparkleProb) {
          ctx.save();
          ctx.globalCompositeOperation = 'lighter';
          ctx.shadowColor = b.palette[2];
          ctx.shadowBlur = 10;
          drawDiamondStar(
            b.x + (Math.random() - 0.5) * b.size * 4,
            b.y + (Math.random() - 0.5) * b.size * 4,
            2 + Math.random() * 3,
            '#FFF',
          );
          ctx.restore();
        }
        const t = now * 0.001;
        const n1 = noise.noise2D(b.noiseOffsetX + t * 0.3, b.id * 10.5);
        const dYaw = b.preferredHeading + n1 * 1.5 + Math.PI / 2;
        let diff = dYaw - b.yaw;
        while (diff < -Math.PI) diff += Math.PI * 2;
        while (diff > Math.PI) diff -= Math.PI * 2;
        const maxTurn = CONFIG.TURN_SPEED * dt;
        b.yaw += Math.max(-maxTurn, Math.min(maxTurn, diff));
        b.roll += (diff * 1.2 - b.roll) * 4 * dt;
        if (Math.random() < glideProb) b.isGliding = !b.isGliding;
        const speed = b.isGliding ? b.baseSpeed * 0.6 : b.baseSpeed;
        b.vx += Math.cos(b.yaw - Math.PI / 2) * speed * dt * 5;
        b.vy += Math.sin(b.yaw - Math.PI / 2) * speed * dt * 5;
        const drag = Math.pow(CONFIG.DRAG, dt * 60);
        b.vx *= drag;
        b.vy *= drag;
        const curS = Math.hypot(b.vx, b.vy),
          maxS = b.baseSpeed * CONFIG.MAX_SPEED_MULT;
        if (curS > maxS) {
          b.vx *= maxS / curS;
          b.vy *= maxS / curS;
        }
        b.x += b.vx * dt;
        b.y += b.vy * dt;
        if (b.isGliding) {
          b.pitch = 0.2;
          b.wingPhase += (Math.PI - (b.wingPhase % Math.PI)) * 0.1;
        } else {
          b.wingPhase += b.flapSpeed * dt * Math.PI * 2;
          b.pitch = Math.sin(b.wingPhase) * 0.1;
          const flap = Math.sin(b.wingPhase);
          if (flap < 0) b.vy -= CONFIG.LIFT_IMPULSE * -flap * dt;
          b.vy += CONFIG.GRAVITY * dt;
        }
        const margin = 100;
        if (b.x < -margin) b.x = w + margin;
        else if (b.x > w + margin) b.x = -margin;
        if (b.y < -margin) b.y = h + margin;
        else if (b.y > h + margin) b.y = -margin;
        renderButterfly(b);
      });
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => {
      active = false;
      cancelAnimationFrame(rafRef.current);
    };
  }, [count]);

  return (
    <canvas
      ref={canvasRef}
      style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 25 }}
    />
  );
};

export default React.memo(MagicalButterfly);
