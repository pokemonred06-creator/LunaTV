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
// Configuration & Naturalistic Species
// ========================================

interface Marking {
  x: number; // wing-local coords (same frame as WING_VERTICES)
  y: number;
  r: number; // relative dot radius
  color: string;
}

interface Species {
  name: string;
  wingInner: string; // near the body
  wingOuter: string; // wing tip / edge
  border: string; // dark outline + venation
  borderWidth: number; // * size
  body: string; // thorax / abdomen / antennae
  alpha: number; // wing translucency
  veins: boolean;
  markings: Marking[];
}

// Real-species coloring. Approximate but recognizable — natural pigments,
// no neon. Each butterfly is randomly assigned one of these at spawn.
const SPECIES: Species[] = [
  {
    name: 'monarch',
    wingInner: '#D35400',
    wingOuter: '#E67E22',
    border: '#1A1A1A',
    borderWidth: 0.18,
    body: '#1A1A1A',
    alpha: 0.95,
    veins: true,
    markings: [
      { x: 11, y: -8, r: 0.9, color: '#FFFFFF' },
      { x: 12.5, y: -5, r: 0.8, color: '#FFFFFF' },
      { x: 12, y: 6, r: 0.9, color: '#FFFFFF' },
      { x: 8, y: 12, r: 0.9, color: '#FFFFFF' },
    ],
  },
  {
    name: 'blue-morpho',
    wingInner: '#1E88E5',
    wingOuter: '#90CAF9',
    border: '#3E2723',
    borderWidth: 0.22,
    body: '#2E2620',
    alpha: 0.96,
    veins: false,
    markings: [
      { x: 12, y: -6, r: 0.6, color: '#ECEFF1' },
      { x: 11, y: 8, r: 0.6, color: '#ECEFF1' },
    ],
  },
  {
    name: 'tiger-swallowtail',
    wingInner: '#F9C513',
    wingOuter: '#FFEB3B',
    border: '#1A1A1A',
    borderWidth: 0.2,
    body: '#1A1A1A',
    alpha: 0.95,
    veins: true,
    markings: [
      { x: 5, y: -6, r: 0.7, color: '#161616' },
      { x: 7, y: -2, r: 0.7, color: '#161616' },
      { x: 6, y: 4, r: 0.7, color: '#161616' },
      { x: 9, y: 12, r: 0.8, color: '#1565C0' },
      { x: 6, y: 13, r: 0.7, color: '#E64A19' },
    ],
  },
  {
    name: 'cabbage-white',
    wingInner: '#FFFFFF',
    wingOuter: '#F0F0F0',
    border: '#D7D2C8',
    borderWidth: 0.14,
    body: '#5D5048',
    alpha: 0.9,
    veins: false,
    markings: [
      { x: 11, y: -7, r: 1.1, color: '#9E9E9E' },
      { x: 9, y: 2, r: 0.7, color: '#3A3A3A' },
    ],
  },
  {
    name: 'red-admiral',
    wingInner: '#2B1A12',
    wingOuter: '#1A120C',
    border: '#0E0A07',
    borderWidth: 0.16,
    body: '#15100B',
    alpha: 0.95,
    veins: false,
    markings: [
      { x: 8, y: -4, r: 1.0, color: '#E53935' },
      { x: 6, y: 2, r: 0.9, color: '#E53935' },
      { x: 9, y: 7, r: 0.9, color: '#E53935' },
      { x: 12, y: -7, r: 0.6, color: '#FFFFFF' },
      { x: 11, y: -9, r: 0.5, color: '#FFFFFF' },
    ],
  },
];

