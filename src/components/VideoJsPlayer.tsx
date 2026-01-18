/* eslint-disable @typescript-eslint/no-explicit-any */
'use client';

import Hls from 'hls.js';
import type {
  MutableRefObject,
  PointerEvent as ReactPointerEvent,
  RefObject,
  SyntheticEvent,
} from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import videojs from 'video.js';
import Player from 'video.js/dist/types/player';
import 'videojs-flvjs';

import 'video.js/dist/video-js.css';

// --- Interfaces ---
interface WebKitHTMLVideoElement extends HTMLVideoElement {
  webkitEnterFullscreen?: () => void;
  webkitExitFullscreen?: () => void;
  webkitShowPlaybackTargetPicker?: () => void;
  webkitRequestFullscreen?: () => void;
  webkitSetPresentationMode?: (
    mode: 'inline' | 'picture-in-picture' | 'fullscreen',
  ) => void;
  webkitPresentationMode?: 'inline' | 'picture-in-picture' | 'fullscreen';
}

interface VideoJsPlayerInstance extends Omit<Player, 'tech'> {
  tech?: (safe?: boolean) => {
    el?: () => WebKitHTMLVideoElement;
    on?: (event: string, handler: () => void) => void;
    off?: (event: string, handler: () => void) => void;
  };
  inactivityTimeout?: (value?: number) => number;
}

interface VideoJsOptions {
  controls?: boolean;
  autoplay?: boolean | string;
  preload?: string;
  fluid?: boolean;
  fill?: boolean;
  poster?: string;
  playsinline?: boolean;
  userActions?: { click?: boolean; doubleClick?: boolean };
  html5?: { vhs?: { [key: string]: unknown } };
  sources?: { src: string; type: string }[];
  [key: string]: unknown;
}

interface VideoJsPlayerProps {
  url: string;
  type?: string;
  poster?: string;
  autoPlay?: boolean;
  onReady?: (player: Player) => void;
  onTimeUpdate?: (currentTime: number, duration: number) => void;
  onEnded?: () => void;
  onError?: (error: unknown) => void;
  onPlay?: () => void;
  onPause?: () => void;
  onNextEpisode?: () => void;
  hasNextEpisode?: boolean;
  skipIntroTime?: number;
  skipOutroTime?: number;
  enableSkip?: boolean;
  customHlsLoader?: any;
  className?: string;
  debug?: boolean;
  seriesId?: string;
  isLive?: boolean;
  videoJsOptions?: VideoJsOptions;
  reloadTrigger?: number;
}

// --- Icons ---
const Icons = {
  play: (
    <svg
      viewBox='0 0 24 24'
      fill='currentColor'
      className='icon'
      aria-hidden='true'
    >
      <path d='M8 5v14l11-7z' />
    </svg>
  ),
  pause: (
    <svg
      viewBox='0 0 24 24'
      fill='currentColor'
      className='icon'
      aria-hidden='true'
    >
      <path d='M6 19h4V5H6v14zm8-14v14h4V5h-4z' />
    </svg>
  ),
  next: (
    <svg
      viewBox='0 0 24 24'
      fill='currentColor'
      className='icon'
      aria-hidden='true'
    >
      <path d='M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z' />
    </svg>
  ),
  fullscreen: (
    <svg
      viewBox='0 0 24 24'
      fill='currentColor'
      className='icon'
      aria-hidden='true'
    >
      <path d='M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z' />
    </svg>
  ),
  exitFullscreen: (
    <svg
      viewBox='0 0 24 24'
      fill='currentColor'
      className='icon'
      aria-hidden='true'
    >
      <path d='M5 16h3v3h2v-5H5v2zm3-8H5v2h5V5H8v3zm6 11h2v-3h3v-2h-5v5zm2-11V5h-2v5h5V8h-3z' />
    </svg>
  ),
  settings: (
    <svg
      viewBox='0 0 24 24'
      fill='currentColor'
      className='icon'
      aria-hidden='true'
    >
      <path d='M19.14 12.94c.04-.31.06-.63.06-.94 0-.31-.02-.63-.06-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z' />
    </svg>
  ),
  airplay: (
    <svg
      viewBox='0 0 24 24'
      fill='currentColor'
      className='icon'
      aria-hidden='true'
    >
      <path d='M6 22h12l-6-6-6 6zM21 3H3c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h4v-2H3V5h18v12h-4v2h4c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2z' />
    </svg>
  ),
  pip: (
    <svg
      viewBox='0 0 24 24'
      fill='currentColor'
      className='icon'
      aria-hidden='true'
    >
      <path d='M19 11h-8v6h8v-6zm4 8V4.98C23 3.88 22.1 3 21 3H3c-1.1 0-2 .88-2 1.98V19c0 1.1.9 2 2 2h18c1.1 0 2-.9 2-2zm-2 .02H3V4.97h18v14.05z' />
    </svg>
  ),
  rotate: (
    <svg
      viewBox='0 0 24 24'
      fill='currentColor'
      className='icon'
      aria-hidden='true'
    >
      <path d='M7.11 8.53L5.7 7.11C4.8 8.27 4.24 9.61 4.07 11h2.02c.14-.87.49-1.72 1.02-2.47zM6.09 13H4.07c.17 1.39.72 2.73 1.62 3.89l1.41-1.42c-.52-.75-.87-1.59-1.01-2.47zm1.01 5.32c1.16.9 2.51 1.44 3.9 1.61V17.9c-.87-.15-1.71-.49-2.46-1.03L7.1 18.32zM13 4.07V1L8.45 5.55 13 10V6.09c2.84.48 5 2.94 5 5.91s-2.16 5.43-5 5.91v2.02c3.95-.49 7-3.85 7-7.93s-3.05-7.44-7-7.93z' />
    </svg>
  ),
  bigPlay: (
    <svg
      viewBox='0 0 24 24'
      fill='currentColor'
      className='icon'
      style={{ width: 48, height: 48 }}
      aria-hidden='true'
    >
      <path d='M8 5v14l11-7z' />
    </svg>
  ),
  bigPause: (
    <svg
      viewBox='0 0 24 24'
      fill='currentColor'
      className='icon'
      style={{ width: 48, height: 48 }}
      aria-hidden='true'
    >
      <path d='M6 19h4V5H6v14zm8-14v14h4V5h-4z' />
    </svg>
  ),
};

// --- Hooks ---
const useUnifiedSeek = (
  playerRef: MutableRefObject<VideoJsPlayerInstance | null>,
  setCurrentTime: (t: number) => void,
  setIsPaused: (p: boolean) => void,
  setSeekingTime: (t: number | null) => void,
) => {
  const seekRef = useRef({
    active: false,
    wasPlaying: false,
    showOverlay: false,
  });
  const rafRef = useRef<number | null>(null);
  const lastPreviewRef = useRef<number>(0);

  const begin = useCallback(
    (opts?: { showOverlay?: boolean }) => {
      if (seekRef.current.active) return;
      const player = playerRef.current;
      seekRef.current.active = true;
      seekRef.current.showOverlay = !!opts?.showOverlay;
      seekRef.current.wasPlaying = player ? !player.paused() : false;
      lastPreviewRef.current =
        player?.currentTime?.() ?? lastPreviewRef.current ?? 0;

      if (seekRef.current.wasPlaying) {
        player?.pause();
        setIsPaused(true);
      }
    },
    [playerRef, setIsPaused],
  );

  const preview = useCallback(
    (time: number) => {
      lastPreviewRef.current = Number.isFinite(time) ? time : 0;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(() => {
        const p = playerRef.current;
        const d = p?.duration?.() ?? 0;
        const hasFiniteDuration = Number.isFinite(d) && d > 0;
        const safe = hasFiniteDuration
          ? Math.max(0, Math.min(d, lastPreviewRef.current))
          : Math.max(0, lastPreviewRef.current);

        setCurrentTime(safe);
        if (seekRef.current.showOverlay) setSeekingTime(safe);

        if (p && Number.isFinite(safe)) {
          p.currentTime(safe);
        }
      });
    },
    [playerRef, setCurrentTime, setSeekingTime],
  );

  const end = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    const player = playerRef.current;
    if (!seekRef.current.active) return;
    if (seekRef.current.showOverlay) setSeekingTime(null);

    const d = player?.duration?.() ?? 0;
    const hasFiniteDuration = Number.isFinite(d) && d > 0;
    const target = hasFiniteDuration
      ? Math.max(0, Math.min(d, lastPreviewRef.current))
      : Math.max(0, lastPreviewRef.current);

    if (player && Number.isFinite(target)) player.currentTime(target);

    if (seekRef.current.wasPlaying) {
      player?.play()?.catch(() => {
        if (player) player.trigger('useractive');
      });
      setIsPaused(false);
    }
    seekRef.current.active = false;
    seekRef.current.showOverlay = false;
  }, [playerRef, setIsPaused, setSeekingTime]);

  const cancel = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    if (seekRef.current.showOverlay) setSeekingTime(null);
    seekRef.current.active = false;
    seekRef.current.showOverlay = false;
  }, [setSeekingTime]);

  useEffect(() => {
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  const isActive = useCallback(() => seekRef.current.active, []);

  return useMemo(
    () => ({ begin, preview, end, cancel, isActive }),
    [begin, preview, end, cancel, isActive],
  );
};

const useProgressBarScrub = (
  progressBarRef: RefObject<HTMLDivElement | null>,
  duration: number,
  unifiedSeek: ReturnType<typeof useUnifiedSeek>,
) => {
  const [isScrubbing, setIsScrubbing] = useState(false);
  const pointerIdRef = useRef<number | null>(null);

  const getTimeFromX = useCallback(
    (clientX: number) => {
      const bar = progressBarRef.current;
      if (!bar || duration <= 0 || !Number.isFinite(duration)) return 0;
      const rect = bar.getBoundingClientRect();
      return (
        Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)) * duration
      );
    },
    [duration, progressBarRef],
  );

  const handleScrubStart = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      if ((e as unknown as { isPrimary?: boolean }).isPrimary === false) return;
      if (e.cancelable) e.preventDefault();
      e.stopPropagation();

      pointerIdRef.current = e.pointerId;
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }

      setIsScrubbing(true);
      unifiedSeek.begin({ showOverlay: false });
      unifiedSeek.preview(getTimeFromX(e.clientX));
    },
    [getTimeFromX, unifiedSeek],
  );

  useEffect(() => {
    if (!isScrubbing) return;
    if (typeof document === 'undefined') return;

    const releaseCaptureSafe = () => {
      const bar = progressBarRef.current;
      const pid = pointerIdRef.current;
      if (bar && pid != null) {
        try {
          bar.releasePointerCapture(pid);
        } catch {
          /* ignore */
        }
      }
      pointerIdRef.current = null;
    };

    const handleGlobalMove = (e: PointerEvent) => {
      const pid = pointerIdRef.current;
      if (pid != null && e.pointerId !== pid) return;
      if (e.cancelable) e.preventDefault();
      unifiedSeek.preview(getTimeFromX(e.clientX));
    };

    const handleGlobalEnd = (e: PointerEvent) => {
      const pid = pointerIdRef.current;
      if (pid != null && e.pointerId !== pid) return;
      if (e.cancelable) e.preventDefault();
      releaseCaptureSafe();
      setIsScrubbing(false);
      const t = getTimeFromX(e.clientX);
      unifiedSeek.preview(t);
      unifiedSeek.end();
    };

    const handleLostCapture = (e: Event) => {
      if (e instanceof PointerEvent) handleGlobalEnd(e);
      else {
        releaseCaptureSafe();
        setIsScrubbing(false);
        unifiedSeek.end();
      }
    };

    document.addEventListener('pointermove', handleGlobalMove, {
      passive: false,
    });
    document.addEventListener('pointerup', handleGlobalEnd, { passive: false });
    document.addEventListener('pointercancel', handleGlobalEnd, {
      passive: false,
    });
    const bar = progressBarRef.current;
    if (bar) bar.addEventListener('lostpointercapture', handleLostCapture);

    return () => {
      releaseCaptureSafe();
      document.removeEventListener('pointermove', handleGlobalMove);
      document.removeEventListener('pointerup', handleGlobalEnd);
      document.removeEventListener('pointercancel', handleGlobalEnd);
      if (bar) bar.removeEventListener('lostpointercapture', handleLostCapture);
    };
  }, [isScrubbing, getTimeFromX, unifiedSeek, progressBarRef]);

  return { handleScrubStart, isScrubbing };
};

