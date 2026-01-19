/* eslint-disable @typescript-eslint/no-explicit-any */
'use client';

import Hls from 'hls.js';
import type { MutableRefObject } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import videojs from 'video.js';
import Player from 'video.js/dist/types/player';
import 'videojs-flvjs';

import 'video.js/dist/video-js.css';

// --- Types ---
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
  videoJsOptions?: any;
  reloadTrigger?: number;
}

interface VideoJsPlayerInstance extends Player {
  // Relaxed type to avoid conflicts with base Player interface
  tech(safety?: boolean): any;
}

// --- Icons ---
const Icons = {
  Play: () => (
    <svg viewBox='0 0 24 24' fill='currentColor' className='w-8 h-8'>
      <path d='M8 5v14l11-7z' />
    </svg>
  ),
  Pause: () => (
    <svg viewBox='0 0 24 24' fill='currentColor' className='w-8 h-8'>
      <path d='M6 19h4V5H6v14zm8-14v14h4V5h-4z' />
    </svg>
  ),
  Next: () => (
    <svg viewBox='0 0 24 24' fill='currentColor' className='w-8 h-8'>
      <path d='M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z' />
    </svg>
  ),
  Settings: () => (
    <svg viewBox='0 0 24 24' fill='currentColor' className='w-6 h-6'>
      <path d='M19.14 12.94c.04-.31.06-.63.06-.94 0-.31-.02-.63-.06-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z' />
    </svg>
  ),
  Maximize: () => (
    <svg viewBox='0 0 24 24' fill='currentColor' className='w-6 h-6'>
      <path d='M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z' />
    </svg>
  ),
  Minimize: () => (
    <svg viewBox='0 0 24 24' fill='currentColor' className='w-6 h-6'>
      <path d='M5 16h3v3h2v-5H5v2zm3-8H5v2h5V5H8v3zm6 11h2v-3h3v-2h-5v5zm2-11V5h-2v5h5V8h-3z' />
    </svg>
  ),
  Pip: () => (
    <svg viewBox='0 0 24 24' fill='currentColor' className='w-6 h-6'>
      <path d='M19 11h-8v6h8v-6zm4 8V4.98C23 3.88 22.1 3 21 3H3c-1.1 0-2 .88-2 1.98V19c0 1.1.9 2 2 2h18c1.1 0 2-.9 2-2zm-2 .02H3V4.97h18v14.05z' />
    </svg>
  ),
  Airplay: () => (
    <svg viewBox='0 0 24 24' fill='currentColor' className='w-6 h-6'>
      <path d='M6 22h12l-6-6-6 6zM21 3H3c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h4v-2H3V5h18v12h-4v2h4c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2z' />
    </svg>
  ),
  Rotate: () => (
    <svg viewBox='0 0 24 24' fill='currentColor' className='w-6 h-6'>
      <path d='M7.11 8.53L5.7 7.11C4.8 8.27 4.24 9.61 4.07 11h2.02c.14-.87.49-1.72 1.02-2.47zM6.09 13H4.07c.17 1.39.72 2.73 1.62 3.89l1.41-1.42c-.52-.75-.87-1.59-1.01-2.47zm1.01 5.32c1.16.9 2.51 1.44 3.9 1.61V17.9c-.87-.15-1.71-.49-2.46-1.03L7.1 18.32zM13 4.07V1L8.45 5.55 13 10V6.09c2.84.48 5 2.94 5 5.91s-2.16 5.43-5 5.91v2.02c3.95-.49 7-3.85 7-7.93s-3.05-7.44-7-7.93z' />
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
      lastPreviewRef.current = player?.currentTime?.() ?? 0;
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
        if (p && Number.isFinite(safe)) p.currentTime(safe);
      });
    },
    [playerRef, setCurrentTime, setSeekingTime],
  );

  const end = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    const player = playerRef.current;
    if (!seekRef.current.active) return;
    if (seekRef.current.showOverlay) setSeekingTime(null);

    if (player && Number.isFinite(lastPreviewRef.current))
      player.currentTime(lastPreviewRef.current);
    if (seekRef.current.wasPlaying) {
      player?.play()?.catch(() => player.trigger('useractive'));
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

  return { begin, preview, end, cancel, isActive };
};