const CONFIG = {
  BASE_SPEED: 60, // gentler than the old magical darting (was 80)
  MAX_SPEED_MULT: 1.4,
  TURN_SPEED: 5.0,
  DRAG: 0.985,
  FLAP_MIN: 8,
  FLAP_MAX: 15,
  FLAP_AMP: Math.PI / 2.2,
  LIFT_IMPULSE: 85,
  GRAVITY: 60,
  GLIDE_RATE: 0.4,
  SIZE_MIN: 2.5,
  SIZE_MAX: 3.5,
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
  species: Species;
  rWing2D: Point2D[];
  lWing2D: Point2D[];
  rMarks2D: Point2D[];
  lMarks2D: Point2D[];
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
        const species = SPECIES[Math.floor(Math.random() * SPECIES.length)];
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
          species,
          rWing2D: WING_VERTICES.map(() => ({ x: 0, y: 0 })),
          lWing2D: WING_VERTICES.map(() => ({ x: 0, y: 0 })),
          rMarks2D: species.markings.map(() => ({ x: 0, y: 0 })),
          lMarks2D: species.markings.map(() => ({ x: 0, y: 0 })),
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
    // 30fps render gate: physics runs every rAF for smooth motion;
    // canvas clear+draw only happens at 30fps to halve GPU compositor cost.
    const RENDER_INTERVAL = 1000 / 30;
    let renderAccum = 0;
    let lastDpr = 0;

    const fov = 1000;
    const transformAndProject = (
      bx: number,
      by: number,
      size: number,
      vx: number,
      vy: number,
      vz: number,
      mirror: boolean,
      c1: number, // Math.cos(wingAngle)
      s1: number, // Math.sin(wingAngle) * flapDir
      c2: number, // Math.cos(roll)
      s2: number, // Math.sin(roll)
      c3: number, // Math.cos(pitch)
      s3: number, // Math.sin(pitch)
      c4: number, // Math.cos(yaw)
      s4: number, // Math.sin(yaw)
      out: Point2D,
    ): number => {
      let x = mirror ? -vx : vx;
      let y = vy;
      let z = vz;
      const flapDir = mirror ? -1 : 1;
      const _c1 = c1;
      const _s1 = s1 * flapDir;
      let tx = x * _c1 + z * _s1;
      let tz = -x * _s1 + z * _c1;
      x = tx;
      z = tz;
      tx = x * c2 - y * s2;
      let ty = x * s2 + y * c2;
      x = tx;
      y = ty;
      ty = y * c3 - z * s3;
      tz = y * s3 + z * c3;
      y = ty;
      z = tz;
      tx = x * c4 - y * s4;
      ty = x * s4 + y * c4;
      x = tx;
      y = ty;
      const scaleZ = fov / (fov + z);
      out.x = bx + x * size * scaleZ;
      out.y = by + y * size * scaleZ;
      return z;
    };

    // Soft grounding shadow under the butterfly (depth cue, replaces the glow).
    const drawShadow = (b: Butterfly) => {
      const sx = b.x + b.size * 1.5;
      const sy = b.y + b.size * 4;
      const rx = b.size * 6;
      const ry = b.size * 2.2;
      const g = ctx.createRadialGradient(sx, sy, 0, sx, sy, rx);
      g.addColorStop(0, 'rgba(0,0,0,0.10)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.save();
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.ellipse(sx, sy, rx, ry, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    };

    // Trace the wing silhouette (shared by fill + stroke).
    const traceWing = (points: Point2D[]) => {
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
    };

    const drawWingNatural = (
      points: Point2D[],
      marks: Point2D[],
      species: Species,
      size: number,
    ) => {
      ctx.save();
      ctx.globalAlpha = species.alpha;
      ctx.lineJoin = 'round';

      // Body->edge gradient using natural pigments (no additive glow).
      const g = ctx.createLinearGradient(
        points[0].x,
        points[0].y,
        points[3].x,
        points[3].y,
      );
      g.addColorStop(0, species.wingInner);
      g.addColorStop(1, species.wingOuter);

      traceWing(points);
      ctx.fillStyle = g;
      ctx.fill();

      // Clip markings/veins to the wing so they never bleed past the edge.
      ctx.save();
      traceWing(points);
      ctx.clip();

      if (species.veins) {
        ctx.globalAlpha = species.alpha * 0.45;
        ctx.strokeStyle = species.border;
        ctx.lineWidth = Math.max(0.4, size * 0.05);
        const root = points[0];
        for (const i of [2, 3, 4, 6]) {
          ctx.beginPath();
          ctx.moveTo(root.x, root.y);
          ctx.lineTo(points[i].x, points[i].y);
          ctx.stroke();
        }
      }

      ctx.globalAlpha = species.alpha;
      for (let i = 0; i < marks.length; i++) {
        const m = marks[i];
        const spec = species.markings[i];
        ctx.beginPath();
        ctx.fillStyle = spec.color;
        ctx.arc(m.x, m.y, Math.max(0.8, spec.r * size * 0.55), 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();

      // Dark outline last so the wing reads crisp against the page.
      ctx.globalAlpha = species.alpha;
      ctx.strokeStyle = species.border;
      ctx.lineWidth = Math.max(0.6, size * species.borderWidth);
      traceWing(points);
      ctx.stroke();
      ctx.restore();
    };

    const drawBody = (b: Butterfly) => {
      ctx.save();
      ctx.fillStyle = b.species.body;
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
      // Head
      ctx.beginPath();
      ctx.arc(hx, hy, b.size * 0.2, 0, Math.PI * 2);
      ctx.fill();
      // Antennae (thin, dark, with a slight club tip)
      ctx.strokeStyle = b.species.body;
      ctx.lineWidth = Math.max(0.4, b.size * 0.06);
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(hx, hy);
      ctx.lineTo(b.antL2D.x, b.antL2D.y);
      ctx.moveTo(hx, hy);
      ctx.lineTo(b.antR2D.x, b.antR2D.y);
      ctx.stroke();
      ctx.fillStyle = b.species.body;
      ctx.beginPath();
      ctx.arc(b.antL2D.x, b.antL2D.y, b.size * 0.08, 0, Math.PI * 2);
      ctx.arc(b.antR2D.x, b.antR2D.y, b.size * 0.08, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    };

    const renderButterfly = (b: Butterfly) => {
      const flapSine = Math.sin(b.wingPhase);
      const wingAngle =
        -Math.max(0, flapSine) * CONFIG.FLAP_AMP +
        Math.max(0, -flapSine) * (CONFIG.FLAP_AMP * 0.4);

      // Precalculate trigonometric sines and cosines once per butterfly per frame
      const cW = Math.cos(wingAngle),
        sW = Math.sin(wingAngle);
      const cR = Math.cos(b.roll),
        sR = Math.sin(b.roll);
      const cP = Math.cos(b.pitch),
        sP = Math.sin(b.pitch);
      const cY = Math.cos(b.yaw),
        sY = Math.sin(b.yaw);

      // Constants for zero wingAngle/pitch cases
      const c0 = 1,
        s0 = 0;

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
          cW,
          sW,
          cR,
          sR,
          cP,
          sP,
          cY,
          sY,
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
          cW,
          sW,
          cR,
          sR,
          cP,
          sP,
          cY,
          sY,
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
        c0,
        s0,
        cR,
        sR,
        cP,
        sP,
        cY,
        sY,
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
        c0,
        s0,
        cR,
        sR,
        cP,
        sP,
        cY,
        sY,
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
        c0,
        s0,
        cR,
        sR,
        cP,
        sP,
        cY,
        sY,
        b.abdomen2D,
      );
      const antP = b.pitch - Math.sin(b.wingPhase * 0.5) * 0.2;
      const cAntP = Math.cos(antP),
        sAntP = Math.sin(antP);
      transformAndProject(
        b.x,
        b.y,
        b.size,
        -2,
        -10,
        2,
        false,
        c0,
        s0,
        cR,
        sR,
        cAntP,
        sAntP,
        cY,
        sY,
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
        c0,
        s0,
        cR,
        sR,
        cAntP,
        sAntP,
        cY,
        sY,
        b.antR2D,
      );
      // Project species markings into each wing's frame so they flap with it.
      for (let i = 0; i < b.species.markings.length; i++) {
        const m = b.species.markings[i];
        transformAndProject(
          b.x,
          b.y,
          b.size,
          m.x,
          m.y,
          0,
          false,
          cW,
          sW,
          cR,
          sR,
          cP,
          sP,
          cY,
          sY,
          b.rMarks2D[i],
        );
        transformAndProject(
          b.x,
          b.y,
          b.size,
          m.x,
          m.y,
          0,
          true,
          cW,
          sW,
          cR,
          sR,
          cP,
          sP,
          cY,
          sY,
          b.lMarks2D[i],
        );
      }

      drawShadow(b);
      if (rZSum > lZSum) {
        drawWingNatural(b.rWing2D, b.rMarks2D, b.species, b.size);
        drawBody(b);
        drawWingNatural(b.lWing2D, b.lMarks2D, b.species, b.size);
      } else {
        drawWingNatural(b.lWing2D, b.lMarks2D, b.species, b.size);
        drawBody(b);
        drawWingNatural(b.rWing2D, b.rMarks2D, b.species, b.size);
      }
    };

    const loop = (now: number) => {
      if (!active) return;
      if (document.hidden) {
        lastTimeRef.current = now;
        rafRef.current = requestAnimationFrame(loop);
        return;
      }
      const rawDt = now - lastTimeRef.current;
      lastTimeRef.current = now;

      // Render & Physics gate: only update at 30fps (RENDER_INTERVAL)
      renderAccum += rawDt;
      if (renderAccum < RENDER_INTERVAL) {
        rafRef.current = requestAnimationFrame(loop);
        return;
      }
      const dt = Math.min(renderAccum / 1000, prefersReduced ? 0.02 : 0.05);
      renderAccum = Math.min(renderAccum - RENDER_INTERVAL, RENDER_INTERVAL);

      const w = window.innerWidth,
        h = window.innerHeight,
        dpr = Math.min(1.5, window.devicePixelRatio || 1);
      const tw = Math.floor(w * dpr),
        th = Math.floor(h * dpr);
      if (canvas.width !== tw || canvas.height !== th) {
        canvas.width = tw;
        canvas.height = th;
        canvas.style.width = `${w}px`;
        canvas.style.height = `${h}px`;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      } else if (dpr !== lastDpr) {
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      }
      lastDpr = dpr;

      const noise = noiseRef.current!;
      const glideProb = 1 - Math.exp(-CONFIG.GLIDE_RATE * dt);

      // --- PHYSICS UPDATE (runs at 30fps along with draw) ---
      butterfliesRef.current.forEach((b) => {
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
      });

      // --- DRAW ---
      ctx.clearRect(0, 0, w, h);
      butterfliesRef.current.forEach((b) => {
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
