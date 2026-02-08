'use client';

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

// ========================================
// Types
// ========================================

interface PhysicsParticle {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  rotation: number;
  rotationSpeed: number;
  flutter: number; // Autumn: per-particle flutter intensity (variety)
  opacity: number;
  settled: boolean;
  settledAt: number;
  texture: CanvasImageSource | null;
  textureKey: string;
  color: string;
  bornAt: number; // spawn time for fade-in
  // For realistic stacking
  parentBoundsTop: number; // Top of the poster it settled on (at time of settling)
  parentBoundsHeight: number; // Height when settled (track resize)
  posterKey: string | null; // Stable ID of the poster
  relativeY: number; // Vertical offset relative to the poster's top
  swayOffset: number; // Per-particle phase for horizontal flutter
  z: number; // Depth (0 = far, 1 = close)
  passThrough: boolean; // If true, this particle will not settle on first layer
}

// Gradient Cache for Performance
const snowGradCache = new Map<number, CanvasGradient>();
const getSnowGrad = (ctx: CanvasRenderingContext2D, size: number) => {
  const key = Math.round(size * 2) / 2; // Bucket by 0.5 size
  if (snowGradCache.has(key)) return snowGradCache.get(key)!;

  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, key / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.4, 'rgba(255,255,255,0.9)');
  g.addColorStop(0.7, 'rgba(240,248,255,0.6)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  snowGradCache.set(key, g);
  return g;
};

export interface PosterBounds {
  key?: string; // Stable ID
  top: number;
  left: number;
  right: number;
  width: number;
  height: number;
  bottom: number;
}

export type PhysicsSnowProps = {
  mode: 'winter' | 'spring' | 'autumn';
  count?: number;
  intensity?: 'light' | 'normal' | 'heavy';
  posterBounds?: PosterBounds[]; // Legacy prop, can be removed if fully replaced
  posterElements?: Map<string, HTMLElement>; // Direct DOM access
};

// ========================================
// Configuration
// ========================================

const CONFIG = {
  GRAVITY: 30,
  WIND_BASE: 15,
  WIND_VARIANCE: 10,
  MAX_PARTICLES: 200,
  MAX_SETTLED: 60,
  SETTLED_TIMEOUT_MS: 12000,
  SETTLED_FADE_MS: 2000,
  SHAKE_THRESHOLD: 8,
  SHAKE_DEBOUNCE_MS: 100,
  FRICTION: 0.9, // Increased friction for stability (was 0.92, lower is stronger drag? No, multiplied. 0.90 is stronger drag than 0.92)
  STACK_DIST_FACTOR: 0.8, // How close particles can get
  SLIDE_THRESHOLD: 1.5, // Lower threshold for earlier settling
  ROTATION_ALIGN_SPEED: 5.0, // Speed to align to horizontal
};

// ========================================
// SVG Textures (Data URIs)
// ========================================

const svgData = (svg: string) =>
  `data:image/svg+xml,${encodeURIComponent(svg)}`;