const usePlayerGestures = (
  containerEl: HTMLDivElement | null,
  playerRef: MutableRefObject<VideoJsPlayerInstance | null>,
  duration: number,
  unifiedSeekRef: MutableRefObject<ReturnType<typeof useUnifiedSeek>>,
  controlsVisibleRef: MutableRefObject<boolean>,
  isRotatedRef: MutableRefObject<boolean>,
) => {
  const durationRef = useRef(duration);
  useEffect(() => {
    durationRef.current = duration;
  }, [duration]);

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
    const container = containerEl;
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
      if (!e.isPrimary || (e.pointerType === 'mouse' && e.button !== 0)) return;
      // Z-index ensures we only catch background taps
      const g = gestureRef.current;
      g.pointerId = e.pointerId;
      g.startX = e.clientX;
      g.startY = e.clientY;
      g.active = true;
      g.isSeeking = false;
      g.captured = false;
      g.startVideoTime = playerRef.current?.currentTime() || 0;
    };

    const handleMove = (e: PointerEvent) => {
      const g = gestureRef.current;
      if (!g.active || (g.pointerId != null && e.pointerId !== g.pointerId))
        return;

      const dx = e.clientX - g.startX;
      const dy = e.clientY - g.startY;
      const isRotated = isRotatedRef.current;

      if (!g.isSeeking && (Math.abs(dx) > 10 || Math.abs(dy) > 10)) {
        const shouldSeek = isRotated
          ? Math.abs(dy) > Math.abs(dx)
          : Math.abs(dx) > Math.abs(dy);
        if (shouldSeek) {
          g.isSeeking = true;
          safeCapture(e.pointerId);
          if (e.cancelable) e.preventDefault();
          unifiedSeekRef.current.begin({ showOverlay: true });
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
        const dim = isRotated ? container.clientHeight : container.clientWidth;
        const span = Math.max(1, dim);

        let activeDuration = durationRef.current;
        if (!Number.isFinite(activeDuration) || activeDuration <= 0) {
          const pDur = playerRef.current?.duration?.() ?? 0;
          if (Number.isFinite(pDur) && pDur > 0) activeDuration = pDur;
          else {
            const v = playerRef.current?.tech?.(true)?.el?.();
            const nDur = v instanceof HTMLVideoElement ? v.duration : 0;
            if (Number.isFinite(nDur) && nDur > 0) activeDuration = nDur;
            else return;
          }
        }

        const delta = isRotated ? dy : dx;
        const raw = g.startVideoTime + delta * (activeDuration / span) * 0.8;
        const clamped = Math.max(0, Math.min(activeDuration, raw));
        unifiedSeekRef.current.preview(clamped);
      }
    };

    const handleEnd = (e: PointerEvent) => {
      const g = gestureRef.current;
      if (g.pointerId != null && e.pointerId !== g.pointerId) return;
      if (g.captured) safeRelease(e.pointerId);

      if (g.isSeeking) {
        if (e.cancelable) e.preventDefault();
        e.stopPropagation();
        unifiedSeekRef.current.end();
      }

      g.active = false;
      g.isSeeking = false;
      g.pointerId = null;
      g.captured = false;
    };

    const handleLost = (e: Event) => {
      if (e instanceof PointerEvent) handleEnd(e);
      else {
        if (gestureRef.current.isSeeking) unifiedSeekRef.current.end();
        gestureRef.current.active = false;
        gestureRef.current.isSeeking = false;
        gestureRef.current.pointerId = null;
        gestureRef.current.captured = false;
      }
    };

    const opts = { passive: false };
    container.addEventListener('pointerdown', handleStart, opts);
    container.addEventListener('pointermove', handleMove, opts);
    container.addEventListener('pointerup', handleEnd, opts);
    container.addEventListener('pointercancel', handleEnd, opts);
    container.addEventListener('lostpointercapture', handleLost);

    return () => {
      container.removeEventListener('pointerdown', handleStart);
      container.removeEventListener('pointermove', handleMove);
      container.removeEventListener('pointerup', handleEnd);
      container.removeEventListener('pointercancel', handleEnd);
      container.removeEventListener('lostpointercapture', handleLost);
    };
  }, [containerEl, playerRef, unifiedSeekRef, isRotatedRef]);
};