const usePlayerGestures = (
  containerRef: RefObject<HTMLDivElement | null>,
  playerRef: MutableRefObject<VideoJsPlayerInstance | null>,
  duration: number,
  unifiedSeek: ReturnType<typeof useUnifiedSeek>,
  controlsVisible: boolean,
) => {
  const gestureRef = useRef({
    startX: 0,
    startY: 0,
    startVideoTime: 0,
    isSeeking: false,
    active: false,
    pointerId: null as number | null,
    captured: false,
  });

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const safeCapture = (pid: number) => {
      if (gestureRef.current.captured) return;
      try {
        container.setPointerCapture(pid);
        gestureRef.current.captured = true;
      } catch {
        /* empty */
      }
    };
    const safeRelease = (pid: number) => {
      if (!gestureRef.current.captured) return;
      try {
        container.releasePointerCapture(pid);
      } catch {
        /* empty */
      }
      gestureRef.current.captured = false;
    };

    const handleStart = (e: PointerEvent) => {
      if (!e.isPrimary) return;
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      const target = e.target as HTMLElement;
      if (!container.contains(target)) return;
      if (controlsVisible) {
        if (
          target.closest(
            'button, .progress-bar, .progress-track, .progress-fill, .progress-thumb, .settings-popup, select, input',
          )
        )
          return;
      }

      gestureRef.current.pointerId = e.pointerId;
      gestureRef.current.startX = e.clientX;
      gestureRef.current.startY = e.clientY;
      gestureRef.current.active = true;
      gestureRef.current.isSeeking = false;
      gestureRef.current.captured = false;
      gestureRef.current.startVideoTime = playerRef.current?.currentTime() || 0;
    };

    const handleMove = (e: PointerEvent) => {
      const g = gestureRef.current;
      if (!g.active) return;
      if (g.pointerId != null && e.pointerId !== g.pointerId) return;

      const dx = e.clientX - g.startX;
      const dy = e.clientY - g.startY;
      const isRotated = container.classList.contains(
        'videojs-rotated-fullscreen',
      );

      if (!g.isSeeking && (Math.abs(dx) > 10 || Math.abs(dy) > 10)) {
        const shouldSeek = isRotated
          ? Math.abs(dy) > Math.abs(dx)
          : Math.abs(dx) > Math.abs(dy);
        if (shouldSeek) {
          g.isSeeking = true;
          safeCapture(e.pointerId);
          if (e.cancelable) e.preventDefault();
          unifiedSeek.begin({ showOverlay: true });
          g.startVideoTime =
            playerRef.current?.currentTime() || g.startVideoTime;
        } else {
          g.active = false;
          g.pointerId = null;
          g.captured = false;
        }
      }
      if (g.isSeeking) {
        if (e.cancelable) e.preventDefault();
        const span = isRotated
          ? container.clientHeight || 1
          : container.clientWidth || 1;

        // FIX: Multi-stage duration fallback for robust seeking on HLS
        let activeDuration = duration;

        // Stage 1: Check React State
        if (!Number.isFinite(activeDuration) || activeDuration <= 0) {
          const pDur = playerRef.current?.duration?.() ?? 0;

          // Stage 2: Check Video.js Player
          if (Number.isFinite(pDur) && pDur > 0) {
            activeDuration = pDur;
          } else {
            // Stage 3: Check Native Element (Last Resort)
            const v = playerRef.current?.tech?.(true)?.el?.();
            const nDur = v instanceof HTMLVideoElement ? v.duration : 0;

            if (Number.isFinite(nDur) && nDur > 0) {
              activeDuration = nDur;
            } else {
              // Stage 4: Unknown duration -> Skip preview
              // Keep dragging active so it works if duration arrives mid-drag.
              return;
            }
          }
        }

        const delta = isRotated ? dy : dx;
        const raw = g.startVideoTime + delta * (activeDuration / span) * 0.8;
        const clamped = Math.max(0, Math.min(activeDuration, raw));
        unifiedSeek.preview(clamped);
      }
    };

    const handleEnd = (e: PointerEvent) => {
      const g = gestureRef.current;
      if (g.pointerId != null && e.pointerId !== g.pointerId) return;

      if (g.captured) safeRelease(e.pointerId);

      if (g.isSeeking) {
        if (e.cancelable) e.preventDefault();
        e.stopPropagation();
        unifiedSeek.end();
      }
      g.active = false;
      g.isSeeking = false;
      g.pointerId = null;
      g.captured = false;
    };

    const handleLostGestureCapture = (e: Event) => {
      if (e instanceof PointerEvent) handleEnd(e);
      else {
        if (gestureRef.current.isSeeking) unifiedSeek.end();
        gestureRef.current.active = false;
        gestureRef.current.isSeeking = false;
        gestureRef.current.pointerId = null;
        gestureRef.current.captured = false;
      }
    };

    container.addEventListener('pointerdown', handleStart);
    container.addEventListener('pointermove', handleMove);
    container.addEventListener('pointerup', handleEnd);
    container.addEventListener('pointercancel', handleEnd);
    container.addEventListener('lostpointercapture', handleLostGestureCapture);

    return () => {
      container.removeEventListener('pointerdown', handleStart);
      container.removeEventListener('pointermove', handleMove);
      container.removeEventListener('pointerup', handleEnd);
      container.removeEventListener('pointercancel', handleEnd);
      container.removeEventListener(
        'lostpointercapture',
        handleLostGestureCapture,
      );
    };
  }, [containerRef, playerRef, duration, unifiedSeek, controlsVisible]);
};