const SPRING_TEXTURES = {
  // Cherry blossom with veins and gradient
  cherryBlossom: `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><defs><radialGradient id="cb" cx="50%" cy="50%"><stop offset="0%" stop-color="#FFE4E9"/><stop offset="100%" stop-color="#FFB7C5"/></radialGradient></defs><path fill="url(#cb)" d="M12 2C13 4 14 6 16 7C18 8 20 7 22 8C20 10 18 11 18 14C18 17 20 18 20 22C17 20 14 19 12 20C10 19 7 20 4 22C4 18 6 17 6 14C6 11 4 10 2 8C4 7 6 8 8 7C10 6 11 4 12 2Z"/><path stroke="#E8A0B0" stroke-width="0.3" fill="none" d="M12 12L12 4M12 12L18 6M12 12L20 12M12 12L18 18M12 12L12 20M12 12L6 18M12 12L4 12M12 12L6 6"/><circle fill="#FFEB3B" cx="12" cy="12" r="2.5"/><circle fill="#FFF59D" cx="12" cy="12" r="1.5"/></svg>`)}`,
  // Sakura petal with center vein and gradient
  sakuraPetal: `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 28"><defs><linearGradient id="sp" x1="0%" y1="0%" x2="100%" y2="0%"><stop offset="0%" stop-color="#FFD1DC"/><stop offset="50%" stop-color="#FFC0CB"/><stop offset="100%" stop-color="#FFD1DC"/></linearGradient></defs><ellipse fill="url(#sp)" cx="8" cy="14" rx="6" ry="12"/><path stroke="#E8A0B0" stroke-width="0.4" fill="none" d="M8 3L8 25M8 8L5 12M8 8L11 12M8 14L5 18M8 14L11 18"/><ellipse fill="#FFF0F5" cx="8" cy="8" rx="2" ry="3" opacity="0.6"/></svg>`)}`,
  // White plum with detailed veins and yellow center
  whitePlum: `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><defs><radialGradient id="wp" cx="50%" cy="50%"><stop offset="0%" stop-color="#FFFFFF"/><stop offset="100%" stop-color="#FFF5F5"/></radialGradient></defs><path fill="url(#wp)" d="M12 2C13 5 15 7 18 8C21 9 22 12 22 12C22 12 21 15 18 16C15 17 13 19 12 22C11 19 9 17 6 16C3 15 2 12 2 12C2 12 3 9 6 8C9 7 11 5 12 2Z"/><path stroke="#E0D0D0" stroke-width="0.3" fill="none" d="M12 12L12 4M12 12L19 9M12 12L19 15M12 12L12 20M12 12L5 15M12 12L5 9"/><circle fill="#FFD700" cx="12" cy="12" r="2.5"/><circle fill="#FFEB3B" cx="12" cy="12" r="1.5"/></svg>`)}`,
  // Pink petal with gradient and vein
  petalPink: `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 32"><defs><linearGradient id="pp" x1="0%" y1="0%" x2="100%" y2="0%"><stop offset="0%" stop-color="#FFC0CB"/><stop offset="50%" stop-color="#FFB6C1"/><stop offset="100%" stop-color="#FFC0CB"/></linearGradient></defs><path fill="url(#pp)" d="M10 0C15 8 18 16 16 26C14 30 10 32 10 32C10 32 6 30 4 26C2 16 5 8 10 0Z"/><path stroke="#E8A0B0" stroke-width="0.4" fill="none" d="M10 2L10 30M10 10L7 16M10 10L13 16M10 18L7 24M10 18L13 24"/></svg>`)}`,
  // White petal with soft vein
  petalWhite: `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 32"><defs><linearGradient id="pw" x1="0%" y1="0%" x2="100%" y2="0%"><stop offset="0%" stop-color="#FFFFFF"/><stop offset="50%" stop-color="#FFF0F5"/><stop offset="100%" stop-color="#FFFFFF"/></linearGradient></defs><path fill="url(#pw)" d="M10 0C15 8 18 16 16 26C14 30 10 32 10 32C10 32 6 30 4 26C2 16 5 8 10 0Z"/><path stroke="#E8D0D8" stroke-width="0.3" fill="none" d="M10 2L10 30M10 12L8 18M10 12L12 18"/></svg>`)}`,
};

const AUTUMN_TEXTURES = {
  // Higher-detail, more realistic leaf set (gradients + veins + subtle texture).
  // Keep viewBox square-ish so rotations look natural.
  mapleScarlet:
    svgData(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <defs>
    <linearGradient id="ms_g" x1="12" y1="10" x2="54" y2="56" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#ff6b3a"/>
      <stop offset="0.45" stop-color="#d83a2a"/>
      <stop offset="1" stop-color="#7a1d1d"/>
    </linearGradient>
    <filter id="ms_tex" x="-10%" y="-10%" width="120%" height="120%">
      <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" seed="2" />
      <feColorMatrix type="matrix" values="
        1 0 0 0 0
        0 1 0 0 0
        0 0 1 0 0
        0 0 0 0.25 0" />
      <feComposite operator="in" in2="SourceGraphic"/>
    </filter>
  </defs>
  <path d="M32 6
           C33 10 36 14 41 16
           C44 17 47 17 50 16
           C49 20 46 23 46 27
           C46 31 49 33 50 36
           C51 39 50 44 47 48
           C44 53 39 55 35 55
           C34 55 33 56 32 60
           C31 56 30 55 29 55
           C25 55 20 53 17 48
           C14 44 13 39 14 36
           C15 33 18 31 18 27
           C18 23 15 20 14 16
           C17 17 20 17 23 16
           C28 14 31 10 32 6 Z"
        fill="rgba(0,0,0,0.12)" transform="translate(1.2 1.8)"/>
  <path d="M32 6
           C33 10 36 14 41 16
           C45 18 48 18 52 17
           C51 21 48 23 48 27
           C48 31 51 33 52 36
           C54 40 52 45 49 49
           C45 54 40 56 35 56
           C34 56 33 57 32 60
           C31 57 30 56 29 56
           C24 56 19 54 15 49
           C12 45 10 40 12 36
           C13 33 16 31 16 27
           C16 23 13 21 12 17
           C16 18 19 18 23 16
           C28 14 31 10 32 6 Z"
        fill="url(#ms_g)" stroke="#3d1414" stroke-width="1.25" stroke-linejoin="round"/>
  <path d="M32 14 L32 56" stroke="rgba(255,255,255,0.34)" stroke-width="1.1" stroke-linecap="round"/>
  <path d="M32 22 C26 22 22 19 18 16" stroke="rgba(255,255,255,0.22)" stroke-width="0.9" fill="none" stroke-linecap="round"/>
  <path d="M32 28 C27 29 24 26 20 24" stroke="rgba(255,255,255,0.18)" stroke-width="0.85" fill="none" stroke-linecap="round"/>
  <path d="M32 22 C38 22 42 19 46 16" stroke="rgba(255,255,255,0.22)" stroke-width="0.9" fill="none" stroke-linecap="round"/>
  <path d="M32 28 C37 29 40 26 44 24" stroke="rgba(255,255,255,0.18)" stroke-width="0.85" fill="none" stroke-linecap="round"/>
  <g stroke="rgba(255,255,255,0.12)" stroke-width="0.55" fill="none" stroke-linecap="round">
    <path d="M32 18 C28 18 25 16.5 22 14.8"/>
    <path d="M32 20.5 C29 21 27 19.6 24.5 18.4"/>
    <path d="M32 24.5 C29 25.2 27 23.8 24.2 22.8"/>
    <path d="M32 31.5 C29 32.2 27 30.8 24 29.6"/>
    <path d="M32 36.5 C29.5 37.4 27.8 36.2 25.2 35.2"/>
    <path d="M32 18 C36 18 39 16.5 42 14.8"/>
    <path d="M32 20.5 C35 21 37 19.6 39.5 18.4"/>
    <path d="M32 24.5 C35 25.2 37 23.8 39.8 22.8"/>
    <path d="M32 31.5 C35 32.2 37 30.8 40 29.6"/>
    <path d="M32 36.5 C34.5 37.4 36.2 36.2 38.8 35.2"/>
  </g>
  <path d="M32 56 C33 53 34 50 36 47" stroke="rgba(61,20,20,0.75)" stroke-width="1.6" stroke-linecap="round"/>
  <path d="M32 58 C31 60 30 62 29 63" stroke="#2b120f" stroke-width="1.6" stroke-linecap="round"/>
  <g filter="url(#ms_tex)" opacity="0.18">
    <path d="M32 6
             C33 10 36 14 41 16
             C45 18 48 18 52 17
             C51 21 48 23 48 27
             C48 31 51 33 52 36
             C54 40 52 45 49 49
             C45 54 40 56 35 56
             C34 56 33 57 32 60
             C31 57 30 56 29 56
             C24 56 19 54 15 49
             C12 45 10 40 12 36
             C13 33 16 31 16 27
             C16 23 13 21 12 17
             C16 18 19 18 23 16
             C28 14 31 10 32 6 Z"
          fill="#ffffff"/>
  </g>
</svg>`),

  mapleAmber:
    svgData(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <defs>
    <linearGradient id="ma_g" x1="12" y1="10" x2="54" y2="56" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#ffd06a"/>
      <stop offset="0.45" stop-color="#e38a2f"/>
      <stop offset="1" stop-color="#7c3a10"/>
    </linearGradient>
  </defs>
  <path d="M32 6
           C33 10 36 14 41 16
           C45 18 48 18 52 17
           C51 21 48 23 48 27
           C48 31 51 33 52 36
           C54 40 52 45 49 49
           C45 54 40 56 35 56
           C34 56 33 57 32 60
           C31 57 30 56 29 56
           C24 56 19 54 15 49
           C12 45 10 40 12 36
           C13 33 16 31 16 27
           C16 23 13 21 12 17
           C16 18 19 18 23 16
           C28 14 31 10 32 6 Z"
        fill="rgba(0,0,0,0.11)" transform="translate(1.1 1.7)"/>
  <path d="M32 6
           C33 12 36 15 41 18
           C46 21 51 19 56 20
           C53 24 49 26 49 31
           C49 36 53 38 52 44
           C50 53 41 57 35 57
           C33 57 33 58 32 60
           C31 58 31 57 29 57
           C23 57 14 53 12 44
           C11 38 15 36 15 31
           C15 26 11 24 8 20
           C13 19 18 21 23 18
           C28 15 31 12 32 6 Z"
        fill="url(#ma_g)" stroke="#4a230e" stroke-width="1.15" stroke-linejoin="round"/>
  <path d="M32 12 L32 56" stroke="rgba(255,255,255,0.35)" stroke-width="1.0" stroke-linecap="round"/>
  <path d="M32 24 C26 24 22 20 18 18" stroke="rgba(255,255,255,0.2)" stroke-width="0.8" fill="none" stroke-linecap="round"/>
  <path d="M32 28 C27 29 24 26 20 25" stroke="rgba(255,255,255,0.18)" stroke-width="0.7" fill="none" stroke-linecap="round"/>
  <path d="M32 24 C38 24 42 20 46 18" stroke="rgba(255,255,255,0.2)" stroke-width="0.8" fill="none" stroke-linecap="round"/>
  <path d="M32 28 C37 29 40 26 44 25" stroke="rgba(255,255,255,0.18)" stroke-width="0.7" fill="none" stroke-linecap="round"/>
  <g stroke="rgba(255,255,255,0.11)" stroke-width="0.55" fill="none" stroke-linecap="round">
    <path d="M32 19 C28 19 25 17.6 22 16"/>
    <path d="M32 21.5 C29.2 22 27.1 20.8 24.6 19.7"/>
    <path d="M32 25.5 C29.2 26.2 27 25.1 24.2 24.0"/>
    <path d="M32 32 C29.3 32.8 27.3 31.6 24.1 30.4"/>
    <path d="M32 37 C29.6 37.9 27.9 36.8 25.2 35.8"/>
    <path d="M32 19 C36 19 39 17.6 42 16"/>
    <path d="M32 21.5 C34.8 22 36.9 20.8 39.4 19.7"/>
    <path d="M32 25.5 C34.8 26.2 37 25.1 39.8 24.0"/>
    <path d="M32 32 C34.7 32.8 36.7 31.6 39.9 30.4"/>
    <path d="M32 37 C34.4 37.9 36.1 36.8 38.8 35.8"/>
  </g>
  <path d="M32 55 C33 53 34 51 36 48" stroke="#6b3a16" stroke-width="1.4" stroke-linecap="round"/>
  <path d="M32 58 C31 60 30 62 29 63" stroke="#3a1b10" stroke-width="1.55" stroke-linecap="round"/>
</svg>`),

  mapleCrimson:
    svgData(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <defs>
    <linearGradient id="mc_g" x1="12" y1="10" x2="56" y2="56" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#ff9a5a"/>
      <stop offset="0.35" stop-color="#e14a2c"/>
      <stop offset="1" stop-color="#5b1419"/>
    </linearGradient>
  </defs>
  <path d="M32 7
           C33 11 36 14 41 16
           C46 18 49 18 54 17
           C52 21 49 23 49 27
           C49 31 52 33 53 37
           C55 42 52 47 48 51
           C44 55 40 57 35 57
           C34 57 33 58 32 60
           C31 58 30 57 29 57
           C24 57 20 55 16 51
           C12 47 9 42 11 37
           C12 33 15 31 15 27
           C15 23 12 21 10 17
           C15 18 18 18 23 16
           C28 14 31 11 32 7 Z"
        fill="rgba(0,0,0,0.12)" transform="translate(1.2 1.8)"/>
  <path d="M32 7
           C33 11 36 14 41 16
           C46 18 49 18 54 17
           C52 21 49 23 49 27
           C49 31 52 33 53 37
           C55 42 52 47 48 51
           C44 55 40 57 35 57
           C34 57 33 58 32 60
           C31 58 30 57 29 57
           C24 57 20 55 16 51
           C12 47 9 42 11 37
           C12 33 15 31 15 27
           C15 23 12 21 10 17
           C15 18 18 18 23 16
           C28 14 31 11 32 7 Z"
        fill="url(#mc_g)" stroke="#3a1014" stroke-width="1.25" stroke-linejoin="round"/>
  <path d="M32 14 L32 56" stroke="rgba(255,255,255,0.3)" stroke-width="1.05" stroke-linecap="round"/>
  <path d="M32 22 C26 22 22 19 18 16" stroke="rgba(255,255,255,0.18)" stroke-width="0.85" fill="none" stroke-linecap="round"/>
  <path d="M32 28 C27 29 24 26 20 24" stroke="rgba(255,255,255,0.16)" stroke-width="0.8" fill="none" stroke-linecap="round"/>
  <path d="M32 22 C38 22 42 19 46 16" stroke="rgba(255,255,255,0.18)" stroke-width="0.85" fill="none" stroke-linecap="round"/>
  <path d="M32 28 C37 29 40 26 44 24" stroke="rgba(255,255,255,0.16)" stroke-width="0.8" fill="none" stroke-linecap="round"/>
  <g stroke="rgba(255,255,255,0.11)" stroke-width="0.55" fill="none" stroke-linecap="round">
    <path d="M32 18 C28 18 25 16.6 22 15.1"/>
    <path d="M32 20.5 C29.2 21 27.2 19.7 24.6 18.6"/>
    <path d="M32 24.5 C29.2 25.2 27 24.0 24.2 23.0"/>
    <path d="M32 31.5 C29.3 32.2 27.3 31.0 24.1 29.8"/>
    <path d="M32 36.5 C29.6 37.4 27.9 36.2 25.2 35.2"/>
    <path d="M32 18 C36 18 39 16.6 42 15.1"/>
    <path d="M32 20.5 C34.8 21 36.8 19.7 39.4 18.6"/>
    <path d="M32 24.5 C34.8 25.2 37 24.0 39.8 23.0"/>
    <path d="M32 31.5 C34.7 32.2 36.7 31.0 39.9 29.8"/>
    <path d="M32 36.5 C34.4 37.4 36.1 36.2 38.8 35.2"/>
  </g>
  <path d="M32 56 C33 53 34 50 36 47" stroke="rgba(58,16,20,0.75)" stroke-width="1.55" stroke-linecap="round"/>
  <path d="M32 58 C31 60 30 62 29 63" stroke="#2b0e11" stroke-width="1.55" stroke-linecap="round"/>
</svg>`),

  mapleTorn:
    svgData(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <defs>
    <linearGradient id="mt_g" x1="12" y1="10" x2="56" y2="56" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#ff8a4a"/>
      <stop offset="0.4" stop-color="#de3d2a"/>
      <stop offset="1" stop-color="#63161a"/>
    </linearGradient>
  </defs>
  <path d="M32 7
           C33 11 36 14 41 16
           C46 18 49 18 54 17
           C52 21 49 23 49 27
           C49 31 52 33 53 37
           C55 42 52 47 48 51
           C44 55 40 57 35 57
           C34 57 33 58 32 60
           C31 58 30 57 29 57
           C24 57 20 55 16 51
           C12 47 9 42 11 37
           C12 33 15 31 15 27
           C15 23 12 21 10 17
           C15 18 18 18 23 16
           C28 14 31 11 32 7 Z"
        fill="rgba(0,0,0,0.12)" transform="translate(1.1 1.7)"/>
  <path fill-rule="evenodd" d="M32 7
           C33 11 36 14 41 16
           C46 18 49 18 54 17
           C52 21 49 23 49 27
           C49 31 52 33 53 37
           C55 42 52 47 48 51
           C44 55 40 57 35 57
           C34 57 33 58 32 60
           C31 58 30 57 29 57
           C24 57 20 55 16 51
           C12 47 9 42 11 37
           C12 33 15 31 15 27
           C15 23 12 21 10 17
           C15 18 18 18 23 16
           C28 14 31 11 32 7 Z
           M48 33
           C45 34 43 36 43 39
           C43 41 45 42 46 42
           C48 42 50 40 50 38
           C50 35 49 34 48 33 Z"
        fill="url(#mt_g)" stroke="#361014" stroke-width="1.25" stroke-linejoin="round"/>
  <path d="M32 14 L32 56" stroke="rgba(255,255,255,0.28)" stroke-width="1.05" stroke-linecap="round"/>
  <path d="M32 22 C26 22 22 19 18 16" stroke="rgba(255,255,255,0.18)" stroke-width="0.85" fill="none" stroke-linecap="round"/>
  <path d="M32 28 C27 29 24 26 20 24" stroke="rgba(255,255,255,0.16)" stroke-width="0.8" fill="none" stroke-linecap="round"/>
  <path d="M32 22 C38 22 42 19 46 16" stroke="rgba(255,255,255,0.18)" stroke-width="0.85" fill="none" stroke-linecap="round"/>
  <path d="M32 28 C37 29 40 26 44 24" stroke="rgba(255,255,255,0.16)" stroke-width="0.8" fill="none" stroke-linecap="round"/>
  <g stroke="rgba(255,255,255,0.1)" stroke-width="0.55" fill="none" stroke-linecap="round">
    <path d="M32 18 C28 18 25 16.6 22 15.1"/>
    <path d="M32 20.5 C29.2 21 27.2 19.7 24.6 18.6"/>
    <path d="M32 24.5 C29.2 25.2 27 24.0 24.2 23.0"/>
    <path d="M32 31.5 C29.3 32.2 27.3 31.0 24.1 29.8"/>
    <path d="M32 36.5 C29.6 37.4 27.9 36.2 25.2 35.2"/>
    <path d="M32 18 C36 18 39 16.6 42 15.1"/>
    <path d="M32 20.5 C34.8 21 36.8 19.7 39.4 18.6"/>
    <path d="M32 24.5 C34.8 25.2 37 24.0 39.8 23.0"/>
    <path d="M32 31.5 C34.7 32.2 36.7 31.0 39.9 29.8"/>
    <path d="M32 36.5 C34.4 37.4 36.1 36.2 38.8 35.2"/>
  </g>
  <path d="M32 56 C33 53 34 50 36 47" stroke="rgba(54,16,20,0.8)" stroke-width="1.55" stroke-linecap="round"/>
  <path d="M32 58 C31 60 30 62 29 63" stroke="#250d10" stroke-width="1.55" stroke-linecap="round"/>
</svg>`),

  oakRust: svgData(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <defs>
    <linearGradient id="or_g" x1="20" y1="8" x2="46" y2="58" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#d07a2c"/>
      <stop offset="0.55" stop-color="#8a4a17"/>
      <stop offset="1" stop-color="#4c2a12"/>
    </linearGradient>
  </defs>
  <path d="M32 6
           C26 9 22 14 22 20
           C18 21 15 24 15 28
           C15 33 18 35 20 36
           C18 38 16 41 16 45
           C16 52 22 56 30 56
           C31 56 31 58 32 60
           C33 58 33 56 34 56
           C42 56 48 52 48 45
           C48 41 46 38 44 36
           C46 35 49 33 49 28
           C49 24 46 21 42 20
           C42 14 38 9 32 6 Z"
        fill="rgba(0,0,0,0.12)" transform="translate(1.1 1.6)"/>
  <path d="M32 6
           C26 9 22 14 22 20
           C18 21 15 24 15 28
           C15 33 18 35 20 36
           C18 38 16 41 16 45
           C16 52 22 56 30 56
           C31 56 31 58 32 60
           C33 58 33 56 34 56
           C42 56 48 52 48 45
           C48 41 46 38 44 36
           C46 35 49 33 49 28
           C49 24 46 21 42 20
           C42 14 38 9 32 6 Z"
        fill="url(#or_g)" stroke="#2a160c" stroke-width="1.15" stroke-linejoin="round"/>
  <path d="M32 10 L32 56" stroke="rgba(255,255,255,0.25)" stroke-width="1.0" stroke-linecap="round"/>
  <path d="M32 22 C26 22 22 20 18 18" stroke="rgba(255,255,255,0.16)" stroke-width="0.7" fill="none" stroke-linecap="round"/>
  <path d="M32 30 C26 30 22 28 18 26" stroke="rgba(255,255,255,0.14)" stroke-width="0.7" fill="none" stroke-linecap="round"/>
  <path d="M32 38 C26 38 22 36 18 35" stroke="rgba(255,255,255,0.12)" stroke-width="0.7" fill="none" stroke-linecap="round"/>
  <path d="M32 22 C38 22 42 20 46 18" stroke="rgba(255,255,255,0.16)" stroke-width="0.7" fill="none" stroke-linecap="round"/>
  <path d="M32 30 C38 30 42 28 46 26" stroke="rgba(255,255,255,0.14)" stroke-width="0.7" fill="none" stroke-linecap="round"/>
  <path d="M32 38 C38 38 42 36 46 35" stroke="rgba(255,255,255,0.12)" stroke-width="0.7" fill="none" stroke-linecap="round"/>
  <g stroke="rgba(255,255,255,0.09)" stroke-width="0.55" fill="none" stroke-linecap="round">
    <path d="M32 18 C27 18 23.5 16.8 20.5 15.2"/>
    <path d="M32 26 C27 26 23.7 24.8 20.5 23.4"/>
    <path d="M32 34 C27 34 23.8 33.0 20.6 31.8"/>
    <path d="M32 42 C27.2 42 24 40.9 21 39.9"/>
    <path d="M32 18 C37 18 40.5 16.8 43.5 15.2"/>
    <path d="M32 26 C37 26 40.3 24.8 43.5 23.4"/>
    <path d="M32 34 C37 34 40.2 33.0 43.4 31.8"/>
    <path d="M32 42 C36.8 42 40 40.9 43 39.9"/>
  </g>
  <path d="M32 56 C33 53 34 50 36 47" stroke="#2f1a0e" stroke-width="1.5" stroke-linecap="round"/>
  <path d="M32 58 C31 60 30 62 29 63" stroke="#23120a" stroke-width="1.55" stroke-linecap="round"/>
</svg>`),

  oakBrown:
    svgData(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <defs>
    <linearGradient id="ob_g" x1="18" y1="10" x2="48" y2="58" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#c79a55"/>
      <stop offset="0.55" stop-color="#7a4e22"/>
      <stop offset="1" stop-color="#3a2412"/>
    </linearGradient>
  </defs>
  <path d="M32 6
           C26 9 22 14 22 20
           C18 21 15 24 15 28
           C15 33 18 35 20 36
           C18 38 16 41 16 45
           C16 52 22 56 30 56
           C31 56 31 58 32 60
           C33 58 33 56 34 56
           C42 56 48 52 48 45
           C48 41 46 38 44 36
           C46 35 49 33 49 28
           C49 24 46 21 42 20
           C42 14 38 9 32 6 Z"
        fill="rgba(0,0,0,0.12)" transform="translate(1.1 1.7)"/>
  <path d="M32 6
           C26 9 22 14 22 20
           C18 21 15 24 15 28
           C15 33 18 35 20 36
           C18 38 16 41 16 45
           C16 52 22 56 30 56
           C31 56 31 58 32 60
           C33 58 33 56 34 56
           C42 56 48 52 48 45
           C48 41 46 38 44 36
           C46 35 49 33 49 28
           C49 24 46 21 42 20
           C42 14 38 9 32 6 Z"
        fill="url(#ob_g)" stroke="#24170c" stroke-width="1.15" stroke-linejoin="round"/>
  <path d="M32 10 L32 56" stroke="rgba(255,255,255,0.18)" stroke-width="1.0" stroke-linecap="round"/>
  <path d="M32 22 C26 22 22 20 18 18" stroke="rgba(255,255,255,0.12)" stroke-width="0.75" fill="none" stroke-linecap="round"/>
  <path d="M32 30 C26 30 22 28 18 26" stroke="rgba(255,255,255,0.1)" stroke-width="0.75" fill="none" stroke-linecap="round"/>
  <path d="M32 38 C26 38 22 36 18 35" stroke="rgba(255,255,255,0.08)" stroke-width="0.75" fill="none" stroke-linecap="round"/>
  <path d="M32 22 C38 22 42 20 46 18" stroke="rgba(255,255,255,0.12)" stroke-width="0.75" fill="none" stroke-linecap="round"/>
  <path d="M32 30 C38 30 42 28 46 26" stroke="rgba(255,255,255,0.1)" stroke-width="0.75" fill="none" stroke-linecap="round"/>
  <path d="M32 38 C38 38 42 36 46 35" stroke="rgba(255,255,255,0.08)" stroke-width="0.75" fill="none" stroke-linecap="round"/>
  <g stroke="rgba(255,255,255,0.08)" stroke-width="0.55" fill="none" stroke-linecap="round">
    <path d="M32 18 C27 18 23.5 16.8 20.5 15.2"/>
    <path d="M32 26 C27 26 23.7 24.8 20.5 23.4"/>
    <path d="M32 34 C27 34 23.8 33.0 20.6 31.8"/>
    <path d="M32 42 C27.2 42 24 40.9 21 39.9"/>
    <path d="M32 18 C37 18 40.5 16.8 43.5 15.2"/>
    <path d="M32 26 C37 26 40.3 24.8 43.5 23.4"/>
    <path d="M32 34 C37 34 40.2 33.0 43.4 31.8"/>
    <path d="M32 42 C36.8 42 40 40.9 43 39.9"/>
  </g>
  <path d="M32 56 C33 53 34 50 36 47" stroke="#1e130a" stroke-width="1.5" stroke-linecap="round"/>
  <path d="M32 58 C31 60 30 62 29 63" stroke="#191008" stroke-width="1.55" stroke-linecap="round"/>
</svg>`),

  oakHoles:
    svgData(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <defs>
    <linearGradient id="oh_g" x1="18" y1="10" x2="50" y2="58" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#d9a85a"/>
      <stop offset="0.55" stop-color="#7a4c22"/>
      <stop offset="1" stop-color="#2e1c0f"/>
    </linearGradient>
  </defs>
  <path d="M32 6
           C26 9 22 14 22 20
           C18 21 15 24 15 28
           C15 33 18 35 20 36
           C18 38 16 41 16 45
           C16 52 22 56 30 56
           C31 56 31 58 32 60
           C33 58 33 56 34 56
           C42 56 48 52 48 45
           C48 41 46 38 44 36
           C46 35 49 33 49 28
           C49 24 46 21 42 20
           C42 14 38 9 32 6 Z"
        fill="rgba(0,0,0,0.12)" transform="translate(1.1 1.7)"/>
  <path fill-rule="evenodd" d="M32 6
           C26 9 22 14 22 20
           C18 21 15 24 15 28
           C15 33 18 35 20 36
           C18 38 16 41 16 45
           C16 52 22 56 30 56
           C31 56 31 58 32 60
           C33 58 33 56 34 56
           C42 56 48 52 48 45
           C48 41 46 38 44 36
           C46 35 49 33 49 28
           C49 24 46 21 42 20
           C42 14 38 9 32 6 Z
           M25 28
           C23 28 21.5 29.8 21.5 31.8
           C21.5 33.8 23.1 35.2 24.8 35.2
           C26.8 35.2 28.3 33.7 28.3 31.7
           C28.3 29.7 27.1 28 25 28 Z
           M41.5 30
           C39.7 30 38.2 31.6 38.2 33.3
           C38.2 35.3 39.8 36.6 41.4 36.6
           C43.4 36.6 45 35.1 45 33.2
           C45 31.3 43.4 30 41.5 30 Z
           M33 40
           C31.2 40 29.8 41.4 29.8 43.0
           C29.8 44.9 31.3 46.2 33.0 46.2
           C34.9 46.2 36.4 44.8 36.4 43.0
           C36.4 41.2 34.9 40 33 40 Z"
        fill="url(#oh_g)" stroke="#1e130a" stroke-width="1.15" stroke-linejoin="round"/>
  <path d="M32 10 L32 56" stroke="rgba(255,255,255,0.16)" stroke-width="1.0" stroke-linecap="round"/>
  <path d="M32 30 C26 30 22 28 18 26" stroke="rgba(255,255,255,0.1)" stroke-width="0.75" fill="none" stroke-linecap="round"/>
  <path d="M32 30 C38 30 42 28 46 26" stroke="rgba(255,255,255,0.1)" stroke-width="0.75" fill="none" stroke-linecap="round"/>
  <g stroke="rgba(255,255,255,0.08)" stroke-width="0.55" fill="none" stroke-linecap="round">
    <path d="M32 20 C27 20 23.6 18.8 20.8 17.4"/>
    <path d="M32 24.5 C27 24.8 23.9 23.9 21.2 22.7"/>
    <path d="M32 34 C27 34 24.2 33.0 21.4 32.0"/>
    <path d="M32 38.5 C27.2 38.8 24.3 37.9 21.6 37.0"/>
    <path d="M32 20 C37 20 40.4 18.8 43.2 17.4"/>
    <path d="M32 24.5 C37 24.8 40.1 23.9 42.8 22.7"/>
    <path d="M32 34 C37 34 39.8 33.0 42.6 32.0"/>
    <path d="M32 38.5 C36.8 38.8 39.7 37.9 42.4 37.0"/>
  </g>
  <path d="M32 56 C33 53 34 50 36 47" stroke="#1a1109" stroke-width="1.5" stroke-linecap="round"/>
  <path d="M32 58 C31 60 30 62 29 63" stroke="#150e08" stroke-width="1.55" stroke-linecap="round"/>
</svg>`),

  birchYellow:
    svgData(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <defs>
    <linearGradient id="by_g" x1="18" y1="10" x2="48" y2="54" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#ffe38a"/>
      <stop offset="0.5" stop-color="#d9b13a"/>
      <stop offset="1" stop-color="#7b5a1a"/>
    </linearGradient>
  </defs>
  <path d="M34 8
           C26 10 20 18 20 28
           C20 40 28 50 34 56
           C36 58 36 60 32 60
           C28 60 28 58 30 56
           C36 50 44 40 44 28
           C44 18 38 10 34 8 Z"
        fill="rgba(0,0,0,0.11)" transform="translate(1.1 1.6)"/>
  <path d="M34 8
           C26 10 20 18 20 28
           C20 40 28 50 34 56
           C36 58 36 60 32 60
           C28 60 28 58 30 56
           C36 50 44 40 44 28
           C44 18 38 10 34 8 Z"
        fill="url(#by_g)" stroke="#5a4111" stroke-width="1.15" stroke-linejoin="round"/>
  <path d="M32 14 L32 56" stroke="rgba(255,255,255,0.28)" stroke-width="1.0" stroke-linecap="round"/>
  <path d="M32 22 C28 22 25 20 22 18" stroke="rgba(255,255,255,0.16)" stroke-width="0.7" fill="none" stroke-linecap="round"/>
  <path d="M32 28 C28 29 25 27 22 25" stroke="rgba(255,255,255,0.14)" stroke-width="0.7" fill="none" stroke-linecap="round"/>
  <path d="M32 34 C28 35 25 33 22 31" stroke="rgba(255,255,255,0.12)" stroke-width="0.7" fill="none" stroke-linecap="round"/>
  <path d="M32 22 C36 22 39 20 42 18" stroke="rgba(255,255,255,0.16)" stroke-width="0.7" fill="none" stroke-linecap="round"/>
  <path d="M32 28 C36 29 39 27 42 25" stroke="rgba(255,255,255,0.14)" stroke-width="0.7" fill="none" stroke-linecap="round"/>
  <path d="M32 34 C36 35 39 33 42 31" stroke="rgba(255,255,255,0.12)" stroke-width="0.7" fill="none" stroke-linecap="round"/>
  <g stroke="rgba(255,255,255,0.1)" stroke-width="0.55" fill="none" stroke-linecap="round">
    <path d="M32 18.5 C29.5 18.6 27.5 17.6 25 16.4"/>
    <path d="M32 25.5 C29.5 25.8 27.6 24.9 25 23.8"/>
    <path d="M32 31.5 C29.6 31.9 27.9 31.0 25.6 30.0"/>
    <path d="M32 38.5 C29.8 39.2 28.2 38.5 26.1 37.7"/>
    <path d="M32 18.5 C34.5 18.6 36.5 17.6 39 16.4"/>
    <path d="M32 25.5 C34.5 25.8 36.4 24.9 39 23.8"/>
    <path d="M32 31.5 C34.4 31.9 36.1 31.0 38.4 30.0"/>
    <path d="M32 38.5 C34.2 39.2 35.8 38.5 37.9 37.7"/>
  </g>
  <path d="M32 56 C33 53 34 50 36 47" stroke="#6a4d14" stroke-width="1.4" stroke-linecap="round"/>
  <path d="M32 58 C31 60 30 62 29 63" stroke="#4b3510" stroke-width="1.5" stroke-linecap="round"/>
</svg>`),

  aspenGold:
    svgData(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <defs>
    <linearGradient id="ag_g" x1="20" y1="10" x2="50" y2="56" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#fff1a3"/>
      <stop offset="0.55" stop-color="#e0be3d"/>
      <stop offset="1" stop-color="#8a6a18"/>
    </linearGradient>
  </defs>
  <path d="M32 10
           C24 12 18 20 18 30
           C18 44 28 54 32 58
           C36 54 46 44 46 30
           C46 20 40 12 32 10 Z"
        fill="rgba(0,0,0,0.11)" transform="translate(1.1 1.6)"/>
  <path d="M32 10
           C24 12 18 20 18 30
           C18 44 28 54 32 58
           C36 54 46 44 46 30
           C46 20 40 12 32 10 Z"
        fill="url(#ag_g)" stroke="#6b5312" stroke-width="1.1" stroke-linejoin="round"/>
  <path d="M32 16 L32 56" stroke="rgba(255,255,255,0.26)" stroke-width="1.0" stroke-linecap="round"/>
  <path d="M32 26 C27 26 24 24 21 22" stroke="rgba(255,255,255,0.14)" stroke-width="0.75" fill="none" stroke-linecap="round"/>
  <path d="M32 32 C27 33 24 31 21 29" stroke="rgba(255,255,255,0.12)" stroke-width="0.75" fill="none" stroke-linecap="round"/>
  <path d="M32 26 C37 26 40 24 43 22" stroke="rgba(255,255,255,0.14)" stroke-width="0.75" fill="none" stroke-linecap="round"/>
  <path d="M32 32 C37 33 40 31 43 29" stroke="rgba(255,255,255,0.12)" stroke-width="0.75" fill="none" stroke-linecap="round"/>
  <g stroke="rgba(255,255,255,0.1)" stroke-width="0.55" fill="none" stroke-linecap="round">
    <path d="M32 22 C28.5 22 26 20.8 23.6 19.6"/>
    <path d="M32 28.5 C28.5 29 26.2 28.0 23.8 26.9"/>
    <path d="M32 36 C28.8 36.8 26.6 35.8 24.1 34.8"/>
    <path d="M32 22 C35.5 22 38 20.8 40.4 19.6"/>
    <path d="M32 28.5 C35.5 29 37.8 28.0 40.2 26.9"/>
    <path d="M32 36 C35.2 36.8 37.4 35.8 39.9 34.8"/>
  </g>
  <path d="M32 56 C33 53 34 50 35 48" stroke="#6b5312" stroke-width="1.4" stroke-linecap="round"/>
  <path d="M32 58 C31 60 30 62 29 63" stroke="#4a3a10" stroke-width="1.5" stroke-linecap="round"/>
</svg>`),

  beechCopper:
    svgData(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <defs>
    <linearGradient id="bc_g" x1="16" y1="14" x2="52" y2="52" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#ffb06a"/>
      <stop offset="0.55" stop-color="#b5642f"/>
      <stop offset="1" stop-color="#5a2b15"/>
    </linearGradient>
  </defs>
  <path d="M32 8
           C22 14 18 26 20 36
           C22 46 28 54 32 58
           C36 54 42 46 44 36
           C46 26 42 14 32 8 Z"
        fill="rgba(0,0,0,0.12)" transform="translate(1.1 1.6)"/>
  <path d="M32 8
           C22 14 18 26 20 36
           C22 46 28 54 32 58
           C36 54 42 46 44 36
           C46 26 42 14 32 8 Z"
        fill="url(#bc_g)" stroke="#2f160c" stroke-width="1.15" stroke-linejoin="round"/>
  <path d="M32 14 L32 56" stroke="rgba(255,255,255,0.22)" stroke-width="0.9" stroke-linecap="round"/>
  <path d="M32 24 C26 24 23 22 20 20" stroke="rgba(255,255,255,0.14)" stroke-width="0.7" fill="none" stroke-linecap="round"/>
  <path d="M32 30 C26 31 23 29 20 27" stroke="rgba(255,255,255,0.12)" stroke-width="0.7" fill="none" stroke-linecap="round"/>
  <path d="M32 24 C38 24 41 22 44 20" stroke="rgba(255,255,255,0.14)" stroke-width="0.7" fill="none" stroke-linecap="round"/>
  <path d="M32 30 C38 31 41 29 44 27" stroke="rgba(255,255,255,0.12)" stroke-width="0.7" fill="none" stroke-linecap="round"/>
  <g stroke="rgba(255,255,255,0.1)" stroke-width="0.55" fill="none" stroke-linecap="round">
    <path d="M32 20 C28 20 25.6 18.9 23.1 17.7"/>
    <path d="M32 26.5 C28 27 25.7 26.1 23.3 25.0"/>
    <path d="M32 34 C28.2 34.8 26.2 33.8 23.8 32.8"/>
    <path d="M32 20 C36 20 38.4 18.9 40.9 17.7"/>
    <path d="M32 26.5 C36 27 38.3 26.1 40.7 25.0"/>
    <path d="M32 34 C35.8 34.8 37.8 33.8 40.2 32.8"/>
  </g>
  <path d="M32 56 C33 53 34 50 35 48" stroke="#3a1b10" stroke-width="1.4" stroke-linecap="round"/>
  <path d="M32 58 C31 60 30 62 29 63" stroke="#221009" stroke-width="1.5" stroke-linecap="round"/>
</svg>`),
};

const WINTER_COLORS = ['#FFFFFF', '#F0F8FF', '#E6E6FA', '#F5F5F5'];

// ========================================
// Helper Functions
// ========================================

const loadImage = (src: string): Promise<HTMLImageElement> => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
};

// ========================================
// Component
// ========================================

const PhysicsSnow: React.FC<PhysicsSnowProps> = ({
  mode,
  count = 100,
  posterBounds,
  posterElements,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const particlesRef = useRef<PhysicsParticle[]>([]);
  const texturesRef = useRef<Map<string, HTMLImageElement>>(new Map());
  const rafRef = useRef<number>(0);
  const lastTimeRef = useRef<number>(0);
  const lastScrollRef = useRef<number>(0);
  const shakeDebounceRef = useRef<number>(0);
  const posterBoundsRef = useRef(posterBounds);
  const posterElementsRef = useRef(posterElements);
  const windPhaseRef = useRef<number>(0);
  // pilesRef removed for organic physics

  useEffect(() => {
    posterBoundsRef.current = posterBounds;
    posterElementsRef.current = posterElements;
  }, [posterBounds, posterElements]);

  const [mounted, setMounted] = useState(false);
  const [texturesLoaded, setTexturesLoaded] = useState(false);

  const textureUrls = useMemo(() => {
    if (mode === 'spring') return Object.values(SPRING_TEXTURES);
    if (mode === 'autumn') return Object.values(AUTUMN_TEXTURES);
    return []; // Winter uses colors, no textures needed
  }, [mode]);

  // Load textures before rendering particles
  useEffect(() => {
    setMounted(true);
    setTexturesLoaded(false); // Reset to prevent stale renders

    // Winter mode doesn't need textures
    if (mode === 'winter') {
      setTexturesLoaded(true);
      return;
    }

    const loadTextures = async () => {
      const loadPromises = textureUrls.map(async (url) => {
        if (!texturesRef.current.has(url)) {
          try {
            const img = await loadImage(url);
            texturesRef.current.set(url, img);
          } catch (e) {
            console.warn('Failed to load texture:', url, e);
          }
        }
      });
      await Promise.all(loadPromises);
      setTexturesLoaded(true);
    };
    loadTextures();
  }, [textureUrls, mode]);

  // Initialize wind phase once to keep render pure
  useEffect(() => {
    windPhaseRef.current = Math.random() * Math.PI * 2;
  }, []);

  const createParticle = useCallback(
    (id: number, w: number): PhysicsParticle => {
      const isWinter = mode === 'winter';
      const textureKeys = textureUrls;
      const textureKey =
        textureKeys.length > 0
          ? textureKeys[Math.floor(Math.random() * textureKeys.length)]
          : '';

      const baseSize = mode === 'winter' ? 5 : mode === 'spring' ? 14 : 18;
      const size = baseSize + Math.random() * baseSize * 0.6;

      const isAutumn = mode === 'autumn';
      // Autumn looks better with less-uniform motion: slightly slower fall, more flutter variety.
      const flutter = isAutumn ? 0.55 + Math.random() * 0.95 : 1;
      const vy0 = isWinter
        ? 15 + Math.random() * 25
        : isAutumn
          ? 8 + Math.random() * 18
          : 15 + Math.random() * 25;
      const vx0 = isWinter
        ? (Math.random() - 0.5) * CONFIG.WIND_BASE
        : isAutumn
          ? (Math.random() - 0.5) * (CONFIG.WIND_BASE * 1.4)
          : (Math.random() - 0.5) * CONFIG.WIND_BASE;

      return {
        id,
        x: Math.random() * w,
        y: -size - Math.random() * 100,
        vx: vx0,
        vy: vy0,
        size,
        rotation: Math.random() * 360,
        rotationSpeed: isAutumn
          ? (Math.random() - 0.5) * (120 + flutter * 60)
          : (Math.random() - 0.5) * 100,
        flutter,
        opacity: 0.7 + Math.random() * 0.3,
        bornAt: Date.now(),
        settled: false,
        settledAt: 0,
        texture: texturesRef.current.get(textureKey) || null,
        textureKey: textureKey,
        color: isWinter
          ? WINTER_COLORS[Math.floor(Math.random() * WINTER_COLORS.length)]
          : '',
        parentBoundsTop: 0,
        parentBoundsHeight: 0,
        posterKey: null,
        relativeY: 0,
        swayOffset: Math.random() * Math.PI * 2,
        z: Math.random(), // Depth for parallax
        passThrough: isAutumn ? Math.random() < 0.4 : Math.random() < 0.5,
      };
    },
    [mode, textureUrls],
  );

  useEffect(() => {
    if (!mounted || !texturesLoaded) return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    const w = window.innerWidth;
    particlesRef.current = [];
    // pilesRef removed
    for (let i = 0; i < count; i++) {
      const p = createParticle(i, w);
      p.y = Math.random() * window.innerHeight * 1.5 - window.innerHeight * 0.5;
      particlesRef.current.push(p);
    }
  }, [mounted, texturesLoaded, count, createParticle]);

  // Scroll handler for inertia calculation
  useEffect(() => {
    const handleScroll = () => {
      const now = Date.now();
      const scrollY = window.scrollY;
      const dt = now - shakeDebounceRef.current;

      // Calculate velocity for shaking effect
      if (dt > 16) {
        // Approx 60fps sample rate limit
        const dy = Math.abs(scrollY - lastScrollRef.current);
        // If scroll speed is high enough, shake off settled particles
        if (dy > CONFIG.SHAKE_THRESHOLD) {
          for (const p of particlesRef.current) {
            if (p.settled) {
              p.settled = false;
              p.vy = 20 + Math.random() * 50; // Initial fall velocity
              p.vx = (Math.random() - 0.5) * 60; // Random horizontal scatter
              p.rotationSpeed = (Math.random() - 0.5) * 300;
            }
          }
          // No piles to clear
        }
        lastScrollRef.current = scrollY;
        shakeDebounceRef.current = now;
      }
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  // Animation loop with realistic stacking
  useEffect(() => {
    if (!mounted) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let active = true;

    const loop = (now: number) => {
      if (!active) return;

      const dt = Math.min((now - lastTimeRef.current) / 1000, 0.1);
      lastTimeRef.current = now;

      if (document.hidden) {
        rafRef.current = requestAnimationFrame(loop);
        return;
      }

      const w = window.innerWidth;
      const h = window.innerHeight;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      windPhaseRef.current += dt * 0.5; // slow, smooth gust cycle

      const targetW = Math.max(1, Math.round(w * dpr));
      const targetH = Math.max(1, Math.round(h * dpr));
      if (canvas.width !== targetW || canvas.height !== targetH) {
        canvas.width = targetW;
        canvas.height = targetH;
        canvas.style.width = `${w}px`;
        canvas.style.height = `${h}px`;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      }

      ctx.clearRect(0, 0, w, h);

      const particles = particlesRef.current;
      const nowMs = Date.now();
      let settledCount = 0;

      // Sort by Y for proper layering
      particles.sort((a, b) => a.y - b.y);

      // REAL-TIME BOUNDS SYNC (Rely on props/provider to avoid layout thrashing)
      const activeBounds: PosterBounds[] = [];
      const currentPosterBounds = posterBoundsRef.current;

      if (currentPosterBounds && Array.isArray(currentPosterBounds)) {
        activeBounds.push(...currentPosterBounds);
      }

      // Build a fast lookup map for stable-keyed bounds and a per-poster settled list.
      const boundsByKey = new Map<string, PosterBounds>();
      for (const b of activeBounds) {
        if (b.key) boundsByKey.set(b.key, b);
      }
      const settledByPoster = new Map<string | null, PhysicsParticle[]>();
      const allSettled: PhysicsParticle[] = [];
      for (const p of particles) {
        if (!p.settled) continue;
        const k = p.posterKey ?? null;
        const arr = settledByPoster.get(k);
        if (arr) arr.push(p);
        else settledByPoster.set(k, [p]);
        allSettled.push(p);
      }

      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];

        if (p.settled) {
          settledCount++;
          const elapsed = nowMs - p.settledAt;

          // Sync with poster using STABLE KEY
          if (p.posterKey) {
            const b = boundsByKey.get(p.posterKey);
            if (b) {
              // If the poster shifted noticeably, shake the particle loose
              const deltaTop = Math.abs(b.top - p.parentBoundsTop);
              if (deltaTop > 4) {
                p.settled = false;
                p.vy = 25 + Math.random() * 50;
                p.vx = (Math.random() - 0.5) * 90;
                p.rotationSpeed = (Math.random() - 0.5) * 360;
                p.posterKey = null;
                p.relativeY = 0;
                continue;
              }

              // Re-anchor to current bounds; adjust for resize drift
              if (p.parentBoundsHeight && b.height !== p.parentBoundsHeight) {
                const scale = b.height / p.parentBoundsHeight;
                p.relativeY *= scale;
                p.parentBoundsHeight = b.height;
              }
              p.parentBoundsTop = b.top;
              p.y = b.top + p.relativeY;
            } else {
              // Poster left viewport: drop the particle
              p.settled = false;
              p.vy = 30 + Math.random() * 60;
              p.vx = (Math.random() - 0.5) * 80;
              p.rotationSpeed = (Math.random() - 0.5) * 300;
              p.posterKey = null;
              p.relativeY = 0;
              continue;
            }
          }

          // Fade and remove after timeout
          if (elapsed > CONFIG.SETTLED_TIMEOUT_MS) {
            p.opacity -= dt * 1.5;
            if (p.opacity <= 0) {
              particles.splice(i, 1);
              continue;
            }
          } else if (
            elapsed >
            CONFIG.SETTLED_TIMEOUT_MS - CONFIG.SETTLED_FADE_MS
          ) {
            const fadeProgress =
              (elapsed - (CONFIG.SETTLED_TIMEOUT_MS - CONFIG.SETTLED_FADE_MS)) /
              CONFIG.SETTLED_FADE_MS;
            p.opacity = Math.max(0, 1 - fadeProgress) * 0.85;
          }

          // Micro-settling animation (slight sink)
          if (p.vy > 0.05) {
            p.vy *= 0.85;
            p.y += p.vy * dt;
          }
        } else {
          // Physics: Gravity + Wind + Sway
          const zF = 0.5 + p.z * 1.5; // Scale speed/sway by depth
          const timeSec = now / 1000;
          const isAutumn = mode === 'autumn';

          // FIX 4: Apply gravity every frame
          // Autumn leaves fall a bit slower but flutter more.
          const gravityF = isAutumn ? 0.82 : 1;
          p.vy += CONFIG.GRAVITY * gravityF * dt * zF;

          // FIX 1: Correct wind/sway integration (velocity-based)
          const flutter = isAutumn ? p.flutter : 1;
          const gust =
            Math.sin(windPhaseRef.current) * CONFIG.WIND_VARIANCE * 0.9 +
            Math.sin(timeSec * 0.35 + p.swayOffset) *
              CONFIG.WIND_VARIANCE *
              0.4;
          const windVel =
            (CONFIG.WIND_BASE + gust) * zF * (isAutumn ? 1.05 : 1);
          const swayVel =
            Math.sin(timeSec * (isAutumn ? 2.8 : 2) + p.swayOffset) *
            p.size *
            (isAutumn ? 0.75 : 0.5) *
            zF *
            flutter;

          p.x += (p.vx + windVel + swayVel) * dt;
          p.y += p.vy * dt; // Simple Euler
          const wobbleVel = isAutumn
            ? Math.sin(timeSec * 3.6 + p.swayOffset) * 14 * flutter * zF
            : 0;
          p.rotation += (p.rotationSpeed + wobbleVel) * dt;

          // Wrap horizontally
          if (p.x < -p.size) p.x = w + p.size;
          if (p.x > w + p.size) p.x = -p.size;

          // Collision with registered posters (Organic)
          // FIX: Depth-based culling. Background particles (z < 0.35) fall BEHIND posters.
          if (activeBounds.length > 0 && p.z >= 0.35) {
            for (let i = 0; i < activeBounds.length; i++) {
              const bounds = activeBounds[i];
              // Only check overlap if close vertically (optimization)
              if (p.y > bounds.top - p.size && p.y < bounds.bottom) {
                if (p.passThrough) continue; // 50% fall through first layer for immersion
                const inXRange =
                  p.x >= bounds.left - p.size * 0.2 &&
                  p.x <= bounds.right + p.size * 0.2;

                if (inXRange) {
                  // Check against surface
                  const surfaceY = bounds.top - p.size * 0.4;

                  // Check against other settled particles on this poster
                  let highestY = surfaceY;
                  let stackedOnParticle = false;

                  // FIX 3: Circle-based stacking
                  // FIX 3: Circle-based stacking
                  const settledCandidates =
                    (bounds.key ? settledByPoster.get(bounds.key) : null) ||
                    allSettled;

                  for (const other of settledCandidates) {
                    if (other === p) continue;
                    // Key-based check
                    if (bounds.key && other.posterKey !== bounds.key) continue;

                    const dx = p.x - other.x;
                    const absDx = Math.abs(dx);
                    const r =
                      (p.size + other.size) * 0.5 * CONFIG.STACK_DIST_FACTOR;

                    if (absDx < r) {
                      const dy = Math.sqrt(Math.max(0, r * r - absDx * absDx));
                      const candidateY = other.y - dy; // "touching" from above
                      if (candidateY < highestY) {
                        highestY = candidateY;
                        stackedOnParticle = true;
                      }
                    }
                  }

                  // Collision Response
                  if (p.y >= highestY) {
                    // "Soft" Snap: prevent jumping UP too much in one frame?
                    // But we must resolve penetration.
                    // If the snap is huge > p.size, maybe ignore it (tunneling)?

                    p.y = highestY;
                    p.vy = 0;

                    // Friction & Rotation Alignment
                    p.vx *= CONFIG.FRICTION;
                    p.rotationSpeed *= 0.6; // Heavy damping on impact

                    // Rotate towards horizontal (0 or 180) to "lay flat"
                    // Shortest angular distance logic
                    let r = p.rotation % 360;
                    if (r < 0) r += 360;

                    // Targets: 0, 180, 360
                    let target = 0;
                    if (r > 90 && r < 270) target = 180;
                    if (r >= 270) target = 360;

                    const diff = target - r;
                    p.rotation += diff * CONFIG.ROTATION_ALIGN_SPEED * dt;

                    // Settlement check
                    if (Math.abs(p.vx) < CONFIG.SLIDE_THRESHOLD) {
                      if (settledCount < CONFIG.MAX_SETTLED) {
                        p.settled = true;
                        p.settledAt = nowMs;
                        p.posterKey = bounds.key || null;
                        p.parentBoundsTop = bounds.top;
                        p.parentBoundsHeight = bounds.height;
                        // Store relativeY based on current bounds top
                        p.relativeY = p.y - bounds.top;
                        p.vx = 0;
                        p.rotationSpeed = 0;
                        settledCount++;
                      }
                    }
                  }
                }
              }
            }
          }

          // Reset if off-screen
          if (p.y > h + p.size * 2) Object.assign(p, createParticle(p.id, w));
        }

        // Render with Atmospheric Depth
        ctx.save();
        const depthAlpha = 0.4 + p.z * 0.6; // Distant particles are more transparent
        const fadeIn = p.bornAt > 0 ? Math.min(1, (nowMs - p.bornAt) / 800) : 1;
        ctx.globalAlpha = p.opacity * depthAlpha * fadeIn;

        // Depth-based scale
        const zScale = 0.7 + p.z * 0.6;
        ctx.translate(p.x, p.y);
        ctx.scale(zScale, zScale);
        ctx.rotate((p.rotation * Math.PI) / 180);

        if (p.texture) {
          ctx.drawImage(p.texture, -p.size / 2, -p.size / 2, p.size, p.size);
        } else {
          // Fallback Gradient using Cache
          ctx.fillStyle = getSnowGrad(ctx, p.size);
          ctx.beginPath();
          ctx.arc(0, 0, p.size / 2, 0, Math.PI * 2);
          ctx.fill();

          // Sparkle on settled snow
          if (p.settled && Math.random() < 0.015) {
            ctx.beginPath();
            ctx.arc(
              (Math.random() - 0.5) * p.size * 0.6,
              (Math.random() - 0.5) * p.size * 0.6,
              1.2,
              0,
              Math.PI * 2,
            );
            ctx.fillStyle = 'rgba(255,255,255,1)';
            ctx.fill();
          }
        }

        ctx.restore();
      }

      // Maintain particle count
      while (
        particles.length < count &&
        particles.length < CONFIG.MAX_PARTICLES
      ) {
        particles.push(createParticle(particles.length, w));
      }

      // Removed melt logic as organic physics handles "falling off" naturally

      rafRef.current = requestAnimationFrame(loop);
    };

    lastTimeRef.current = performance.now(); // FIX: Init time to prevent HUGE dt
    rafRef.current = requestAnimationFrame(loop);

    return () => {
      active = false;
      cancelAnimationFrame(rafRef.current);
    };
  }, [mounted, count, createParticle, mode, texturesLoaded]);

  if (!mounted) return null;

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: 'fixed',
        inset: 0,
        pointerEvents: 'none',
        zIndex: 20,
      }}
    />
  );
};

export default React.memo(PhysicsSnow);