const useCasShader = (
  playerReady: boolean,
  casEnabled: boolean,
  getTechVideoEl: () => HTMLVideoElement | null,
  isPiPActive: boolean,
  debug: boolean = false,
  techEpoch: number,
  disableCas: () => void,
) => {
  const ownerRef = useRef<string>(`${Date.now()}_${Math.random()}`);
  const techRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const failuresRef = useRef(0);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const cleanup = () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
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
    };

    if (!playerReady || !casEnabled || isPiPActive || failuresRef.current > 3) {
      cleanup();
      return;
    }

    const tech = getTechVideoEl();
    if (!tech || !tech.parentElement) return;
    if (tech.dataset.casActive && tech.dataset.casOwner !== ownerRef.current)
      return;

    const canvas = document.createElement('canvas');
    canvas.dataset.casCanvas = '1';
    canvas.dataset.casOwner = ownerRef.current;
    Object.assign(canvas.style, {
      position: 'absolute',
      top: 0,
      left: 0,
      width: '100%',
      height: '100%',
      pointerEvents: 'none',
      zIndex: 0,
      objectFit: 'contain',
    });
    tech.parentElement.insertBefore(canvas, tech.nextSibling);
    canvasRef.current = canvas;
    techRef.current = tech;

    const gl = canvas.getContext('webgl', {
      alpha: false,
      preserveDrawingBuffer: false,
      antialias: false,
    });
    if (!gl) {
      cleanup();
      return;
    }

    const vs = `attribute vec2 p;varying vec2 v;void main(){gl_Position=vec4(p,0,1);v=p*0.5+0.5;v.y=1.0-v.y;}`;
    const fs = `precision mediump float;varying vec2 v;uniform sampler2D i;uniform vec2 r;uniform float s;void main(){vec2 t=1.0/r;vec3 e=texture2D(i,v).rgb;vec3 a=texture2D(i,v+vec2(0,-t.y)).rgb;vec3 c=texture2D(i,v+vec2(-t.x,0)).rgb;vec3 g=texture2D(i,v+vec2(t.x,0)).rgb;vec3 i_val=texture2D(i,v+vec2(0,t.y)).rgb;float w=-1.0/mix(8.0,5.0,clamp(s,0.0,1.0));vec3 rs=(a+c+g+i_val)*w+e;float d=1.0+4.0*w;vec3 f=rs/d;vec3 mn=min(min(min(a,c),g),i_val);vec3 mx=max(max(max(a,c),g),i_val);f=clamp(f,min(mn,e),max(mx,e));float l=dot(f,vec3(0.2126,0.7152,0.0722));gl_FragColor=vec4((mix(vec3(l),f,1.15)-0.5)*1.05+0.5,1.0);}`;

    const createS = (t: number, src: string) => {
      const s = gl.createShader(t);
      if (!s) return null;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      return s;
    };
    const p = gl.createProgram();
    const vS = createS(gl.VERTEX_SHADER, vs);
    const fS = createS(gl.FRAGMENT_SHADER, fs);
    if (!p || !vS || !fS) {
      cleanup();
      return;
    }
    gl.attachShader(p, vS);
    gl.attachShader(p, fS);
    gl.linkProgram(p);
    gl.useProgram(p);

    const b = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, b);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
      gl.STATIC_DRAW,
    );
    const pos = gl.getAttribLocation(p, 'p');
    gl.enableVertexAttribArray(pos);
    gl.vertexAttribPointer(pos, 2, gl.FLOAT, false, 0, 0);

    const tx = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tx);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

    const uR = gl.getUniformLocation(p, 'r');
    const uS = gl.getUniformLocation(p, 's');

    tech.setAttribute('data-cas-active', 'true');
    tech.dataset.casOwner = ownerRef.current;
    let first = true;

    const loop = () => {
      if (!tech.isConnected || !canvas.isConnected) {
        cleanup();
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
        if (first) {
          tech.style.opacity = '0';
          first = false;
        }
        if (uR) gl.uniform2f(uR, canvas.width, canvas.height);
        if (uS) gl.uniform1f(uS, 0.6);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
        rafRef.current = requestAnimationFrame(loop);
      } catch {
        failuresRef.current++;
        cleanup();
        if (failuresRef.current > 3) disableCas();
      }
    };
    loop();
    return cleanup;
  }, [
    playerReady,
    casEnabled,
    isPiPActive,
    techEpoch,
    getTechVideoEl,
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
  // --- Refs & State ---
  const containerRef = useRef<HTMLDivElement>(null);
  const videoWrapperRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<VideoJsPlayerInstance | null>(null);
  const hlsRef = useRef<Hls | null>(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [seekingTime, setSeekingTime] = useState<number | null>(null);
  const [isScrubbing, setIsScrubbing] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [isRotatedFullscreen, setIsRotatedFullscreen] = useState(false);
  const [casEnabled, setCasEnabled] = useState(() => {
    try {
      return localStorage.getItem('lunatv_cas_enabled') !== 'false';
    } catch {
      return true;
    }
  });
  const [playbackRate, setPlaybackRate] = useState(1);
  const [pipSupported, setPipSupported] = useState(false);
  const [hasAirPlay, setHasAirPlay] = useState(false);
  const [isPiPActive, setIsPiPActive] = useState(false);
  const [playerReady, setPlayerReady] = useState(false);
  const [techEpoch, setTechEpoch] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false); // Added missing state

  const [gestureEl, setGestureEl] = useState<HTMLDivElement | null>(null);
  const setGestureNode = useCallback(
    (node: HTMLDivElement | null) => setGestureEl(node),
    [],
  );

  const pendingAutoplayRef = useRef(false);
  const isSwitchingRef = useRef(false);
  const switchGuardRef = useRef<number | null>(null);
  const autoplayEpochRef = useRef(0);
  const nativeAutoplayRef = useRef<{
    video: HTMLVideoElement | null;
    handler: (() => void) | null;
  }>({ video: null, handler: null });

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
  const mountedRef = useRef(true);
  const controlsVisibleRef = useRef(controlsVisible);
  const playbackRateRef = useRef(playbackRate);
  const casEnabledRef = useRef(casEnabled);
  const isRotatedRef = useRef(isRotatedFullscreen);

  // --- Helpers ---
  const getTechVideoEl = useCallback((): HTMLVideoElement | null => {
    const p = playerRef.current;
    if (!p) return null;
    const techEl = p.tech?.(true)?.el?.();
    if (techEl instanceof HTMLVideoElement) return techEl;
    return p.el()?.querySelector('video') as HTMLVideoElement | null;
  }, []);

  const formatTime = (s: number) => {
    if (!Number.isFinite(s)) return '0:00';
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = Math.floor(s % 60);
    return h > 0
      ? `${h}:${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`
      : `${m}:${sec.toString().padStart(2, '0')}`;
  };

  const clearNativeAutoplayListeners = useCallback(() => {
    const prev = nativeAutoplayRef.current;
    if (prev.video && prev.handler) {
      prev.video.removeEventListener('loadedmetadata', prev.handler);
      prev.video.removeEventListener('canplay', prev.handler);
    }
    nativeAutoplayRef.current = { video: null, handler: null };
  }, []);

  const tryPlayNow = useCallback(() => {
    if (!mountedRef.current || !playerRef.current) return;
    playerRef.current.play()?.catch(() => {
      /* empty */
    });
  }, []);

  const armAutoplay = useCallback(
    (videoEl?: HTMLVideoElement | null) => {
      if (!configRef.current.autoPlay && !pendingAutoplayRef.current) return;

      const myEpoch = autoplayEpochRef.current;
      tryPlayNow();

      const v =
        videoEl ||
        getTechVideoEl() ||
        (playerRef.current?.tech?.(true)?.el?.() instanceof HTMLVideoElement
          ? (playerRef.current.tech(true).el() as HTMLVideoElement)
          : null);

      if (!v) return;
      clearNativeAutoplayListeners();

      const handler = () => {
        if (!mountedRef.current) return;
        if (autoplayEpochRef.current !== myEpoch) return;
        if (configRef.current.autoPlay || pendingAutoplayRef.current)
          tryPlayNow();
      };

      nativeAutoplayRef.current = { video: v, handler };
      v.addEventListener('loadedmetadata', handler, { once: true });
      v.addEventListener('canplay', handler, { once: true });
    },
    [getTechVideoEl, clearNativeAutoplayListeners, tryPlayNow],
  );

  const unifiedSeek = useUnifiedSeek(
    playerRef,
    setCurrentTime,
    (p) => setIsPlaying(!p),
    setSeekingTime,
  );
  const unifiedSeekRef = useRef(unifiedSeek);

  useEffect(() => {
    unifiedSeekRef.current = unifiedSeek;
  }, [unifiedSeek]);
  useEffect(() => {
    controlsVisibleRef.current = controlsVisible;
  }, [controlsVisible]);
  useEffect(() => {
    isRotatedRef.current = isRotatedFullscreen;
  }, [isRotatedFullscreen]);
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

  usePlayerGestures(
    gestureEl,
    playerRef,
    duration,
    unifiedSeekRef,
    controlsVisibleRef,
    isRotatedRef,
  );
  useCasShader(
    playerReady,
    casEnabled,
    getTechVideoEl,
    isPiPActive,
    debug,
    techEpoch,
    () => {
      setCasEnabled(false);
      try {
        localStorage.setItem('lunatv_cas_enabled', 'false');
      } catch {
        /* empty */
      }
    },
  );

  const finalUrl = useMemo(() => {
    if (!reloadTrigger || reloadTrigger <= 0) return url;
    return `${url}${url.includes('?') ? '&' : '?'}t=${reloadTrigger}-${Date.now()}`;
  }, [url, reloadTrigger]);

  const initHls = useCallback(
    (videoEl: HTMLVideoElement, sourceUrl: string) => {
      if (!sourceUrl) return;
      let proxyUrl = sourceUrl;
      if (!sourceUrl.includes('/api/proxy/')) {
        proxyUrl = `/api/proxy/m3u8?url=${encodeURIComponent(sourceUrl)}&allowCORS=false&moontv-source=${encodeURIComponent(seriesId || 'global')}`;
      }

      if (videoEl.canPlayType('application/vnd.apple.mpegurl')) {
        clearNativeAutoplayListeners();
        videoEl.src = proxyUrl;
        try {
          videoEl.load();
        } catch {
          /* empty */
        }
        armAutoplay(videoEl);
        return;
      }

      if (Hls.isSupported()) {
        if (hlsRef.current) hlsRef.current.destroy();
        const hls = new Hls({
          enableWorker: true,
          lowLatencyMode: isLive,
          loader: customHlsLoader || Hls.DefaultConfig.loader,
        });
        hlsRef.current = hls;
        hls.loadSource(proxyUrl);
        hls.attachMedia(videoEl);
        // Ensure no native controls interfere
        videoEl.controls = false;
        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          if (configRef.current.autoPlay) tryPlayNow();
        });

        // FIX: HLS Error Handling & Sound Recovery
        hls.on(Hls.Events.ERROR, (_event, data) => {
          if (data.fatal) {
            switch (data.type) {
              case Hls.ErrorTypes.NETWORK_ERROR:
                console.warn(
                  '[HLS] Fatal network error encountered, trying to recover',
                );
                hls.startLoad();
                break;
              case Hls.ErrorTypes.MEDIA_ERROR: {
                console.warn(
                  '[HLS] Fatal media error encountered, trying to recover',
                );
                hls.recoverMediaError();
                // Force volume update to wake up audio engine
                const p = playerRef.current;
                if (p) {
                  const vol = p.volume();
                  p.volume(0);
                  setTimeout(() => p.volume(vol), 50);
                }
                break;
              }
              default:
                // Cannot recover, reloading source
                console.error(
                  '[HLS] Unrecoverable error, destroying HLS instance',
                );
                hls.destroy();
                // Trigger re-init via effect dependency
                initHls(videoEl, proxyUrl);
                break;
            }
          }
        });
      }
    },
    [
      seriesId,
      customHlsLoader,
      isLive,
      armAutoplay,
      clearNativeAutoplayListeners,
      tryPlayNow,
    ],
  );

  useEffect(() => {
    if (!playerReady || !playerRef.current) return;

    isSwitchingRef.current = true;
    autoplayEpochRef.current += 1;
    if (switchGuardRef.current) clearTimeout(switchGuardRef.current);
    switchGuardRef.current = window.setTimeout(() => {
      if (mountedRef.current) isSwitchingRef.current = false;
    }, 3000);

    clearNativeAutoplayListeners();

    const isHls =
      type === 'application/x-mpegURL' || finalUrl.includes('.m3u8');
    const isFlv = finalUrl.includes('.flv');

    if (isHls) {
      (async () => {
        let v = getTechVideoEl();
        for (let i = 0; i < 10 && !v; i++) {
          await new Promise((r) => setTimeout(r, 50));
          v = getTechVideoEl();
        }
        if (v) initHls(v, finalUrl);
      })();
    } else {
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
      let src = finalUrl;
      if (/^https?:\/\//i.test(finalUrl)) {
        const enc = encodeURIComponent(finalUrl);
        const srcParam = encodeURIComponent(seriesId || 'global');
        src = isFlv
          ? `/api/proxy/flv?url=${enc}&moontv-source=${srcParam}`
          : `/api/proxy/key?url=${enc}&moontv-source=${srcParam}`;
      }
      playerRef.current.src({
        src,
        type: isFlv ? 'video/x-flv' : type || 'video/mp4',
      });
      playerRef.current.controls(false);
      armAutoplay();
    }
  }, [
    finalUrl,
    type,
    playerReady,
    initHls,
    getTechVideoEl,
    armAutoplay,
    clearNativeAutoplayListeners,
    seriesId,
  ]);

  useEffect(() => {
    if (!videoWrapperRef.current) return;
    videoWrapperRef.current.innerHTML = '';
    const vid = document.createElement('video-js');
    Object.assign(vid.style, {
      width: '100%',
      height: '100%',
      position: 'absolute',
    });
    videoWrapperRef.current.appendChild(vid);

    const player = videojs(vid, {
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

    const clearSwitching = () => {
      isSwitchingRef.current = false;
      if (switchGuardRef.current) {
        clearTimeout(switchGuardRef.current);
        switchGuardRef.current = null;
      }
    };
    player.on('loadedmetadata', clearSwitching);
    player.on('canplay', clearSwitching);
    player.on('error', clearSwitching);

    player.on('playing', () => {
      if (mountedRef.current) {
        setIsPlaying(true);
        if (pendingAutoplayRef.current) pendingAutoplayRef.current = false;
        clearSwitching();
        callbacksRef.current.onPlay?.();

        // FIX: Audio Context Resumption
        const AudioContext =
          window.AudioContext || (window as any).webkitAudioContext;
        if (AudioContext) {
          const ctx = new AudioContext();
          if (ctx.state === 'suspended') ctx.resume();
        }
      }
    });
    player.on('pause', () => {
      if (mountedRef.current) {
        setIsPlaying(false);
        if (!isSwitchingRef.current) pendingAutoplayRef.current = false;
        callbacksRef.current.onPause?.();
      }
    });
    player.on('timeupdate', () => {
      if (!mountedRef.current) return;
      const t = player.currentTime() || 0;
      let d = player.duration() || 0;
      if (!Number.isFinite(d) || d <= 0) {
        const native = player.tech?.(true)?.el?.();
        if (native && Number.isFinite(native.duration) && native.duration > 0)
          d = native.duration;
      }
      if (Number.isFinite(d) && d > 0)
        setDuration((prev) => (prev !== d ? d : prev));

      const isSeeking =
        isScrubbing || seekingTime !== null || unifiedSeek.isActive();
      if (!isSeeking) setCurrentTime(t);

      const { enableSkip, skipIntroTime, skipOutroTime } = configRef.current;
      if (enableSkip && skipIntroTime > 0 && t < skipIntroTime)
        player.currentTime(skipIntroTime);
      callbacksRef.current.onTimeUpdate?.(t, d);
    });
    player.on('ended', () => {
      if (mountedRef.current) callbacksRef.current.onEnded?.();
    });
    player.on('enterpictureinpicture', () => setIsPiPActive(true));
    player.on('leavepictureinpicture', () => setIsPiPActive(false));
    player.ready(() => {
      if (mountedRef.current) {
        setPlayerReady(true);
        callbacksRef.current.onReady?.(player);
        const v = player.tech?.(true)?.el?.();
        if (v) {
          setPipSupported(
            (document.pictureInPictureEnabled && !!v.requestPictureInPicture) ||
              !!(v as any).webkitSetPresentationMode,
          );
          setHasAirPlay(
            !!(window as any).WebKitPlaybackTargetAvailabilityEvent,
          );
          if (casEnabledRef.current) v.crossOrigin = 'anonymous';
        }
      }
    });

    const handleFullscreenChange = () =>
      setIsFullscreen(
        !!document.fullscreenElement ||
          !!(document as any).webkitFullscreenElement,
      );
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    document.addEventListener('webkitfullscreenchange', handleFullscreenChange);

    return () => {
      clearNativeAutoplayListeners();
      player.dispose();
      playerRef.current = null;
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
      document.removeEventListener(
        'webkitfullscreenchange',
        handleFullscreenChange,
      );
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // FIX: Stall Detection & Recovery
  useEffect(() => {
    if (!playerReady || !playerRef.current) return;

    let lastTime = 0;
    let stallCount = 0;

    const interval = setInterval(() => {
      if (!mountedRef.current || !playerRef.current) return;
      const p = playerRef.current;

      // Only check if supposed to be playing
      if (p.paused() || p.scrubbing()) {
        stallCount = 0;
        return;
      }

      const current = p.currentTime() ?? 0;
      const delta = Math.abs(current - lastTime);

      // If moved less than 0.1s in 2s (and not at end)
      if (delta < 0.1 && (p.remainingTime() ?? 0) > 2) {
        stallCount++;
        // If stalled for 6 seconds (3 intervals)
        if (stallCount >= 3) {
          console.warn('[Player] Stall detected, nudging forward...');
          p.currentTime(current + 1); // Skip 1 second
          stallCount = 0; // Reset
        }
      } else {
        stallCount = 0;
      }
      lastTime = current;
    }, 2000);

    return () => clearInterval(interval);
  }, [playerReady]);

  const togglePlay = () => {
    if (playerRef.current?.paused())
      playerRef.current.play()?.catch(() => {
        /* empty */
      });
    else playerRef.current?.pause();
  };

  // FIX: Fullscreen Logic (Native Mobile Support)
  // FIX: Fullscreen Logic (Robust Native Support)
  const toggleFullscreen = async () => {
    const container = containerRef.current;
    const video = getTechVideoEl();
    const p = playerRef.current;

    // 1. Try Video.js API first (handles most desktop/android cases)
    if (p && p.requestFullscreen) {
      try {
        if (p.isFullscreen()) await p.exitFullscreen();
        else await p.requestFullscreen();
        return;
      } catch {
        /* fallback */
      }
    }

    // 2. IOS/Native Fallback
    if (video && (video as any).webkitEnterFullscreen) {
      if ((video as any).webkitDisplayingFullscreen)
        (video as any).webkitExitFullscreen?.();
      else (video as any).webkitEnterFullscreen();
      return;
    }

    // 3. Manual Container Fallback
    if (
      document.fullscreenEnabled ||
      (document as any).webkitFullscreenEnabled
    ) {
      if (
        !document.fullscreenElement &&
        !(document as any).webkitFullscreenElement
      ) {
        if (container?.requestFullscreen) await container.requestFullscreen();
        else if ((container as any).webkitRequestFullscreen)
          (container as any).webkitRequestFullscreen();
      } else {
        if (document.exitFullscreen) await document.exitFullscreen();
        else if ((document as any).webkitExitFullscreen)
          (document as any).webkitExitFullscreen();
      }
    }
  };

  const toggleRotatedFullscreen = () => {
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
  };

  const handleInteraction = () => {
    if (uiInteractTimeoutRef.current)
      clearTimeout(uiInteractTimeoutRef.current);
    uiInteractTimeoutRef.current = window.setTimeout(() => {
      if (mountedRef.current && isPlaying && !settingsOpen)
        setControlsVisible(false);
    }, 3000);
  };
  const uiInteractTimeoutRef = useRef<number | null>(null);

  const displayTime = seekingTime ?? currentTime;
  const progressPercent = duration > 0 ? (displayTime / duration) * 100 : 0;

  useEffect(() => {
    const id = 'lunatv-player-css-v6';
    if (!document.getElementById(id)) {
      const style = document.createElement('style');
      style.id = id;
      style.textContent = CSS;
      document.head.appendChild(style);
    }
  }, []);

  return (
    <div
      className={`player-container ${className} group`}
      ref={containerRef}
      onPointerMove={handleInteraction}
      onPointerDown={handleInteraction}
    >
      <div ref={videoWrapperRef} className='video-wrapper' />

      <div
        ref={setGestureNode}
        className='tap-layer'
        onClick={() => {
          if (settingsOpen) {
            setSettingsOpen(false);
            return;
          }
          const newState = !controlsVisible;
          setControlsVisible(newState);
          if (newState) handleInteraction();
          else if (uiInteractTimeoutRef.current)
            clearTimeout(uiInteractTimeoutRef.current);
        }}
      />

      {seekingTime !== null && (
        <div className='seek-overlay-container'>
          <div className='seek-info-pill'>
            <span className='seek-time-large'>{formatTime(seekingTime)}</span>
            <span className='text-white/60 text-sm font-medium'>
              / {formatTime(duration)}
            </span>
          </div>
        </div>
      )}

      <div className={`player-controls ${controlsVisible ? 'visible' : ''}`}>
        <div className='player-header'>
          <div className='header-left'></div>
          <button
            className='control-button'
            onClick={() => setSettingsOpen(!settingsOpen)}
          >
            {Icons.Settings()}
          </button>
        </div>

        <div className='absolute inset-0 flex items-center justify-center pointer-events-none'>
          {!isPlaying && controlsVisible && (
            <div
              className='w-16 h-16 bg-black/40 rounded-full flex items-center justify-center backdrop-blur-sm pointer-events-auto cursor-pointer hover:scale-110 transition-transform'
              onClick={togglePlay}
            >
              <div className='scale-150 text-white'>{Icons.Play()}</div>
            </div>
          )}
        </div>

        <div className='player-bottom'>
          <div
            className='progress-bar'
            onPointerDown={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();

              // FIX: Rotated Coordinate Logic
              // When rotated 90deg, progress runs Top->Bottom (clientY), not Left->Right (clientX)
              let rawP = (e.clientX - rect.left) / rect.width;
              if (isRotatedFullscreen) {
                rawP = (e.clientY - rect.top) / rect.height;
              }

              const p = Math.max(0, Math.min(1, rawP));

              unifiedSeek.begin({ showOverlay: true });
              unifiedSeek.preview(p * duration);
              e.stopPropagation();

              const onMove = (mv: PointerEvent) => {
                const r = rect;

                let rawPm = (mv.clientX - r.left) / r.width;
                if (isRotatedFullscreen) {
                  rawPm = (mv.clientY - r.top) / r.height;
                }

                const pm = Math.max(0, Math.min(1, rawPm));
                unifiedSeek.preview(pm * duration);
              };
              const onUp = () => {
                unifiedSeek.end();
                document.removeEventListener('pointermove', onMove);
                document.removeEventListener('pointerup', onUp);
              };
              document.addEventListener('pointermove', onMove);
              document.addEventListener('pointerup', onUp);
            }}
          >
            <div className='progress-track'>
              <div
                className='progress-fill'
                style={{ width: `${progressPercent}%` }}
              />
            </div>
            <div
              className='progress-thumb'
              style={{ left: `${progressPercent}%` }}
            />
          </div>

          <div className='controls-row'>
            <div className='flex items-center gap-4'>
              <button className='control-button' onClick={togglePlay}>
                {isPlaying ? Icons.Pause() : Icons.Play()}
              </button>
              {hasNextEpisode && (
                <button
                  className='control-button'
                  onClick={() => {
                    pendingAutoplayRef.current = true;
                    tryPlayNow();
                    onNextEpisode?.();
                  }}
                >
                  {Icons.Next()}
                </button>
              )}
              <div className='time-text'>
                {formatTime(seekingTime ?? currentTime)} /{' '}
                {formatTime(duration)}
              </div>
            </div>

            <div className='flex items-center gap-2'>
              <button
                className='control-button'
                onClick={toggleRotatedFullscreen}
                title='Page Fullscreen'
              >
                {Icons.Rotate()}
              </button>
              {pipSupported && (
                <button
                  className='control-button'
                  onClick={() => {
                    const v = getTechVideoEl();
                    if (document.pictureInPictureElement)
                      document.exitPictureInPicture();
                    else if (v?.requestPictureInPicture)
                      v.requestPictureInPicture();
                    else if ((v as any).webkitSetPresentationMode)
                      (v as any).webkitSetPresentationMode(
                        'picture-in-picture',
                      );
                  }}
                >
                  {Icons.Pip()}
                </button>
              )}

              {hasAirPlay && (
                <button
                  className='control-button'
                  onClick={() =>
                    (
                      getTechVideoEl() as any
                    )?.webkitShowPlaybackTargetPicker?.()
                  }
                >
                  {Icons.Airplay()}
                </button>
              )}

              <button className='control-button' onClick={toggleFullscreen}>
                {isFullscreen ? Icons.Minimize() : Icons.Maximize()}
              </button>
            </div>
          </div>
        </div>

        {settingsOpen && (
          <div
            className='settings-overlay'
            onClick={() => setSettingsOpen(false)}
          >
            <div
              className='settings-popup'
              onClick={(e) => e.stopPropagation()}
            >
              <div className='settings-header'>
                <span className='settings-title'>Settings</span>
              </div>
              <div className='settings-content'>
                <div className='setting-item'>
                  <span>Speed</span>
                  <select
                    className='setting-select'
                    value={playbackRate}
                    onChange={(e) => {
                      const r = parseFloat(e.target.value);
                      setPlaybackRate(r);
                      playerRef.current?.playbackRate(r);
                      localStorage.setItem(
                        `lunatv_speed_${seriesId}`,
                        String(r),
                      );
                    }}
                  >
                    {[0.5, 0.75, 1, 1.25, 1.5, 2].map((r) => (
                      <option key={r} value={r}>
                        {r}x
                      </option>
                    ))}
                  </select>
                </div>
                <div
                  className='setting-item'
                  onClick={() => {
                    const n = !casEnabled;
                    setCasEnabled(n);
                    casEnabledRef.current = n;
                    setTechEpoch((prev) => prev + 1);
                    localStorage.setItem('lunatv_cas_enabled', String(n));
                    const v = getTechVideoEl();
                    if (v) v.crossOrigin = n ? 'anonymous' : null;
                  }}
                >
                  <span>Enhance HD</span>
                  <div
                    className={`toggle-switch ${casEnabled ? 'active' : ''}`}
                  >
                    <div className='toggle-knob' />
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

const CSS = `
.player-container { position: relative; width: 100%; height: 100%; background: #000; overflow: hidden; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; user-select: none; }
.video-wrapper { position: absolute; inset: 0; z-index: 1; }
.video-wrapper .vjs-loading-spinner, .video-wrapper .vjs-big-play-button, .video-wrapper .vjs-error-display, .video-wrapper .vjs-modal-dialog, .video-wrapper .vjs-poster, .video-wrapper .vjs-text-track-display, .video-wrapper .vjs-hidden, .video-wrapper .vjs-control-bar, .video-wrapper .vjs-dock-text, .video-wrapper .vjs-dock-shelf { display: none !important; pointer-events: none !important; }
.video-wrapper .vjs-tech { position: absolute; top: 0; left: 0; width: 100%; height: 100%; object-fit: contain; }
.video-wrapper .vjs-tech { position: absolute; top: 0; left: 0; width: 100%; height: 100%; object-fit: contain; }
.tap-layer { position: absolute; inset: 0; z-index: 5; pointer-events: auto; background: transparent; touch-action: none; -webkit-user-select: none; user-select: none; -webkit-touch-callout: none; cursor: pointer; }
.player-controls { position: absolute; inset: 0; display: flex; flex-direction: column; justify-content: space-between; opacity: 0; transition: opacity 0.3s ease; pointer-events: none; z-index: 10; }
.player-controls.visible { opacity: 1; }
.player-controls.visible .player-header, .player-controls.visible .player-bottom, .player-controls.visible .settings-popup, .player-controls.visible .settings-overlay, .player-controls.visible .absolute.inset-0.flex > div { pointer-events: auto; }
.player-header { padding: 20px; background: linear-gradient(to bottom, rgba(0,0,0,0.8) 0%, transparent 100%); display: flex; justify-content: flex-end; align-items: center; }
.player-bottom { padding: 0 20px 24px; background: linear-gradient(to top, rgba(0,0,0,0.9) 0%, transparent 100%); display: flex; flex-direction: column; gap: 12px; }
.control-button { width: 40px; height: 40px; display: flex; align-items: center; justify-content: center; color: rgba(255,255,255,0.9); background: transparent; border: none; cursor: pointer; border-radius: 50%; transition: all 0.2s; }
.control-button:hover { background: rgba(255,255,255,0.1); color: #fff; }
.control-button:active { transform: scale(0.95); }
.progress-bar { height: 24px; display: flex; align-items: center; cursor: pointer; position: relative; touch-action: none; width: 100%; group; }
.progress-track { width: 100%; height: 4px; background: rgba(255, 255, 255, 0.3); border-radius: 2px; position: relative; overflow: hidden; transition: height 0.2s; }
.progress-bar:hover .progress-track { height: 6px; }
.progress-fill { height: 100%; background: #3b82f6; border-radius: 2px; }
.progress-thumb { position: absolute; top: 50%; width: 12px; height: 12px; background: white; border-radius: 50%; transform: translate(-50%, -50%) scale(0); box-shadow: 0 2px 4px rgba(0,0,0,0.5); pointer-events: none; transition: transform 0.2s; }
.progress-bar:hover .progress-thumb { transform: translate(-50%, -50%) scale(1); }
.time-text { color: rgba(255, 255, 255, 0.8); font-size: 13px; font-weight: 500; font-variant-numeric: tabular-nums; letter-spacing: 0.5px; }
.controls-row { display: flex; justify-content: space-between; align-items: center; }
.seek-overlay-container { position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); z-index: 30; pointer-events: none; animation: fadeIn 0.2s; }
.seek-info-pill { background: rgba(0, 0, 0, 0.8); backdrop-filter: blur(8px); padding: 12px 24px; border-radius: 99px; display: flex; align-items: center; gap: 8px; border: 1px solid rgba(255,255,255,0.1); }
.seek-time-large { color: #fff; font-size: 20px; font-weight: 700; }
.settings-overlay { position: absolute; inset: 0; background: rgba(0,0,0,0.5); z-index: 50; animation: fadeIn 0.2s; }
.settings-popup { position: absolute; right: 20px; bottom: 80px; width: 260px; background: rgba(28, 28, 28, 0.95); backdrop-filter: blur(20px); border-radius: 12px; border: 1px solid rgba(255,255,255,0.1); box-shadow: 0 4px 24px rgba(0,0,0,0.5); animation: slideUp 0.2s; }
.settings-header { padding: 14px 16px; border-bottom: 1px solid rgba(255,255,255,0.1); font-weight: 600; font-size: 14px; color: #fff; }
.setting-item { display: flex; align-items: center; justify-content: space-between; padding: 12px 16px; color: rgba(255,255,255,0.9); font-size: 14px; cursor: pointer; }
.setting-item:hover { background: rgba(255,255,255,0.05); }
.setting-select { background: rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.2); color: white; padding: 4px 8px; border-radius: 6px; font-size: 12px; outline: none; }
.toggle-switch { width: 40px; height: 22px; background: rgba(255,255,255,0.2); border-radius: 11px; position: relative; transition: 0.2s; }
.toggle-switch.active { background: #3b82f6; }
.toggle-knob { width: 18px; height: 18px; background: white; border-radius: 50%; position: absolute; top: 2px; left: 2px; transition: 0.2s; }
.toggle-switch.active .toggle-knob { transform: translateX(18px); }
@keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
@keyframes slideUp { from { transform: translateY(10px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
.videojs-rotated-fullscreen { position: fixed !important; width: 100vh !important; width: 100dvh !important; height: 100vw !important; top: 50% !important; left: 50% !important; transform: translate(-50%, -50%) rotate(90deg) !important; z-index: 99999 !important; background: #000 !important; }
`;