// --- CAS Shader Hook (Unchanged) ---
const useCasShader = (
  playerReady: boolean,
  casEnabled: boolean,
  getTechVideoEl: () => HTMLVideoElement | null,
  isPiPActive: boolean,
  debug: boolean = false,
  techEpoch: number,
  disableCas: () => void,
) => {
  const animationFrameRef = useRef<number | undefined>(undefined);
  const ownerRef = useRef<string>(
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Date.now()}_${Math.random()}`,
  );
  const techRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const failuresRef = useRef(0);

  const hardStop = useCallback(() => {
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = undefined;
    }
    if (canvasRef.current) {
      canvasRef.current.remove();
      canvasRef.current = null;
    }
    if (
      techRef.current &&
      techRef.current.dataset.casOwner === ownerRef.current
    ) {
      techRef.current.style.opacity = '1';
      techRef.current.removeAttribute('data-cas-active');
      delete techRef.current.dataset.casOwner;
      techRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    if (failuresRef.current > 3) return;

    if (!playerReady || !casEnabled || isPiPActive) {
      hardStop();
      const tech = getTechVideoEl();
      const zombie = tech?.parentElement?.querySelector(
        `canvas[data-cas-canvas="1"][data-cas-owner="${ownerRef.current}"]`,
      ) as HTMLCanvasElement | null;
      if (zombie) zombie.remove();
      if (tech && tech.dataset.casOwner === ownerRef.current) {
        tech.style.opacity = '1';
        tech.removeAttribute('data-cas-active');
        delete tech.dataset.casOwner;
        techRef.current = null;
      }
      return;
    }

    const tech = getTechVideoEl();
    if (tech) {
      const active = tech.getAttribute('data-cas-active') === 'true';
      const ownedByMe = tech.dataset.casOwner === ownerRef.current;
      if (active && !ownedByMe) return;
      if (active && ownedByMe) return;
    }
    if (!tech || !tech.parentElement) return;

    const canvas = document.createElement('canvas');
    canvas.dataset.casCanvas = '1';
    canvas.dataset.casOwner = ownerRef.current;
    Object.assign(canvas.style, {
      position: 'absolute',
      top: '0',
      left: '0',
      width: '100%',
      height: '100%',
      pointerEvents: 'none',
      zIndex: '0',
      objectFit: 'contain',
    });

    const existing = tech.parentElement.querySelector(
      `canvas[data-cas-canvas="1"][data-cas-owner="${ownerRef.current}"]`,
    );
    if (existing) existing.remove();
    tech.parentElement.insertBefore(canvas, tech.nextSibling);
    canvasRef.current = canvas;
    techRef.current = tech;

    const gl = canvas.getContext('webgl', {
      alpha: false,
      preserveDrawingBuffer: false,
      antialias: false,
    });
    if (!gl) {
      hardStop();
      return;
    }

    let texture: WebGLTexture | null = null,
      buffer: WebGLBuffer | null = null,
      program: WebGLProgram | null = null,
      vsS: WebGLShader | null = null,
      fsS: WebGLShader | null = null;
    const safeDeleteGL = () => {
      if (texture) gl.deleteTexture(texture);
      if (buffer) gl.deleteBuffer(buffer);
      if (program) {
        if (vsS) gl.detachShader(program, vsS);
        if (fsS) gl.detachShader(program, fsS);
        gl.deleteProgram(program);
      }
      if (vsS) gl.deleteShader(vsS);
      if (fsS) gl.deleteShader(fsS);
    };
    const cleanupGL = () => {
      safeDeleteGL();
    };
    const handleContextLost = (e: Event) => {
      e.preventDefault();
      canvas.removeEventListener('webglcontextlost', handleContextLost);
      cleanupGL();
      hardStop();
    };
    canvas.addEventListener('webglcontextlost', handleContextLost, {
      passive: false,
    });
    const abortInit = () => {
      canvas.removeEventListener('webglcontextlost', handleContextLost);
      safeDeleteGL();
      hardStop();
    };

    const vsSource = `attribute vec2 position; varying vec2 v_texCoord; void main() { gl_Position = vec4(position,0,1); v_texCoord = position*0.5+0.5; v_texCoord.y=1.0-v_texCoord.y; }`;
    const fsSource = `precision mediump float; varying vec2 v_texCoord; uniform sampler2D u_image; uniform vec2 u_resolution; uniform float u_sharpness; void main() { vec2 tex = 1.0 / u_resolution; vec3 e = texture2D(u_image, v_texCoord).rgb; vec3 a = texture2D(u_image, v_texCoord + vec2(0.0, -tex.y)).rgb; vec3 c = texture2D(u_image, v_texCoord + vec2(-tex.x, 0.0)).rgb; vec3 g = texture2D(u_image, v_texCoord + vec2(tex.x, 0.0)).rgb; vec3 i = texture2D(u_image, v_texCoord + vec2(0.0, tex.y)).rgb; float w = -1.0 / mix(8.0, 5.0, clamp(u_sharpness, 0.0, 1.0)); vec3 res = (a + c + g + i) * w + e; float div = 1.0 + 4.0 * w; vec3 final = res / div; vec3 mn = min(min(min(a, c), g), i); vec3 mx = max(max(max(a, c), g), i); final = clamp(final, min(mn, e), max(mx, e)); float lum = dot(final, vec3(0.2126, 0.7152, 0.0722)); gl_FragColor = vec4((mix(vec3(lum), final, 1.15) - 0.5) * 1.05 + 0.5, 1.0); }`;

    const createShader = (type: number, src: string) => {
      const s = gl.createShader(type);
      if (!s) return null;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
        gl.deleteShader(s);
        return null;
      }
      return s;
    };
    program = gl.createProgram();
    vsS = createShader(gl.VERTEX_SHADER, vsSource);
    fsS = createShader(gl.FRAGMENT_SHADER, fsSource);
    if (!program || !vsS || !fsS) {
      abortInit();
      return;
    }
    gl.attachShader(program, vsS);
    gl.attachShader(program, fsS);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      abortInit();
      return;
    }
    gl.useProgram(program);
    buffer = gl.createBuffer();
    if (!buffer) {
      abortInit();
      return;
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
      gl.STATIC_DRAW,
    );
    const posLoc = gl.getAttribLocation(program, 'position');
    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);
    texture = gl.createTexture();
    if (!texture) {
      abortInit();
      return;
    }
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    const resLoc = gl.getUniformLocation(program, 'u_resolution');
    const sharpLoc = gl.getUniformLocation(program, 'u_sharpness');

    tech.setAttribute('data-cas-active', 'true');
    tech.dataset.casOwner = ownerRef.current;
    let isFirstRender = true;
    const render = () => {
      if (!tech.isConnected || !canvas.isConnected) {
        cleanupGL();
        hardStop();
        return;
      }
      if (!tech.videoWidth) {
        animationFrameRef.current = requestAnimationFrame(render);
        return;
      }
      const glCtx = gl as WebGLRenderingContext & {
        isContextLost?: () => boolean;
      };
      if (glCtx.isContextLost?.()) {
        cleanupGL();
        hardStop();
        return;
      }
      if (
        canvas.width !== tech.videoWidth ||
        canvas.height !== tech.videoHeight
      ) {
        canvas.width = tech.videoWidth;
        canvas.height = tech.videoHeight;
        gl.viewport(0, 0, canvas.width, canvas.height);
      }
      try {
        gl.texImage2D(
          gl.TEXTURE_2D,
          0,
          gl.RGBA,
          gl.RGBA,
          gl.UNSIGNED_BYTE,
          tech,
        );
        if (isFirstRender) {
          tech.style.opacity = '0';
          isFirstRender = false;
        }
      } catch (e) {
        failuresRef.current += 1;
        if (debug) console.warn('CAS Shader stopped: Texture tainted/CORS', e);
        cleanupGL();
        hardStop();
        if (failuresRef.current > 3) disableCas();
        return;
      }
      if (resLoc) gl.uniform2f(resLoc, canvas.width, canvas.height);
      if (sharpLoc) gl.uniform1f(sharpLoc, 0.6);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      animationFrameRef.current = requestAnimationFrame(render);
    };
    render();
    return () => {
      canvas.removeEventListener('webglcontextlost', handleContextLost);
      cleanupGL();
      hardStop();
    };
  }, [
    playerReady,
    casEnabled,
    getTechVideoEl,
    isPiPActive,
    debug,
    hardStop,
    techEpoch,
    disableCas,
  ]);
};

// --- Main Component ---
export default function VideoJsPlayer({
  url,
  type,
  poster,
  autoPlay = true,
  onReady,
  onTimeUpdate,
  onEnded,
  onError,
  onPlay,
  onPause,
  onNextEpisode,
  hasNextEpisode = false,
  skipIntroTime = 0,
  skipOutroTime = 0,
  enableSkip = false,
  customHlsLoader,
  className = '',
  debug = false,
  seriesId = 'global',
  isLive = false,
  videoJsOptions,
  reloadTrigger = 0,
}: VideoJsPlayerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const videoWrapperRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<VideoJsPlayerInstance | null>(null);
  const hlsRef = useRef<Hls | null>(null);
  const hlsCleanupRef = useRef<(() => void) | null>(null);
  const networkErrorCountRef = useRef(0);
  const hasSkippedIntroRef = useRef(false);
  const hasTriggeredOutroRef = useRef(false);
  const progressBarRef = useRef<HTMLDivElement>(null);
  const mountedRef = useRef(true);
  const inactivityTimeoutRef = useRef<number | null>(null);

  const configRef = useRef({
    enableSkip,
    skipIntroTime,
    skipOutroTime,
    autoPlay,
  });
  const callbacksRef = useRef({
    onReady,
    onTimeUpdate,
    onEnded,
    onError,
    onPlay,
    onPause,
  });
  const tapGateRef = useRef({
    moved: false,
    startX: 0,
    startY: 0,
    down: false,
  });
  const switchSnapshotRef = useRef<{
    time: number;
    wasPlaying: boolean;
  } | null>(null);
  const switchEpochRef = useRef(0);
  const firstLoadRef = useRef(true);
  const lastToggleTimeRef = useRef(0);
  const iosFsRef = useRef<{
    video: HTMLVideoElement | null;
    onBegin: (() => void) | null;
    onEnd: (() => void) | null;
  }>({ video: null, onBegin: null, onEnd: null });
  const pipRef = useRef<{
    video: HTMLVideoElement | null;
    onEnter: (() => void) | null;
    onLeave: (() => void) | null;
  }>({ video: null, onEnter: null, onLeave: null });

  // FIX: Stable ref for managing native HLS autoplay listeners across switches
  const nativeAutoplayRef = useRef<{
    video: HTMLVideoElement | null;
    handler: (() => void) | null;
  }>({ video: null, handler: null });

  const [isUiInteracting, setIsUiInteracting] = useState(false);
  const uiInteractTimeoutRef = useRef<number | null>(null);

  const [playbackRate, setPlaybackRate] = useState(() => {
    if (typeof window === 'undefined') return 1;
    try {
      const s = localStorage.getItem(`lunatv_speed_${seriesId}`);
      return s ? parseFloat(s) : 1;
    } catch {
      return 1;
    }
  });
  const playbackRateRef = useRef(playbackRate);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [playerReady, setPlayerReady] = useState(false);
  const [isPaused, setIsPaused] = useState(true);
  const [seekingTime, setSeekingTime] = useState<number | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [casEnabled, setCasEnabled] = useState(() => {
    if (typeof window === 'undefined') return true;
    try {
      const item = localStorage.getItem('lunatv_cas_enabled');
      return item !== 'false';
    } catch {
      return true;
    }
  });
  const casEnabledRef = useRef(casEnabled);
  const [isRotatedFullscreen, setIsRotatedFullscreen] = useState(false);
  const [pipSupported, setPipSupported] = useState(false);
  const [isPiPActive, setIsPiPActive] = useState(false);
  const [techEpoch, setTechEpoch] = useState(0);
  const hasAirPlay =
    typeof window !== 'undefined' &&
    'WebKitPlaybackTargetAvailabilityEvent' in window;
  const settingsOpenRef = useRef(settingsOpen);

  const finalUrl = useMemo(() => {
    if (!reloadTrigger || reloadTrigger <= 0) return url;
    const separator = url.includes('?') ? '&' : '?';
    return `${url}${separator}t=${reloadTrigger}-${Date.now()}`;
  }, [url, reloadTrigger]);

  const unifiedSeek = useUnifiedSeek(
    playerRef,
    setCurrentTime,
    setIsPaused,
    setSeekingTime,
  );
  const { handleScrubStart, isScrubbing } = useProgressBarScrub(
    progressBarRef,
    duration,
    unifiedSeek,
  );
  usePlayerGestures(
    containerRef,
    playerRef,
    duration,
    unifiedSeek,
    controlsVisible,
  );

  const isScrubbingRef = useRef(false);
  useEffect(() => {
    isScrubbingRef.current = isScrubbing;
  }, [isScrubbing]);
  const seekingTimeRef = useRef<number | null>(null);
  useEffect(() => {
    seekingTimeRef.current = seekingTime;
  }, [seekingTime]);
  const unifiedSeekRef = useRef(unifiedSeek);
  useEffect(() => {
    unifiedSeekRef.current = unifiedSeek;
  }, [unifiedSeek]);
  useEffect(() => {
    settingsOpenRef.current = settingsOpen;
  }, [settingsOpen]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (settingsOpenRef.current) {
          e.stopPropagation();
          setSettingsOpen(false);
        } else {
          const fsEl =
            document.fullscreenElement ||
            (document as any).webkitFullscreenElement;
          if (fsEl) {
            if (document.exitFullscreen)
              document.exitFullscreen().catch(() => {});
            else if ((document as any).webkitExitFullscreen)
              (document as any).webkitExitFullscreen();
          } else if (isRotatedFullscreen) {
            containerRef.current?.classList.remove(
              'videojs-rotated-fullscreen',
            );
            setIsRotatedFullscreen(false);
          }
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isRotatedFullscreen]);

  useEffect(() => {
    const id = 'lunatv-player-css-v1';
    if (document.getElementById(id)) return;
    const style = document.createElement('style');
    style.id = id;
    style.textContent = CSS;
    document.head.appendChild(style);
  }, []);

  useEffect(() => {
    return () => {
      if (uiInteractTimeoutRef.current) {
        window.clearTimeout(uiInteractTimeoutRef.current);
        uiInteractTimeoutRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    callbacksRef.current = {
      onReady,
      onTimeUpdate,
      onEnded,
      onError,
      onPlay,
      onPause,
    };
  }, [onReady, onTimeUpdate, onEnded, onError, onPlay, onPause]);

  useEffect(() => {
    configRef.current = { enableSkip, skipIntroTime, skipOutroTime, autoPlay };
  }, [enableSkip, skipIntroTime, skipOutroTime, autoPlay]);

  useEffect(() => {
    casEnabledRef.current = casEnabled;
  }, [casEnabled]);
  useEffect(() => {
    playbackRateRef.current = playbackRate;
  }, [playbackRate]);

  useEffect(() => {
    if (!playerReady || !playerRef.current) return;
    const p = playerRef.current;
    if (inactivityTimeoutRef.current === null && p.inactivityTimeout) {
      const v = p.inactivityTimeout();
      inactivityTimeoutRef.current = typeof v === 'number' ? v : 2000;
    }
  }, [playerReady]);

  // FIX: Mark Interaction Helper with Smart Whitelist (iOS/Android Safe)
  const markUiInteraction = useCallback(
    (e?: SyntheticEvent | Event, opts: { stop?: boolean } = {}) => {
      const type = (e as any)?.type;
      const isPressEvent =
        type === 'pointerdown' || type === 'mousedown' || type === 'touchstart';

      if (e && 'stopPropagation' in e) {
        if (opts.stop || isPressEvent) {
          (e as any).stopPropagation();
        }
      }

      if (isPressEvent && e && 'preventDefault' in e && (e as any).cancelable) {
        const target = (e as any).target as HTMLElement;
        const tag = target?.tagName;
        const isInteractive =
          tag === 'SELECT' ||
          tag === 'INPUT' ||
          tag === 'TEXTAREA' ||
          tag === 'OPTION' ||
          tag === 'BUTTON' ||
          target.closest('button, a, [role="button"]');

        if (!isInteractive) {
          (e as any).preventDefault();
        }
      }

      const p = playerRef.current;
      if (p) {
        p.userActive?.(true);
        p.reportUserActivity?.({});
      }

      setControlsVisible(true);
      setIsUiInteracting(true);
      if (uiInteractTimeoutRef.current)
        window.clearTimeout(uiInteractTimeoutRef.current);

      uiInteractTimeoutRef.current = window.setTimeout(() => {
        if (mountedRef.current) setIsUiInteracting(false);
      }, 1000); // 1s Buffer
    },
    [],
  );

  const togglePlay = useCallback(() => {
    const p = playerRef.current;
    if (!p) return;
    if (p.paused()) {
      p.play()?.catch(() => {
        if (mountedRef.current) setControlsVisible(true);
      });
    } else {
      p.pause();
    }
  }, []);

  const getTechVideoEl = useCallback((): WebKitHTMLVideoElement | null => {
    const p = playerRef.current;
    if (!p) return null;
    const techEl = p.tech?.(true)?.el?.();
    if (techEl instanceof HTMLVideoElement)
      return techEl as WebKitHTMLVideoElement;
    return p.el()?.querySelector('video') as WebKitHTMLVideoElement | null;
  }, []);

  const waitForVideo = useCallback(
    async (ms = 500) => {
      const now = () =>
        typeof performance !== 'undefined' && performance.now
          ? performance.now()
          : Date.now();
      const start = now();
      while (now() - start < ms) {
        const v = getTechVideoEl();
        if (v) return v;
        await new Promise((r) => setTimeout(r, 50));
      }
      return null;
    },
    [getTechVideoEl],
  );

  const bumpTechEpoch = useCallback(() => {
    if (mountedRef.current) setTechEpoch((prev) => prev + 1);
  }, []);

  const toggleRotatedFullscreen = useCallback(() => {
    if (!isRotatedFullscreen) {
      containerRef.current?.classList.add('videojs-rotated-fullscreen');
      setIsRotatedFullscreen(true);
    } else {
      containerRef.current?.classList.remove('videojs-rotated-fullscreen');
      setIsRotatedFullscreen(false);
    }
    setTimeout(() => {
      if (mountedRef.current) playerRef.current?.trigger('resize');
    }, 50);
  }, [isRotatedFullscreen]);

  const toggleFullscreen = useCallback(async () => {
    if (typeof document === 'undefined') return;
    const container = containerRef.current;
    const video =
      getTechVideoEl() ||
      (container?.querySelector('video') as WebKitHTMLVideoElement | null);
    if (!container) return;

    try {
      const isFS =
        document.fullscreenElement ||
        (document as any).webkitFullscreenElement ||
        (video as any).webkitDisplayingFullscreen;
      if (!isFS) {
        if (container.requestFullscreen) await container.requestFullscreen();
        else if ((container as any).webkitRequestFullscreen)
          (container as any).webkitRequestFullscreen();
        else if (video?.webkitEnterFullscreen) video.webkitEnterFullscreen();
      } else {
        if (document.exitFullscreen) await document.exitFullscreen();
        else if ((document as any).webkitExitFullscreen)
          (document as any).webkitExitFullscreen();
        else if (video?.webkitExitFullscreen) video.webkitExitFullscreen();
      }
    } catch (e) {
      if (mountedRef.current) callbacksRef.current.onError?.(e);
    }

    setTimeout(() => {
      if (mountedRef.current) playerRef.current?.trigger('resize');
    }, 50);
  }, [getTechVideoEl]);

  const togglePiP = useCallback(async () => {
    const v = getTechVideoEl();
    if (!v) return;
    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
      } else if (
        document.pictureInPictureEnabled &&
        (v as any).requestPictureInPicture
      ) {
        await (v as any).requestPictureInPicture();
      } else if ((v as any).webkitSetPresentationMode) {
        const mode = (v as any).webkitPresentationMode;
        (v as any).webkitSetPresentationMode(
          mode === 'picture-in-picture' ? 'inline' : 'picture-in-picture',
        );
      }
    } catch (e) {
      if (mountedRef.current) callbacksRef.current.onError?.(e);
    }
  }, [getTechVideoEl]);

  const attachIosFullscreen = useCallback(
    (videoEl: WebKitHTMLVideoElement | null) => {
      const prev = iosFsRef.current;
      if (prev.video && prev.video !== videoEl && prev.onBegin && prev.onEnd) {
        prev.video.removeEventListener('webkitbeginfullscreen', prev.onBegin);
        prev.video.removeEventListener('webkitendfullscreen', prev.onEnd);
      }
      if (!videoEl) {
        iosFsRef.current = { video: null, onBegin: null, onEnd: null };
        return;
      }
      if (prev.video === videoEl) return;
      if (!videoEl.webkitEnterFullscreen) {
        iosFsRef.current = { video: null, onBegin: null, onEnd: null };
        return;
      }
      const onBegin = () => {
        if (mountedRef.current) setIsFullscreen(true);
      };
      const onEnd = () => {
        if (mountedRef.current) setIsFullscreen(false);
      };
      videoEl.addEventListener('webkitbeginfullscreen', onBegin);
      videoEl.addEventListener('webkitendfullscreen', onEnd);
      iosFsRef.current = { video: videoEl, onBegin, onEnd };
    },
    [],
  );

  const attachPiPListeners = useCallback((videoEl: HTMLVideoElement | null) => {
    const prev = pipRef.current;
    if (prev.video && prev.video !== videoEl && prev.onEnter && prev.onLeave) {
      prev.video.removeEventListener('enterpictureinpicture', prev.onEnter);
      prev.video.removeEventListener('leavepictureinpicture', prev.onLeave);
      prev.video.removeEventListener(
        'webkitpresentationmodechanged' as any,
        (prev as any).iosListener,
      );
    }
    if (!videoEl) {
      pipRef.current = { video: null, onEnter: null, onLeave: null };
      return;
    }
    if (prev.video === videoEl) return;
    const onEnter = () => {
      if (mountedRef.current) setIsPiPActive(true);
    };
    const onLeave = () => {
      if (mountedRef.current) setIsPiPActive(false);
    };
    const iosListener = () => {
      const mode = (videoEl as any).webkitPresentationMode;
      if (mountedRef.current) setIsPiPActive(mode === 'picture-in-picture');
    };

    if (mountedRef.current)
      setIsPiPActive(document.pictureInPictureElement === videoEl);
    videoEl.addEventListener('enterpictureinpicture', onEnter);
    videoEl.addEventListener('leavepictureinpicture', onLeave);
    videoEl.addEventListener(
      'webkitpresentationmodechanged' as any,
      iosListener,
    );

    pipRef.current = { video: videoEl, onEnter, onLeave, iosListener } as any;
  }, []);

  const disableCasHard = useCallback(() => {
    setCasEnabled(false);
    casEnabledRef.current = false;
    try {
      localStorage.setItem('lunatv_cas_enabled', 'false');
    } catch {
      /* */
    }
    const v = getTechVideoEl();
    if (v) {
      v.style.opacity = '1';
      v.removeAttribute('data-cas-active');
      try {
        delete (v as any).dataset?.casOwner;
      } catch {
        /* empty */
      }
      v.removeAttribute('crossorigin');
      const parent = v.parentElement;
      if (parent)
        parent
          .querySelectorAll('canvas[data-cas-canvas="1"]')
          .forEach((c) => c.remove());
    }
    bumpTechEpoch();
  }, [bumpTechEpoch, getTechVideoEl]);

  const toggleCas = useCallback(() => {
    setCasEnabled((p) => {
      const n = !p;
      casEnabledRef.current = n;
      try {
        localStorage.setItem('lunatv_cas_enabled', n.toString());
      } catch {
        /* */
      }
      const video = getTechVideoEl();
      if (video) {
        if (n) {
          video.crossOrigin = 'anonymous';
        } else {
          video.removeAttribute('crossorigin');
        }
        bumpTechEpoch();
      }
      return n;
    });
  }, [getTechVideoEl, bumpTechEpoch]);

  const changeSpeed = useCallback(
    (rate: number) => {
      const safe = Number.isFinite(rate) ? rate : 1;
      setPlaybackRate(safe);
      playbackRateRef.current = safe;
      try {
        localStorage.setItem(`lunatv_speed_${seriesId}`, String(safe));
      } catch {
        /* */
      }
      playerRef.current?.playbackRate?.(safe);
    },
    [seriesId],
  );

  useEffect(() => {
    const p = playerRef.current;
    if (!p || typeof p.inactivityTimeout !== 'function') return;

    if (isUiInteracting) {
      p.inactivityTimeout(0); // Disable
      p.userActive?.(true);
    } else {
      const original = inactivityTimeoutRef.current ?? 2000;
      p.inactivityTimeout(original);
      p.reportUserActivity?.({});
    }
  }, [isUiInteracting]);

  const onTapStart = useCallback((e: ReactPointerEvent) => {
    tapGateRef.current.down = true;
    tapGateRef.current.moved = false;
    tapGateRef.current.startX = e.clientX;
    tapGateRef.current.startY = e.clientY;
  }, []);

  const onTapMove = useCallback((e: ReactPointerEvent) => {
    if (!tapGateRef.current.down) return;
    const dx = Math.abs(e.clientX - tapGateRef.current.startX);
    const dy = Math.abs(e.clientY - tapGateRef.current.startY);
    if (dx > 10 || dy > 10) tapGateRef.current.moved = true;
  }, []);

  const onTapEnd = useCallback(() => {
    tapGateRef.current.down = false;
  }, []);

  const onTapToggleControls = useCallback(() => {
    if (tapGateRef.current.moved) return;
    if (isScrubbing) return;

    const now = Date.now();
    if (now - lastToggleTimeRef.current < 200) return;
    lastToggleTimeRef.current = now;

    if (settingsOpen) {
      setSettingsOpen(false);
      const p = playerRef.current;
      p?.userActive?.(true);
      p?.reportUserActivity?.({});
      return;
    }

    const player = playerRef.current;
    if (!player) return;
    if (player.userActive?.()) {
      player.userActive?.(false);
    } else {
      player.userActive?.(true);
    }
  }, [isScrubbing, settingsOpen]);

  // FIX: Native HLS Priority + Retry Logic
  const initHls = useCallback(
    async (videoEl: HTMLVideoElement, sourceUrl: string) => {
      if (!sourceUrl) return;

      // PROXY FIX:
      // 1. allowCORS=false -> Forces Go to rewrite segments (fixes CAS/Tainted Canvas)
      // 2. moontv-source -> Passes seriesId so Go uses correct User-Agent/Referer
      let proxyUrl = sourceUrl;
      // Prevent double-proxying if sourceUrl is already processed
      if (!sourceUrl.includes('/api/proxy/')) {
        proxyUrl = `/api/proxy/m3u8?url=${encodeURIComponent(
          sourceUrl,
        )}&allowCORS=false&moontv-source=${encodeURIComponent(
          seriesId || 'global',
        )}`;
      }

      // 1. Prefer Native HLS (Safari/iOS)
      if (videoEl.canPlayType('application/vnd.apple.mpegurl')) {
        if (hlsCleanupRef.current) {
          hlsCleanupRef.current();
          hlsCleanupRef.current = null;
        } else if (hlsRef.current) {
          try {
            hlsRef.current.destroy();
          } catch {
            /* empty */
          }
          hlsRef.current = null;
        }
        // FIX: Clean up previous listener to prevent race conditions
        const prev = nativeAutoplayRef.current;
        if (prev.video && prev.handler) {
          prev.video.removeEventListener('loadedmetadata', prev.handler);
          prev.video.removeEventListener('canplay', prev.handler);
        }

        videoEl.src = proxyUrl;
        try {
          videoEl.load();
        } catch {
          /* empty */
        }

        // FIX: Arm autoplay with switch-safe handler
        if (configRef.current.autoPlay) {
          // Capture current epoch to ignore stale events from previous sources
          const myEpoch = switchEpochRef.current;

          const handler = () => {
            if (!mountedRef.current) return;
            // If user switched channel again before this fired, ignore it
            if (switchEpochRef.current !== myEpoch) return;

            playerRef.current?.play?.()?.catch(() => {
              if (mountedRef.current) setControlsVisible(true);
            });
          };

          nativeAutoplayRef.current = { video: videoEl, handler };

          videoEl.addEventListener('loadedmetadata', handler, { once: true });
          videoEl.addEventListener('canplay', handler, { once: true });
        } else {
          nativeAutoplayRef.current = { video: videoEl, handler: null };
        }
        return;
      }

      // 2. Fallback to Hls.js
      let targetEl = videoEl;
      if (!targetEl || !targetEl.isConnected) {
        const fresh = getTechVideoEl();
        if (fresh) targetEl = fresh;
      }
      if (!targetEl) {
        if (mountedRef.current)
          callbacksRef.current.onError?.({
            type: 'init_error',
            message: 'Video element not found for HLS',
          });
        return;
      }

      networkErrorCountRef.current = 0;
      if (hlsCleanupRef.current) {
        hlsCleanupRef.current();
        hlsCleanupRef.current = null;
      } else if (hlsRef.current) {
        try {
          hlsRef.current.destroy();
        } catch {
          /* empty */
        }
        hlsRef.current = null;
      }

      if (!Hls.isSupported()) {
        if (mountedRef.current)
          callbacksRef.current.onError?.({ type: 'hls_not_supported' });
        return;
      }

      try {
        targetEl.removeAttribute('src');
        targetEl.load();
      } catch {
        /* empty */
      }

      const hlsConfig: Partial<typeof Hls.DefaultConfig> = {
        debug,
        enableWorker: true,
        lowLatencyMode: isLive,
        loader: customHlsLoader || Hls.DefaultConfig.loader,
        ...(isLive
          ? {
              liveSyncDurationCount: 3,
              liveMaxLatencyDurationCount: 10,
              liveBackBufferLength: 30,
              maxBufferLength: 30,
              maxMaxBufferLength: 60,
            }
          : {}),
      };
      const hls = new Hls(hlsConfig as typeof Hls.DefaultConfig);
      hlsRef.current = hls;

      const onMediaAttached = () => {
        if (hlsRef.current === hls) hls.loadSource(proxyUrl);
      };
      const onFragLoaded = () => {
        if (hlsRef.current === hls) networkErrorCountRef.current = 0;
      };
      const onManifestParsed = () => {
        if (hlsRef.current !== hls || !mountedRef.current) return;
        if (configRef.current.autoPlay && playerRef.current?.paused())
          playerRef.current.play()?.catch(() => {
            if (mountedRef.current) setControlsVisible(true);
          });
      };

      const performCleanupAndDestroy = (err?: any) => {
        if (hlsCleanupRef.current) hlsCleanupRef.current = null;
        if (hlsRef.current === hls) hlsRef.current = null;
        try {
          hls.off(Hls.Events.MEDIA_ATTACHED, onMediaAttached);
        } catch {
          /* empty */
        }
        try {
          hls.off(Hls.Events.FRAG_LOADED, onFragLoaded);
        } catch {
          /* empty */
        }
        try {
          hls.off(Hls.Events.MANIFEST_PARSED, onManifestParsed);
        } catch {
          /* empty */
        }
        try {
          hls.off(Hls.Events.ERROR, onErrorHandler);
        } catch {
          /* empty */
        }
        try {
          hls.stopLoad();
          hls.detachMedia();
          hls.destroy();
        } catch {
          /* empty */
        }
        if (err && mountedRef.current) callbacksRef.current.onError?.(err);
      };

      const onErrorHandler = (_evt: unknown, data: any) => {
        if (hlsRef.current !== hls) return;
        if (data?.fatal) {
          if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
            networkErrorCountRef.current += 1;
            if (networkErrorCountRef.current >= 3)
              performCleanupAndDestroy({
                type: 'network_error',
                fatal: true,
                original: data,
              });
            else {
              try {
                hls.startLoad();
              } catch {
                performCleanupAndDestroy(data);
              }
            }
          } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
            try {
              hls.recoverMediaError();
            } catch {
              performCleanupAndDestroy(data);
            }
          } else {
            performCleanupAndDestroy(data);
          }
        }
      };

      hlsCleanupRef.current = () => performCleanupAndDestroy();
      hls.on(Hls.Events.MEDIA_ATTACHED, onMediaAttached);
      hls.on(Hls.Events.FRAG_LOADED, onFragLoaded);
      hls.on(Hls.Events.MANIFEST_PARSED, onManifestParsed);
      hls.on(Hls.Events.ERROR, onErrorHandler);
      hls.attachMedia(targetEl);
    },
    // FIX: Added seriesId to dependencies so source updates on channel switch
    [customHlsLoader, debug, isLive, getTechVideoEl, seriesId],
  );

  // FIX: Complete Source Loading Pipeline (HLS + Native)
  useEffect(() => {
    if (!playerReady || !playerRef.current || !mountedRef.current) return;
    const player = playerRef.current;
    const epoch = ++switchEpochRef.current;

    const d = player.duration() ?? 0;
    const t = player.currentTime() ?? 0;
    const wasPlaying = !player.paused();
    const isFiniteDuration = Number.isFinite(d) && d > 0;
    if (!isLive && isFiniteDuration && t > 0 && t < d - 2) {
      switchSnapshotRef.current = { time: t, wasPlaying };
    } else {
      switchSnapshotRef.current = null;
    }

    let restoreArmed = true;
    let attachedVideoEl: HTMLVideoElement | null = null;
    const restore = () => {
      if (!mountedRef.current || !restoreArmed) return;
      if (switchEpochRef.current !== epoch) return;
      const snap = switchSnapshotRef.current;
      if (!snap) return;
      const seekable = player.seekable?.();
      let target = snap.time;
      if (seekable && seekable.length > 0) {
        const start = seekable.start(0);
        const end = seekable.end(seekable.length - 1);
        target = Math.min(Math.max(target, start), Math.max(start, end - 0.1));
      } else if (
        Number.isFinite(player.duration()) &&
        (player.duration() ?? 0) > 0
      ) {
        const dur = player.duration() ?? 0;
        target = Math.min(Math.max(target, 0), Math.max(0, dur - 0.1));
      }
      switchSnapshotRef.current = null;
      player.currentTime(target);
      if (snap.wasPlaying)
        player.play()?.catch(() => {
          if (mountedRef.current) setControlsVisible(true);
        });
    };

    hasSkippedIntroRef.current = false;
    hasTriggeredOutroRef.current = false;
    player.pause();
    player.playbackRate(playbackRateRef.current);
    player.poster(poster || '');

    const v = getTechVideoEl();
    const videoEl = v instanceof HTMLVideoElement ? v : null;
    if (videoEl) {
      if (casEnabledRef.current) {
        videoEl.crossOrigin = 'anonymous';
      } else {
        videoEl.removeAttribute('crossorigin');
      }
      attachIosFullscreen(videoEl as WebKitHTMLVideoElement);
      attachPiPListeners(videoEl);
      bumpTechEpoch();
      videoEl.addEventListener('loadedmetadata', restore, { once: true });
      attachedVideoEl = videoEl;
    } else {
      player.one('loadedmetadata', restore);
    }

    const isHlsMime =
      type === 'application/x-mpegURL' ||
      type === 'application/vnd.apple.mpegurl';
    const isHlsUrl =
      finalUrl?.includes('.m3u8') ||
      finalUrl?.includes('/proxy/m3u8') ||
      finalUrl?.includes('m3u8?');
    const isFlvUrl =
      finalUrl?.includes('.flv') ||
      finalUrl?.includes('/proxy/flv') ||
      finalUrl?.includes('flv?');

    const loadSource = (src: string, mime?: string) =>
      player.src({ src, type: mime });

    // FIX: Async Epoch-Guarded HLS Loading
    if (isHlsMime || (!type && isHlsUrl)) {
      (async () => {
        const myEpoch = epoch;
        // Native HLS check first
        const v = getTechVideoEl() || (await waitForVideo(500));
        if (!mountedRef.current || switchEpochRef.current !== myEpoch) return;

        if (v) {
          // Let initHls handle native vs hls.js split
          initHls(v, finalUrl);
          if (configRef.current.autoPlay && v.readyState >= 2) {
            player.play()?.catch(() => {
              if (mountedRef.current) setControlsVisible(true);
            });
          }
        } else {
          if (mountedRef.current)
            callbacksRef.current.onError?.({
              type: 'init_error',
              message: 'Video element not found for HLS',
            });
        }
      })();
    } else {
      if (hlsCleanupRef.current) {
        hlsCleanupRef.current();
        hlsCleanupRef.current = null;
      } else if (hlsRef.current) {
        try {
          hlsRef.current.destroy();
        } catch {
          /* empty */
        }
        hlsRef.current = null;
      }

      // --- START FIX: Safe Proxy Routing ---
      let srcToLoad = finalUrl;

      // Check protocol case-insensitively
      if (/^https?:\/\//i.test(finalUrl)) {
        const encodedUrl = encodeURIComponent(finalUrl);
        const sourceParam = encodeURIComponent(seriesId || 'global');

        if (isFlvUrl) {
          // FLV needs infinite timeout -> use /flv endpoint
          srcToLoad = `/api/proxy/flv?url=${encodedUrl}&moontv-source=${sourceParam}`;
        } else {
          // MP4/General needs finite timeout + Range support -> use /key endpoint (30s)
          srcToLoad = `/api/proxy/key?url=${encodedUrl}&moontv-source=${sourceParam}`;
        }
      }

      if (isFlvUrl) loadSource(srcToLoad, 'video/x-flv');
      else loadSource(srcToLoad, type || 'video/mp4');
      // --- END FIX ---

      const tryAutoPlay = () => {
        if (!mountedRef.current || !configRef.current.autoPlay) return;
        player.play()?.catch(() => {
          if (mountedRef.current) setControlsVisible(true);
        });
      };

      if (firstLoadRef.current) {
        firstLoadRef.current = false;
        tryAutoPlay();
      } else {
        if (mountedRef.current) unifiedSeekRef.current.cancel();
        player.one('canplay', tryAutoPlay);
      }
    }

    return () => {
      restoreArmed = false;
      if (attachedVideoEl)
        attachedVideoEl.removeEventListener('loadedmetadata', restore);
      player.off?.('loadedmetadata', restore);
    };
  }, [
    finalUrl,
    type,
    poster,
    playerReady,
    initHls,
    attachIosFullscreen,
    attachPiPListeners,
    bumpTechEpoch,
    isLive,
    getTechVideoEl,
    waitForVideo,
    seriesId,
  ]);

  // FIX: Player Initialization & Event Binding (The Engine)
  useEffect(() => {
    if (!videoWrapperRef.current) return;
    const wrapper = videoWrapperRef.current;
    wrapper.innerHTML = '';
    const videoElement = document.createElement('video-js');
    Object.assign(videoElement.style, {
      position: 'absolute',
      top: '0',
      left: '0',
      width: '100%',
      height: '100%',
    });
    wrapper.appendChild(videoElement);

    const player = videojs(videoElement, {
      controls: false,
      autoplay: false,
      preload: 'auto',
      fluid: false,
      fill: true,
      poster,
      playsinline: true,
      userActions: { click: false, doubleClick: false },
      html5: { vhs: { overrideNative: false } },
      ...videoJsOptions,
    }) as unknown as VideoJsPlayerInstance;

    playerRef.current = player;

    const handleUserActive = () => {
      if (mountedRef.current) setControlsVisible(true);
    };
    const handleUserInactive = () => {
      if (mountedRef.current) {
        setControlsVisible(false);
        setSettingsOpen(false);
      }
    };

    player.ready(() => {
      if (mountedRef.current) setPlayerReady(true);
      if (mountedRef.current)
        callbacksRef.current.onReady?.(player as unknown as Player);
      const v = player.tech?.(true)?.el?.();
      if (v instanceof HTMLVideoElement) {
        if (casEnabledRef.current) {
          v.crossOrigin = 'anonymous';
        } else {
          v.removeAttribute('crossorigin');
        }
        attachIosFullscreen(v as WebKitHTMLVideoElement);
        attachPiPListeners(v);
        bumpTechEpoch();
      }
    });

    const handleLoadStart = () => {
      const v = player.tech?.(true)?.el?.();
      if (v instanceof HTMLVideoElement) {
        if (casEnabledRef.current) {
          v.crossOrigin = 'anonymous';
        } else {
          v.removeAttribute('crossorigin');
        }
        attachIosFullscreen(v as WebKitHTMLVideoElement);
        attachPiPListeners(v);
        bumpTechEpoch();
      }
    };

    player.on('loadstart', handleLoadStart);
    player.on('useractive', handleUserActive);
    player.on('userinactive', handleUserInactive);
    player.on('play', () => {
      if (mountedRef.current) {
        setIsPaused(false);
        callbacksRef.current.onPlay?.();
      }
    });
    player.on('pause', () => {
      if (mountedRef.current) {
        setIsPaused(true);
        callbacksRef.current.onPause?.();
      }
    });
    player.on('ended', () => {
      if (mountedRef.current && !hasTriggeredOutroRef.current)
        callbacksRef.current.onEnded?.();
    });
    player.on('error', () => {
      if (mountedRef.current) callbacksRef.current.onError?.(player.error());
    });
    player.on('durationchange', () => {
      if (mountedRef.current) setDuration(player.duration() || 0);
    });

    // FIX: Guarded timeupdate to stop scrubbing jumps via Refs
    player.on('timeupdate', () => {
      if (!mountedRef.current) return;
      const t = player.currentTime() || 0;

      // FIX: Prefer native duration for HLS if Video.js reports 0/Inf
      let d = player.duration() || 0;
      if (!Number.isFinite(d) || d <= 0) {
        const nativeEl = player.tech?.(true)?.el?.();
        if (nativeEl instanceof HTMLVideoElement) {
          const nd = nativeEl.duration;
          if (Number.isFinite(nd) && nd > 0) d = nd;
        }
      }

      // FIX: Push valid duration to state
      if (Number.isFinite(d) && d > 0) {
        setDuration((prev) => (prev !== d ? d : prev));
      }

      const scrubbing =
        isScrubbingRef.current ||
        seekingTimeRef.current !== null ||
        unifiedSeekRef.current.isActive();
      if (!scrubbing) setCurrentTime(t);

      callbacksRef.current.onTimeUpdate?.(t, d);

      if (scrubbing) return;

      const { enableSkip, skipIntroTime, skipOutroTime } = configRef.current;
      if (enableSkip) {
        if (
          skipIntroTime > 0 &&
          t < skipIntroTime &&
          !hasSkippedIntroRef.current
        ) {
          player.currentTime(skipIntroTime);
          hasSkippedIntroRef.current = true;
        }
        if (
          skipOutroTime > 0 &&
          d > 0 &&
          d - t <= skipOutroTime &&
          !hasTriggeredOutroRef.current
        ) {
          hasTriggeredOutroRef.current = true;
          player.pause();
          callbacksRef.current.onEnded?.();
        }
      }
    });

    return () => {
      player.off('loadstart', handleLoadStart);
      player.off('useractive', handleUserActive);
      player.off('userinactive', handleUserInactive);
      attachIosFullscreen(null);
      attachPiPListeners(null);
      if (hlsCleanupRef.current) {
        hlsCleanupRef.current();
        hlsCleanupRef.current = null;
      } else if (hlsRef.current) {
        try {
          hlsRef.current.destroy();
        } catch {
          /* empty */
        }
        hlsRef.current = null;
      }

      // FIX: Cleanup native autoplay listeners on unmount/dispose
      const prevNative = nativeAutoplayRef.current;
      if (prevNative.video && prevNative.handler) {
        prevNative.video.removeEventListener(
          'loadedmetadata',
          prevNative.handler,
        );
        prevNative.video.removeEventListener('canplay', prevNative.handler);
      }
      nativeAutoplayRef.current = { video: null, handler: null };

      player.dispose();
      playerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useCasShader(
    playerReady,
    casEnabled,
    getTechVideoEl,
    isPiPActive,
    debug,
    techEpoch,
    disableCasHard,
  );

  // FIX: Fullscreen Sync Effect
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const onFsChange = () => {
      if (!mountedRef.current) return;
      setIsFullscreen(
        !!document.fullscreenElement ||
          !!(document as any).webkitFullscreenElement,
      );
    };
    document.addEventListener('fullscreenchange', onFsChange);
    document.addEventListener('webkitfullscreenchange', onFsChange);
    return () => {
      document.removeEventListener('fullscreenchange', onFsChange);
      document.removeEventListener('webkitfullscreenchange', onFsChange);
    };
  }, []);

  // FIX: PiP Support Check with iOS Fallback
  useEffect(() => {
    if (typeof document !== 'undefined' && mountedRef.current) {
      const v = getTechVideoEl();
      const supported =
        (!!document.pictureInPictureEnabled &&
          !!v &&
          typeof (v as any).requestPictureInPicture === 'function') ||
        (!!v && typeof (v as any).webkitSetPresentationMode === 'function');
      setPipSupported(supported);
    }
  }, [playerReady, techEpoch, getTechVideoEl]);

  const formatTime = (s: number) => {
    if (!Number.isFinite(s)) return '0:00';
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = Math.floor(s % 60);
    return h > 0
      ? `${h}:${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`
      : `${m}:${sec.toString().padStart(2, '0')}`;
  };

  const displayTime = seekingTime ?? currentTime;
  const progress = duration > 0 ? (displayTime / duration) * 100 : 0;

  return (
    <div className={`player-container ${className}`} ref={containerRef}>
      <div ref={videoWrapperRef} className='video-wrapper' />
      <div
        className='tap-layer'
        onPointerDown={onTapStart}
        onPointerMove={(e) => {
          onTapMove(e);
          if (playerRef.current) playerRef.current.reportUserActivity?.({});
        }}
        onPointerUp={(e) => {
          if (e.pointerType === 'mouse' && e.button !== 0) return;
          onTapEnd();
          onTapToggleControls();
        }}
        onPointerCancel={onTapEnd}
        onPointerLeave={onTapEnd}
        style={{
          touchAction: isRotatedFullscreen ? 'none' : 'pan-y',
          userSelect: 'none',
        }}
      />
      <div
        className={`player-controls ${controlsVisible ? 'visible' : ''}`}
        aria-hidden={!controlsVisible}
      >
        <div
          className='top-bar'
          onPointerMove={(e) => markUiInteraction(e)}
          onPointerDown={(e) => markUiInteraction(e)}
        >
          <button
            type='button'
            className='ctrl-btn'
            onClick={(e) => {
              markUiInteraction(e, { stop: true });
              setSettingsOpen((s) => !s);
            }}
            title='Settings'
            aria-label='Settings'
          >
            {Icons.settings}
          </button>
        </div>
        <button
          className='rotate-fullscreen-btn'
          onClick={(e) => {
            e.stopPropagation();
            toggleRotatedFullscreen();
          }}
          title='Page Fullscreen'
          aria-label='Page Fullscreen'
        >
          {Icons.rotate}
        </button>
        <div className='center-area'>
          <button
            type='button'
            className='big-play-btn'
            onClick={(e) => {
              e.stopPropagation();
              togglePlay();
            }}
            aria-label={isPaused ? 'Play' : 'Pause'}
          >
            {isPaused ? Icons.bigPlay : Icons.bigPause}
          </button>
        </div>
        <div
          className='bottom-bar'
          onPointerMove={(e) => markUiInteraction(e)}
          onPointerDown={(e) => markUiInteraction(e)}
        >
          <button
            type='button'
            className='ctrl-btn'
            onClick={(e) => {
              markUiInteraction(e);
              togglePlay();
            }}
            aria-label={isPaused ? 'Play' : 'Pause'}
          >
            {isPaused ? Icons.play : Icons.pause}
          </button>
          {hasNextEpisode && (
            <button
              type='button'
              className='ctrl-btn'
              onClick={(e) => {
                markUiInteraction(e);
                onNextEpisode?.();
              }}
              title='Next'
              aria-label='Next Episode'
            >
              {Icons.next}
            </button>
          )}
          <div className='time-display'>
            {formatTime(seekingTime ?? currentTime)}
          </div>
          <div
            ref={progressBarRef}
            className='progress-bar'
            role='slider'
            aria-label='Seek slider'
            aria-valuemin={0}
            aria-valuemax={duration}
            aria-valuenow={seekingTime ?? currentTime}
            tabIndex={0}
            onKeyDown={(e) => {
              markUiInteraction(e);
              let newTime = -1;
              if (e.key === 'ArrowRight')
                newTime = Math.min((seekingTime ?? currentTime) + 5, duration);
              else if (e.key === 'ArrowLeft')
                newTime = Math.max((seekingTime ?? currentTime) - 5, 0);
              else if (e.key === ' ' || e.key === 'Enter') {
                e.preventDefault();
                togglePlay();
                return;
              }
              if (newTime !== -1 && playerRef.current) {
                e.preventDefault();
                playerRef.current.currentTime(newTime);
                setCurrentTime(newTime);
              }
            }}
            onClick={(e) => markUiInteraction(e)}
            onPointerDown={(e) => {
              markUiInteraction(e);
              handleScrubStart(e);
            }}
          >
            <div className='progress-track'>
              <div
                className='progress-fill'
                style={{ width: `${progress}%` }}
              />
              <div
                className='progress-thumb'
                style={{
                  left: `${progress}%`,
                  transform: isScrubbing
                    ? 'translate(-50%, -50%) scale(1.5)'
                    : 'translate(-50%, -50%)',
                }}
              />
            </div>
          </div>
          <div className='time-display'>{formatTime(duration)}</div>
          {pipSupported && (
            <button
              type='button'
              className={`ctrl-btn ${isPiPActive ? 'pip-active' : ''}`}
              onClick={(e) => {
                markUiInteraction(e);
                togglePiP();
              }}
              title='Picture-in-Picture'
              aria-label='Picture-in-Picture'
            >
              {Icons.pip}
            </button>
          )}
          {hasAirPlay && (
            <button
              type='button'
              className='ctrl-btn'
              onClick={(e) => {
                markUiInteraction(e);
                const video = getTechVideoEl();
                video?.webkitShowPlaybackTargetPicker?.();
              }}
              title='AirPlay'
              aria-label='AirPlay'
            >
              {Icons.airplay}
            </button>
          )}
          <button
            type='button'
            className='ctrl-btn'
            onClick={(e) => {
              markUiInteraction(e);
              toggleFullscreen();
            }}
            title='Fullscreen'
            aria-label={isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}
          >
            {isFullscreen ? Icons.exitFullscreen : Icons.fullscreen}
          </button>
        </div>

        {settingsOpen && (
          <div
            className='settings-popup'
            // FIX: Native picker support (keep awake on focus, release on blur)
            onFocusCapture={() => {
              if (uiInteractTimeoutRef.current)
                clearTimeout(uiInteractTimeoutRef.current);
              setIsUiInteracting(true);
              const p = playerRef.current;
              if (p) {
                p.userActive?.(true);
                p.inactivityTimeout?.(0);
              }
            }}
            onBlurCapture={() => {
              markUiInteraction();
            }}
            onPointerDown={(e) => markUiInteraction(e, { stop: true })}
            onPointerMove={(e) => markUiInteraction(e, { stop: true })}
            onPointerUp={(e) => markUiInteraction(e, { stop: true })}
            onWheel={(e) => markUiInteraction(e, { stop: true })}
            onKeyDown={(e) => markUiInteraction(e, { stop: true })}
            onScrollCapture={(e) => markUiInteraction(e, { stop: true })}
          >
            <div className='settings-header'>Settings</div>
            <button
              type='button'
              className='settings-item'
              onClick={(e) => {
                markUiInteraction(e, { stop: true });
                toggleCas();
              }}
            >
              <span>Enhance HD</span>
              <div className={`toggle ${casEnabled ? 'on' : ''}`}>
                <div className='toggle-knob' />
              </div>
            </button>
            <div className='settings-item'>
              <span>Speed</span>
              <select
                value={playbackRate}
                onPointerDown={(e) => markUiInteraction(e, { stop: true })}
                onChange={(e) => {
                  changeSpeed(parseFloat(e.target.value));
                  const p = playerRef.current;
                  p?.userActive?.(true);
                  p?.reportUserActivity?.({});
                }}
              >
                {[0.5, 0.75, 1, 1.25, 1.5, 2].map((r) => (
                  <option key={r} value={r}>
                    {r}x
                  </option>
                ))}
              </select>
            </div>
          </div>
        )}
      </div>
      {seekingTime !== null && (
        <div className='seek-overlay'>
          <div className='seek-time'>
            {formatTime(seekingTime)} / {formatTime(duration)}
          </div>
          <div className='seek-bar'>
            <div
              className='seek-fill'
              style={{ width: `${(seekingTime / (duration || 1)) * 100}%` }}
            />
          </div>
        </div>
      )}
    </div>
  );
}

const CSS = `
.player-container{position:relative;width:100%;height:100%;background:#000;overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;user-select:none}
.video-wrapper{position:absolute;inset:0}
.player-container .video-js{position:absolute;inset:0;width:100%;height:100%}
.player-container .vjs-control-bar,.player-container .vjs-big-play-button,.player-container .vjs-touch-overlay,.player-container .vjs-mobile-ui-play-toggle,.player-container .vjs-loading-spinner,.player-container .vjs-modal-dialog{display:none!important}
.icon{width:24px;height:24px;display:block}
.tap-layer{position:absolute;inset:0;z-index:9;pointer-events:auto;background:transparent}

/* Controls Container */
.player-controls{position:absolute;inset:0;display:flex;flex-direction:column;justify-content:space-between;opacity:0;transition:opacity .3s;pointer-events:none;z-index:10}
.player-controls.visible{opacity:1}
.player-controls::before{content:'';position:absolute;inset:0;pointer-events:none;background:linear-gradient(to bottom,rgba(0,0,0,.6) 0%,transparent 25%,transparent 75%,rgba(0,0,0,.8) 100%)}

.top-bar,.bottom-bar{position:relative;pointer-events:none;z-index:11}
.top-bar,.bottom-bar{display:flex;align-items:center;gap:8px;padding:12px 16px}
.top-bar{justify-content:flex-end}
.bottom-bar{padding-bottom:max(12px,env(safe-area-inset-bottom))}

.ctrl-btn{width:44px;height:44px;display:flex;align-items:center;justify-content:center;background:transparent;border:none;color:#fff;cursor:pointer;padding:0;border-radius:8px;transition:background .2s;flex-shrink:0}
.ctrl-btn:hover{background:rgba(255,255,255,.1)}
.ctrl-btn:active{background:rgba(255,255,255,.2);transform:scale(.95)}
.ctrl-btn.pip-active{color:#4CAF50}
.speed-btn{font-size:13px;font-weight:600;min-width:44px}

.center-area{flex:1;display:flex;align-items:center;justify-content:center;gap:20px;pointer-events:none;z-index:11}
.big-play-btn{width:80px;height:80px;border-radius:50%;background:rgba(0,0,0,0.6);border:2px solid rgba(255,255,255,0.8);color:white;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(4px);cursor:pointer;pointer-events:auto;transition:all 0.2s}
.big-play-btn:hover{transform:scale(1.1);background:rgba(0,0,0,0.8)}
.big-play-btn:active{transform:scale(0.95)}

.rotate-fullscreen-btn{position:absolute;left:16px;top:50%;transform:translateY(-50%);width:44px;height:44px;border-radius:50%;background:rgba(0,0,0,.5);border:1px solid rgba(255,255,255,.3);color:#fff;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(4px);transition:transform .2s,background .2s;cursor:pointer;z-index:12;pointer-events:none}
.player-controls.visible .rotate-fullscreen-btn { pointer-events: auto; }
.rotate-fullscreen-btn:hover{background:rgba(0,0,0,.7)}
.rotate-fullscreen-btn:active{transform:translateY(-50%) scale(.95)}

.time-display{font-size:13px;color:#fff;font-variant-numeric:tabular-nums;min-width:45px;text-align:center;flex-shrink:0}
.progress-bar{flex:1;height:44px;display:flex;align-items:center;cursor:pointer;padding:0 4px;min-width:60px;touch-action:none}
.progress-track{position:relative;width:100%;height:4px;background:rgba(255,255,255,.3);border-radius:2px}
.progress-fill{height:100%;background:#4CAF50;border-radius:2px}
.progress-thumb{position:absolute;top:50%;width:14px;height:14px;background:#fff;border-radius:50%;transform:translate(-50%,-50%);box-shadow:0 2px 4px rgba(0,0,0,.3)}

/* Settings Popup */
.settings-popup{position:absolute;top:60px;right:16px;background:rgba(28,28,30,.95);backdrop-filter:blur(20px);border-radius:12px;padding:8px 0;min-width:200px;border:1px solid rgba(255,255,255,.1);max-height:70vh;overflow-y:auto;-webkit-overflow-scrolling:touch;scrollbar-width:thin; z-index: 12; pointer-events: auto;}

.settings-header{padding:12px 16px;font-size:15px;font-weight:600;color:#fff;border-bottom:1px solid rgba(255,255,255,.1)}
.settings-item{display:flex;justify-content:space-between;align-items:center;padding:12px 16px;color:#fff;cursor:pointer;font-size:14px;width:100%;border:none;background:transparent;text-align:left}
.settings-item:hover{background:rgba(255,255,255,.05)}
.settings-item select{background:transparent;border:1px solid rgba(255,255,255,.2);color:#fff;padding:4px 8px;border-radius:6px;font-size:13px}
.toggle{width:44px;height:26px;background:#555;border-radius:13px;position:relative;transition:background .2s;flex-shrink:0}
.toggle.on{background:#4CAF50}
.toggle-knob{position:absolute;top:3px;left:3px;width:20px;height:20px;background:#fff;border-radius:50%;transition:left .2s}
.toggle.on .toggle-knob { left: 21px; }

.seek-overlay{position:absolute;inset:0;background:rgba(0,0,0,.7);display:flex;flex-direction:column;align-items:center;justify-content:center;z-index:50;pointer-events:none}
.seek-time{font-size:32px;font-weight:600;color:#fff;margin-bottom:16px}
.seek-bar{width:70%;height:6px;background:rgba(255,255,255,.3);border-radius:3px;overflow:hidden}
.seek-fill{height:100%;background:#4CAF50;border-radius:2px}
.videojs-rotated-fullscreen{position:fixed!important;width:100vh!important;height:100vw!important;top:50%!important;left:50%!important;transform:translate(-50%,-50%) rotate(90deg)!important;z-index:99999!important;background:#000!important}
@supports(width:100dvh){.videojs-rotated-fullscreen{width:100dvh!important;height:100dvw!important}}
@media(max-width:480px){.ctrl-btn{width:40px;height:40px}.time-display{font-size:12px;min-width:38px}.speed-btn{font-size:12px;min-width:40px}}

/* FIX: Explicitly bless the popup so it works when controls are visible */
.player-controls.visible .top-bar,.player-controls.visible .bottom-bar,.player-controls.visible .big-play-btn, .player-controls.visible .settings-popup {pointer-events:auto}
.player-controls:not(.visible) *{pointer-events:none!important}
`;
