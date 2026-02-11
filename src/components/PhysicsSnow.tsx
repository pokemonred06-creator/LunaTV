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
  flutter: number;
  opacity: number;
  texture: CanvasImageSource | null;
  textureKey: string;
  color: string;
  bornAt: number;
  swayOffset: number;
  z: number;
  passThrough: boolean;
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

export type PhysicsSnowProps = {
  mode: 'winter' | 'spring' | 'autumn';
  count?: number;
  intensity?: 'light' | 'normal' | 'heavy';
};

// ========================================
// Configuration
// ========================================

const CONFIG = {
  GRAVITY: 30,
  WIND_BASE: 15,
  WIND_VARIANCE: 10,
  MAX_PARTICLES: 1000, // Increased from 200
  MAX_SETTLED: 200, // Increased from 60
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
  // 1. Cherry Blossom (Sakura) - Whole Flower
  // Detailed center stamens, soft gradient petals, slight rotation variance
  cherryBlossom:
    svgData(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <defs>
    <radialGradient id="cb_g" cx="50%" cy="50%" r="50%" fx="50%" fy="50%">
      <stop offset="0%" stop-color="#fff0f5"/>
      <stop offset="40%" stop-color="#ffb7c5"/>
      <stop offset="100%" stop-color="#ff9eb5"/>
    </radialGradient>
    <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
      <feGaussianBlur in="SourceAlpha" stdDeviation="1"/>
      <feOffset dx="0.5" dy="0.5" result="offsetblur"/>
      <feComponentTransfer>
        <feFuncA type="linear" slope="0.2"/>
      </feComponentTransfer>
      <feMerge>
        <feMergeNode/>
        <feMergeNode in="SourceGraphic"/>
      </feMerge>
    </filter>
  </defs>
  <g filter="url(#shadow)">
    <!-- Petals -->
    <path d="M32 32 Q32 10 42 14 Q52 18 48 28 Q44 38 32 32" fill="url(#cb_g)" />
    <path d="M32 32 Q54 32 50 42 Q46 52 36 48 Q26 44 32 32" fill="url(#cb_g)" />
    <path d="M32 32 Q32 54 22 50 Q12 46 16 36 Q20 26 32 32" fill="url(#cb_g)" />
    <path d="M32 32 Q10 32 14 22 Q18 12 28 16 Q38 20 32 32" fill="url(#cb_g)" />
    <path d="M32 32 Q20 10 26 8 Q32 6 38 8 Q44 10 32 32" fill="url(#cb_g)" />
    
    <!-- Stamens (Center details) -->
    <circle cx="32" cy="32" r="3" fill="#ffeb3b" />
    <g stroke="#d84315" stroke-width="0.5">
      <line x1="32" y1="32" x2="32" y2="26" />
      <line x1="32" y1="32" x2="36" y2="28" />
      <line x1="32" y1="32" x2="36" y2="34" />
      <line x1="32" y1="32" x2="30" y2="36" />
      <line x1="32" y1="32" x2="26" y2="32" />
    </g>
    <circle cx="32" cy="26" r="0.8" fill="#d84315" />
    <circle cx="36" cy="28" r="0.8" fill="#d84315" />
    <circle cx="36" cy="34" r="0.8" fill="#d84315" />
    <circle cx="30" cy="36" r="0.8" fill="#d84315" />
    <circle cx="26" cy="32" r="0.8" fill="#d84315" />
  </g>
</svg>`),

  // 2. Sakura Petal - Single floating petal
  // Organic curve, gradient tip-to-base, subtle texture
  sakuraPetal:
    svgData(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 48">
  <defs>
    <linearGradient id="sp_g" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#ffb7c5"/>
      <stop offset="100%" stop-color="#fff0f5"/>
    </linearGradient>
  </defs>
  <path d="M16 2 
           C22 6 28 14 26 24
           C24 34 18 44 16 46
           C14 44 8 34 6 24
           C4 14 10 6 16 2 Z" 
        fill="url(#sp_g)" />
  <path d="M16 4 L16 40" stroke="#ff9eb5" stroke-width="0.5" fill="none" opacity="0.6"/>
</svg>`),

  // 3. White Plum - Whole Flower
  // Rounder petals, yellow/green center
  whitePlum:
    svgData(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <defs>
    <radialGradient id="wp_g" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#ffffff"/>
      <stop offset="80%" stop-color="#f0f8ff"/>
      <stop offset="100%" stop-color="#e6e6fa"/>
    </radialGradient>
  </defs>
  <g>
    <!-- 5 Rounded Petals -->
    <path d="M32 32 C32 10 48 10 48 24 C48 30 38 34 32 32" fill="url(#wp_g)"/>
    <path d="M32 32 C48 28 56 40 46 50 C40 54 34 40 32 32" fill="url(#wp_g)"/>
    <path d="M32 32 C36 54 20 60 14 50 C10 44 26 38 32 32" fill="url(#wp_g)"/>
    <path d="M32 32 C10 42 4 28 12 20 C18 16 28 28 32 32" fill="url(#wp_g)"/>
    <path d="M32 32 C16 16 28 4 38 10 C42 14 34 26 32 32" fill="url(#wp_g)"/>
    
    <!-- Center -->
    <circle cx="32" cy="32" r="4" fill="#cddc39" />
    <circle cx="32" cy="32" r="2.5" fill="#fbc02d" />
  </g>
</svg>`),

  // 4. Pink Petal - Varied shape
  petalPink:
    svgData(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 48">
  <defs>
    <linearGradient id="pp_g" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#ffc0cb"/>
      <stop offset="100%" stop-color="#ff69b4"/>
    </linearGradient>
  </defs>
  <path d="M16 4 
           C24 8 28 18 24 30
           C20 40 16 44 16 44
           C16 44 12 40 8 30
           C4 18 8 8 16 4 Z" 
        fill="url(#pp_g)" opacity="0.9"/>
</svg>`),

  // 5. White Petal - Delicate
  petalWhite:
    svgData(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 48">
  <defs>
    <linearGradient id="pw_g" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#ffffff"/>
      <stop offset="100%" stop-color="#f0f8ff"/>
    </linearGradient>
  </defs>
  <path d="M16 2 
           C20 8 24 16 22 28
           C20 38 16 46 16 46
           C16 46 12 38 10 28
           C8 16 12 8 16 2 Z" 
        fill="url(#pw_g)" opacity="0.85"/>
</svg>`),
};

const AUTUMN_TEXTURES = {
  // 1. Maple Leaf - Scarlet (Vibrant Red)
  mapleScarlet:
    svgData(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <defs>
    <linearGradient id="ms_g" x1="10%" y1="10%" x2="90%" y2="90%">
      <stop offset="0%" stop-color="#ff4d4d"/>
      <stop offset="60%" stop-color="#b71c1c"/>
      <stop offset="100%" stop-color="#880e4f"/>
    </linearGradient>
    <filter id="ms_tex" x="0%" y="0%" width="100%" height="100%">
      <feTurbulence type="fractalNoise" baseFrequency="0.8" numOctaves="3" result="noise"/>
      <feColorMatrix type="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 0.15 0"/>
      <feComposite operator="in" in2="SourceGraphic"/>
      <feBlend mode="multiply" in2="SourceGraphic"/>
    </filter>
  </defs>
  <g filter="url(#ms_tex)">
    <path d="M32 4 C34 12 42 16 50 18 C56 20 60 26 56 32 C52 38 46 40 42 42 C44 48 44 54 38 58 C36 60 34 58 32 56 C30 58 28 60 26 58 C20 54 20 48 22 42 C18 40 12 38 8 32 C4 26 8 20 14 18 C22 16 30 12 32 4 Z" fill="url(#ms_g)" stroke="#5d4037" stroke-width="0.5"/>
    <path d="M32 56 L32 10 M32 32 L50 18 M32 32 L14 18 M32 42 L42 42 M32 42 L22 42" stroke="#5d4037" stroke-width="0.8" fill="none"/>
  </g>
</svg>`),

  // 2. Maple Leaf - Amber (Golden Orange)
  mapleAmber:
    svgData(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <defs>
    <linearGradient id="ma_g" x1="20%" y1="0%" x2="80%" y2="100%">
      <stop offset="0%" stop-color="#ffb74d"/>
      <stop offset="50%" stop-color="#fb8c00"/>
      <stop offset="100%" stop-color="#e65100"/>
    </linearGradient>
  </defs>
  <g>
    <path d="M32 4 C34 12 42 16 50 18 C56 20 60 26 56 32 C52 38 46 40 42 42 C44 48 44 54 38 58 C36 60 34 58 32 56 C30 58 28 60 26 58 C20 54 20 48 22 42 C18 40 12 38 8 32 C4 26 8 20 14 18 C22 16 30 12 32 4 Z" fill="url(#ma_g)" stroke="#bf360c" stroke-width="0.5"/>
    <path d="M32 56 L32 8 M32 32 L52 16 M32 32 L12 16 M32 40 L44 40 M32 40 L20 40" stroke="#bf360c" stroke-width="0.6" fill="none"/>
    <circle cx="20" cy="24" r="1.5" fill="#5d4037" opacity="0.4"/>
    <circle cx="48" cy="30" r="1" fill="#5d4037" opacity="0.4"/>
  </g>
</svg>`),

  // 3. Maple Leaf - Crimson (Deep Purple/Red)
  mapleCrimson:
    svgData(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <defs>
    <linearGradient id="mc_g" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#880e4f"/>
      <stop offset="100%" stop-color="#4a148c"/>
    </linearGradient>
  </defs>
  <g>
    <path d="M32 4 C34 12 42 16 50 18 C56 20 60 26 56 32 C52 38 46 40 42 42 C44 48 44 54 38 58 C36 60 34 58 32 56 C30 58 28 60 26 58 C20 54 20 48 22 42 C18 40 12 38 8 32 C4 26 8 20 14 18 C22 16 30 12 32 4 Z" fill="url(#mc_g)" stroke="#3e2723" stroke-width="0.5"/>
    <path d="M32 56 L32 8 M32 30 L54 16 M32 30 L10 16 M32 40 L44 44 M32 40 L20 44" stroke="#ff8a65" stroke-width="0.5" fill="none" opacity="0.5"/>
  </g>
</svg>`),

  // 4. Maple - Torn/Dried (Brownish)
  mapleTorn:
    svgData(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <defs>
    <linearGradient id="mt_g" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#d84315"/>
      <stop offset="100%" stop-color="#4e342e"/>
    </linearGradient>
  </defs>
  <g>
    <path d="M32 6 C34 14 42 18 50 20 C54 22 56 28 52 34 C48 38 44 40 40 42 M38 58 C36 60 34 58 32 56 C30 58 28 60 26 58 C20 54 20 48 22 42 C18 40 12 38 8 32 C4 26 8 20 14 18 C22 16 30 12 32 6" fill="url(#mt_g)" stroke="#3e2723" stroke-width="0.5" fill-opacity="0.9"/>
    <path d="M42 44 L46 48 L44 52 L40 50 Z" fill="#3e2723"/>
    <path d="M32 56 L32 10 M32 32 L50 20 M32 32 L14 18" stroke="#3e2723" stroke-width="0.8" fill="none"/>
  </g>
</svg>`),

  // 5. Oak Leaf - Rust
  oakRust: svgData(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 64">
  <defs>
    <linearGradient id="or_g" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#d7ccc8"/>
      <stop offset="40%" stop-color="#8d6e63"/>
      <stop offset="100%" stop-color="#4e342e"/>
    </linearGradient>
  </defs>
  <path d="M16 4 C20 8 26 12 24 20 C28 24 28 32 24 40 C28 48 24 56 18 60 L14 60 C8 56 4 48 8 40 C4 32 4 24 8 20 C6 12 12 8 16 4 Z" fill="url(#or_g)" stroke="#3e2723" stroke-width="0.5"/>
  <path d="M16 6 L16 58 M16 20 L24 16 M16 20 L8 16 M16 36 L24 32 M16 36 L8 32 M16 50 L22 46 M16 50 L10 46" stroke="#3e2723" stroke-width="0.5" fill="none"/>
</svg>`),

  // 6. Oak Leaf - Brown
  oakBrown:
    svgData(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 64">
  <defs>
    <linearGradient id="ob_g" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#a1887f"/>
      <stop offset="100%" stop-color="#5d4037"/>
    </linearGradient>
  </defs>
  <path d="M16 4 C20 8 26 12 24 20 C28 24 28 32 24 40 C28 48 24 56 18 60 L14 60 C8 56 4 48 8 40 C4 32 4 24 8 20 C6 12 12 8 16 4 Z" fill="url(#ob_g)"/>
  <path d="M16 6 L16 58" stroke="#3e2723" stroke-width="0.6" fill="none"/>
</svg>`),

  // 7. Oak Leaf - Holes/Eaten
  oakHoles:
    svgData(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 64">
  <defs>
    <linearGradient id="oh_g" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#8d6e63"/>
      <stop offset="100%" stop-color="#3e2723"/>
    </linearGradient>
  </defs>
  <mask id="holes">
    <rect x="0" y="0" width="32" height="64" fill="white"/>
    <circle cx="10" cy="24" r="2" fill="black"/>
    <circle cx="22" cy="40" r="3" fill="black"/>
    <circle cx="12" cy="50" r="1.5" fill="black"/>
  </mask>
  <path d="M16 4 C20 8 26 12 24 20 C28 24 28 32 24 40 C28 48 24 56 18 60 L14 60 C8 56 4 48 8 40 C4 32 4 24 8 20 C6 12 12 8 16 4 Z" fill="url(#oh_g)" mask="url(#holes)"/>
  <path d="M16 6 L16 58" stroke="#2a1a15" stroke-width="0.5" fill="none"/>
</svg>`),

  // 8. Birch - Yellow
  birchYellow:
    svgData(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 48">
  <defs>
    <linearGradient id="by_g" x1="50%" y1="0%" x2="50%" y2="100%">
      <stop offset="0%" stop-color="#fff176"/>
      <stop offset="100%" stop-color="#fdd835"/>
    </linearGradient>
  </defs>
  <path d="M16 4 L26 16 C28 24 22 36 16 44 C10 36 4 24 6 16 L16 4 Z" fill="url(#by_g)" stroke="#f57f17" stroke-width="0.5"/>
  <path d="M16 4 L16 44 M16 16 L24 14 M16 26 L24 24 M16 16 L8 14 M16 26 L8 24" stroke="#f57f17" stroke-width="0.5" fill="none"/>
</svg>`),

  // 9. Aspen - Gold
  aspenGold:
    svgData(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 36">
  <defs>
    <radialGradient id="ag_g" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#ffeb3b"/>
      <stop offset="100%" stop-color="#fbc02d"/>
    </radialGradient>
  </defs>
  <path d="M16 2 C24 4 30 14 26 26 C22 32 16 36 16 36 C16 36 10 32 6 26 C2 14 8 4 16 2 Z" fill="url(#ag_g)" stroke="#f9a825" stroke-width="0.3"/>
  <path d="M16 4 L16 34 M16 16 L24 12 M16 24 L22 20 M16 16 L8 12 M16 24 L10 20" stroke="#f9a825" stroke-width="0.3" fill="none"/>
</svg>`),

  // 10. Beech - Copper
  beechCopper:
    svgData(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 48">
  <defs>
    <linearGradient id="bc_g" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#ffcc80"/>
      <stop offset="100%" stop-color="#e65100"/>
    </linearGradient>
  </defs>
  <path d="M12 2 C18 6 22 16 20 30 C18 42 12 46 12 46 C12 46 6 42 4 30 C2 16 6 6 12 2 Z" fill="url(#bc_g)" stroke="#bf360c" stroke-width="0.5"/>
  <path d="M12 4 L12 46 M12 12 L18 10 M12 20 L20 18 M12 28 L18 26 M12 12 L6 10 M12 20 L4 18 M12 28 L6 26" stroke="#bf360c" stroke-width="0.4" fill="none"/>
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

const PhysicsSnow: React.FC<PhysicsSnowProps> = ({ mode, count = 100 }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>(0);
  const particlesRef = useRef<PhysicsParticle[]>([]);
  const texturesRef = useRef<Map<string, CanvasImageSource>>(new Map());
  const sizeRef = useRef({ w: 0, h: 0, dpr: 1 });
  const windPhaseRef = useRef<number>(0);
  const lastTimeRef = useRef<number>(0);

  const [mounted, setMounted] = useState(false);
  const [texturesLoaded, setTexturesLoaded] = useState(false);

  const textureUrls = useMemo(() => {
    if (mode === 'spring') return Object.values(SPRING_TEXTURES);
    if (mode === 'autumn') return Object.values(AUTUMN_TEXTURES);
    return []; // Winter uses colors, no textures needed
  }, [mode]);

  // Handle resize and DPR once
  useEffect(() => {
    const update = () => {
      sizeRef.current.w = window.innerWidth;
      sizeRef.current.h = window.innerHeight;
      sizeRef.current.dpr = Math.min(2, window.devicePixelRatio || 1);
    };
    update();
    window.addEventListener('resize', update, { passive: true });
    return () => window.removeEventListener('resize', update);
  }, []);

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
            let source: CanvasImageSource = img;
            if ('createImageBitmap' in window) {
              try {
                source = await createImageBitmap(img);
              } catch {
                // fallback to img
              }
            }
            texturesRef.current.set(url, source);
          } catch (e) {
            console.warn('Failed to load texture:', url, e);
          }
        }
      });
      await Promise.allSettled(loadPromises);
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

      const baseSize = mode === 'winter' ? 5 : mode === 'spring' ? 12 : 18;
      const size = baseSize + Math.random() * baseSize * 0.4; // Reduced variation multiplier from 0.6

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
        texture: texturesRef.current.get(textureKey) || null,
        textureKey: textureKey,
        color: isWinter
          ? WINTER_COLORS[Math.floor(Math.random() * WINTER_COLORS.length)]
          : '',
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
    for (let i = 0; i < count; i++) {
      const p = createParticle(i, w);
      p.y = Math.random() * window.innerHeight * 1.5 - window.innerHeight * 0.5;
      particlesRef.current.push(p);
    }
  }, [mounted, texturesLoaded, count, createParticle]);

  // Animation loop
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

      const { w, h, dpr } = sizeRef.current;
      windPhaseRef.current += dt * 0.5;

      // Optimized resize
      const targetW = Math.max(1, Math.round(w * dpr));
      const targetH = Math.max(1, Math.round(h * dpr));
      if (canvas.width !== targetW || canvas.height !== targetH) {
        canvas.width = targetW;
        canvas.height = targetH;
        canvas.style.width = `${w}px`;
        canvas.style.height = `${h}px`;
      }

      // Clear in device space
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      const particles = particlesRef.current;
      const nowMs = Date.now();

      // Precompute frame-wide constants
      const timeSec = now / 1000;
      const gustBase = Math.sin(windPhaseRef.current) * CONFIG.WIND_BASE * 0.7;
      const timeSway = mode === 'autumn' ? 0.7 : 0.5;
      const timeWobble = mode === 'autumn' ? 1.4 : 1.2;

      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];

        // Physics: Gravity + Wind + Sway
        const zF = 0.5 + p.z * 1.5;
        const gravityF = mode === 'autumn' ? 0.82 : 1;
        p.vy += CONFIG.GRAVITY * gravityF * dt * zF;

        const flutter = mode === 'autumn' ? p.flutter : 1;
        const gust =
          gustBase +
          Math.sin(timeSec * 0.35 + p.swayOffset) * CONFIG.WIND_VARIANCE * 0.4;

        const windVel =
          (CONFIG.WIND_BASE + gust) * zF * (mode === 'autumn' ? 1.05 : 1);
        const swayVel =
          Math.sin(timeSec * timeSway + p.swayOffset) *
          p.size *
          (mode === 'autumn' ? 0.75 : 0.5) *
          zF *
          flutter;

        p.x += (p.vx + windVel + swayVel) * dt;
        p.y += p.vy * dt;

        const wobbleVel =
          mode === 'autumn'
            ? Math.sin(timeSec * timeWobble + p.swayOffset) * 14 * flutter * zF
            : 0;
        p.rotation += (p.rotationSpeed + wobbleVel) * dt;

        // Wrap
        if (p.x < -p.size) p.x = w + p.size;
        if (p.x > w + p.size) p.x = -p.size;

        if (p.y > h + p.size * 2) {
          Object.assign(p, createParticle(p.id, w));
        }

        const depthAlpha = 0.4 + p.z * 0.6;
        const fadeIn = p.bornAt > 0 ? Math.min(1, (nowMs - p.bornAt) / 800) : 1;
        const rawA = p.opacity * depthAlpha * fadeIn;
        // Bucket alpha to reduce compositor state changes
        const a = Math.round(rawA * 50) / 50;

        if (a <= 0.001) continue;

        const zScale = 0.7 + p.z * 0.6;
        const rad = (p.rotation * Math.PI) / 180;
        const cos = Math.cos(rad) * zScale * dpr;
        const sin = Math.sin(rad) * zScale * dpr;

        // Baked DPR into transform
        ctx.setTransform(cos, sin, -sin, cos, p.x * dpr, p.y * dpr);
        ctx.globalAlpha = a;

        if (p.texture) {
          ctx.drawImage(p.texture, -p.size / 2, -p.size / 2, p.size, p.size);
        } else {
          ctx.fillStyle = getSnowGrad(ctx, p.size);
          ctx.beginPath();
          ctx.arc(0, 0, p.size / 2, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // Reset state
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = 1;

      while (
        particles.length < count &&
        particles.length < CONFIG.MAX_PARTICLES
      ) {
        particles.push(createParticle(particles.length, w));
      }

      rafRef.current = requestAnimationFrame(loop);
    };

    lastTimeRef.current = performance.now(); // FIX: Init time to prevent HUGE dt
    rafRef.current = requestAnimationFrame(loop);

    return () => {
      active = false;
      cancelAnimationFrame(rafRef.current);
      snowGradCache.clear();
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
