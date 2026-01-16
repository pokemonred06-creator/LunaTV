/* eslint-disable @typescript-eslint/no-explicit-any */
'use client';

import Hls from 'hls.js';
import type {
  MouseEvent as ReactMouseEvent,
  MutableRefObject,
  PointerEvent as ReactPointerEvent,
  RefObject,
  TouchEvent as ReactTouchEvent,
} from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import videojs from 'video.js';
import Player from 'video.js/dist/types/player';
import 'videojs-flvjs';

import 'video.js/dist/video-js.css';

interface WebKitHTMLVideoElement extends HTMLVideoElement {
  webkitEnterFullscreen?: () => void;
  webkitExitFullscreen?: () => void;
  webkitShowPlaybackTargetPicker?: () => void;
}
interface VideoJsTech {
  el(): WebKitHTMLVideoElement;
  on?(event: string, handler: () => void): void;
  off?(event: string, handler: () => void): void;
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
  customHlsLoader?: typeof Hls.DefaultConfig.loader;
  className?: string;
  debug?: boolean;
  seriesId?: string;
  isLive?: boolean;
  videoJsOptions?: VideoJsOptions;
}

const Icons = {
  play: (
    <svg viewBox='0 0 24 24' fill='currentColor' className='icon'>
      <path d='M8 5v14l11-7z' />
    </svg>
  ),
  pause: (
    <svg viewBox='0 0 24 24' fill='currentColor' className='icon'>
      <path d='M6 19h4V5H6v14zm8-14v14h4V5h-4z' />
    </svg>
  ),
  next: (
    <svg viewBox='0 0 24 24' fill='currentColor' className='icon'>
      <path d='M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z' />
    </svg>
  ),
  fullscreen: (
    <svg viewBox='0 0 24 24' fill='currentColor' className='icon'>
      <path d='M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z' />
    </svg>
  ),
  exitFullscreen: (
    <svg viewBox='0 0 24 24' fill='currentColor' className='icon'>
      <path d='M5 16h3v3h2v-5H5v2zm3-8H5v2h5V5H8v3zm6 11h2v-3h3v-2h-5v5zm2-11V5h-2v5h5V8h-3z' />
    </svg>
  ),
  settings: (
    <svg viewBox='0 0 24 24' fill='currentColor' className='icon'>
      <path d='M19.14 12.94c.04-.31.06-.63.06-.94 0-.31-.02-.63-.06-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z' />
    </svg>
  ),
  airplay: (
    <svg viewBox='0 0 24 24' fill='currentColor' className='icon'>
      <path d='M6 22h12l-6-6-6 6zM21 3H3c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h4v-2H3V5h18v12h-4v2h4c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2z' />
    </svg>
  ),
  pip: (
    <svg viewBox='0 0 24 24' fill='currentColor' className='icon'>
      <path d='M19 11h-8v6h8v-6zm4 8V4.98C23 3.88 22.1 3 21 3H3c-1.1 0-2 .88-2 1.98V19c0 1.1.9 2 2 2h18c1.1 0 2-.9 2-2zm-2 .02H3V4.97h18v14.05z' />
    </svg>
  ),
  rotate: (
    <svg viewBox='0 0 24 24' fill='currentColor' className='icon'>
      <path d='M7.11 8.53L5.7 7.11C4.8 8.27 4.24 9.61 4.07 11h2.02c.14-.87.49-1.72 1.02-2.47zM6.09 13H4.07c.17 1.39.72 2.73 1.62 3.89l1.41-1.42c-.52-.75-.87-1.59-1.01-2.47zm1.01 5.32c1.16.9 2.51 1.44 3.9 1.61V17.9c-.87-.15-1.71-.49-2.46-1.03L7.1 18.32zM13 4.07V1L8.45 5.55 13 10V6.09c2.84.48 5 2.94 5 5.91s-2.16 5.43-5 5.91v2.02c3.95-.49 7-3.85 7-7.93s-3.05-7.44-7-7.93z' />
    </svg>
  ),
  bigPlay: (
    <svg
      viewBox='0 0 24 24'
      fill='currentColor'
      className='icon'
      style={{ width: 48, height: 48 }}
    >
      <path d='M8 5v14l11-7z' />
    </svg>
  ),
  // FIX 2: Added Big Pause Icon
  bigPause: (
    <svg
      viewBox='0 0 24 24'
      fill='currentColor'
      className='icon'
      style={{ width: 48, height: 48 }}
    >
      <path d='M6 19h4V5H6v14zm8-14v14h4V5h-4z' />
    </svg>
  ),
};

const useUnifiedSeek = (
  playerRef: MutableRefObject<Player | null>,
  setCurrentTime: (t: number) => void,
  setIsPaused: (p: boolean) => void,
  setSeekingTime: (t: number | null) => void,
) => {
  const seekRef = useRef({
    active: false,
    wasPlaying: false,
    showOverlay: false,
  });

  // FIX 1: RequestAnimationFrame Ref for throttling
  const rafRef = useRef<number | null>(null);

  const begin = useCallback(
    (opts?: { showOverlay?: boolean }) => {
      // FIX 3: Prevent re-entry overwriting state
      if (seekRef.current.active) return;

      const player = playerRef.current;
      seekRef.current.active = true;
      seekRef.current.showOverlay = !!opts?.showOverlay;

      // Remember playback state BEFORE we pause
      seekRef.current.wasPlaying = player ? !player.paused() : false;

      if (seekRef.current.wasPlaying) {
        player?.pause();
        setIsPaused(true);
      }
    },
    [playerRef, setIsPaused],
  );

  const preview = useCallback(
    (time: number) => {
      // FIX 1: Throttle seek to animation frame to prevent black screen
      if (rafRef.current) cancelAnimationFrame(rafRef.current);

      rafRef.current = requestAnimationFrame(() => {
        const player = playerRef.current;
        const d = player?.duration?.() ?? 0;
        const safe = d > 0 ? Math.max(0, Math.min(d, time)) : Math.max(0, time);

        setCurrentTime(safe);
        // Using fastSeek if available helps, but standard currentTime in a raf loop is usually sufficient
        player?.currentTime(safe);

        if (seekRef.current.showOverlay) setSeekingTime(safe);
      });
    },
    [playerRef, setCurrentTime, setSeekingTime],
  );

  const end = useCallback(() => {
    // Cancel pending seeks
    if (rafRef.current) cancelAnimationFrame(rafRef.current);

    const player = playerRef.current;
    if (!seekRef.current.active) return;

    if (seekRef.current.showOverlay) setSeekingTime(null);

    // FIX 3: Resume playback if it was playing before
    if (seekRef.current.wasPlaying) {
      player?.play();
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

  return { begin, preview, end, cancel };
};

const useProgressBarScrub = (
  progressBarRef: RefObject<HTMLDivElement | null>,
  duration: number,
  unifiedSeek: ReturnType<typeof useUnifiedSeek>,
) => {
  const [isScrubbing, setIsScrubbing] = useState(false);
  const getTimeFromX = useCallback(
    (clientX: number) => {
      const bar = progressBarRef.current;
      if (!bar || duration <= 0) return 0;
      const rect = bar.getBoundingClientRect();
      return (
        Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)) * duration
      );
    },
    [duration, progressBarRef],
  );
  const handleScrubStart = useCallback(
    (
      e:
        | ReactMouseEvent<HTMLDivElement>
        | ReactTouchEvent<HTMLDivElement>
        | ReactPointerEvent<HTMLDivElement>,
    ) => {
      if ('touches' in e && e.cancelable) e.preventDefault();
      let clientX = 0;
      if ('touches' in e) {
        const t = e.touches[0];
        if (!t) return;
        clientX = t.clientX;
      } else {
        clientX = (e as ReactMouseEvent).clientX;
      }
      setIsScrubbing(true);
      unifiedSeek.begin({ showOverlay: false });
      unifiedSeek.preview(getTimeFromX(clientX));
    },
    [getTimeFromX, unifiedSeek],
  );
  useEffect(() => {
    if (!isScrubbing) return;
    if (typeof document === 'undefined') return;
    const handleGlobalMove = (e: MouseEvent | TouchEvent) => {
      if (e.cancelable) e.preventDefault();
      let clientX = 0;
      if ('touches' in e) {
        const t = e.touches[0];
        if (!t) return;
        clientX = t.clientX;
      } else {
        clientX = (e as MouseEvent).clientX;
      }
      unifiedSeek.preview(getTimeFromX(clientX));
    };
    const handleGlobalUp = () => {
      setIsScrubbing(false);
      unifiedSeek.end();
    };
    document.addEventListener('mousemove', handleGlobalMove);
    document.addEventListener('touchmove', handleGlobalMove, {
      passive: false,
    });
    document.addEventListener('mouseup', handleGlobalUp);
    document.addEventListener('touchend', handleGlobalUp);
    document.addEventListener('touchcancel', handleGlobalUp);
    return () => {
      document.removeEventListener('mousemove', handleGlobalMove);
      document.removeEventListener('touchmove', handleGlobalMove);
      document.removeEventListener('mouseup', handleGlobalUp);
      document.removeEventListener('touchend', handleGlobalUp);
      document.removeEventListener('touchcancel', handleGlobalUp);
    };
  }, [isScrubbing, getTimeFromX, unifiedSeek]);
  return { handleScrubStart, isScrubbing };
};

const usePlayerGestures = (
  containerRef: RefObject<HTMLDivElement | null>,
  playerRef: MutableRefObject<Player | null>,
  duration: number,
  unifiedSeek: ReturnType<typeof useUnifiedSeek>,
  controlsVisible: boolean, // FIX: Added prop
) => {
  const gestureRef = useRef({
    startX: 0,
    startY: 0,
    startVideoTime: 0,
    isSeeking: false,
    active: false,
  });
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const getPos = (e: TouchEvent | MouseEvent) => {
      const touch =
        'touches' in e ? e.touches[0] || e.changedTouches?.[0] : null;
      return touch
        ? { x: touch.clientX, y: touch.clientY }
        : 'clientX' in e
          ? { x: e.clientX, y: e.clientY }
          : null;
    };
    const handleStart = (e: TouchEvent | MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!container.contains(target)) return;

      // FIX: Only check for button interference if controls are actually visible
      if (controlsVisible) {
        if (
          target.closest(
            'button, .progress-bar, .progress-track, .progress-fill, .progress-thumb, .settings-popup, select, input',
          )
        ) {
          return;
        }
      }
      const pos = getPos(e);
      if (!pos) return;
      const g = gestureRef.current;
      g.startX = pos.x;
      g.startY = pos.y;
      g.active = true;
      g.isSeeking = false;
      g.startVideoTime = playerRef.current?.currentTime() || 0;
    };
    const handleMove = (e: TouchEvent | MouseEvent) => {
      const g = gestureRef.current;
      if (!g.active) return;
      const pos = getPos(e);
      if (!pos) return;
      const dx = pos.x - g.startX,
        dy = pos.y - g.startY;
      const isRotated = container.classList.contains(
        'videojs-rotated-fullscreen',
      );
      if (!g.isSeeking && (Math.abs(dx) > 10 || Math.abs(dy) > 10)) {
        const shouldSeek = isRotated
          ? Math.abs(dy) > Math.abs(dx)
          : Math.abs(dx) > Math.abs(dy);
        if (shouldSeek) {
          g.isSeeking = true;
          if (e.cancelable) e.preventDefault();
          unifiedSeek.begin({ showOverlay: true });
          g.startVideoTime =
            playerRef.current?.currentTime() || g.startVideoTime;
        } else {
          g.active = false;
        }
      }
      if (g.isSeeking) {
        if (e.cancelable) e.preventDefault();
        const span = isRotated
          ? container.clientHeight || 1
          : container.clientWidth || 1;
        if (duration > 0) {
          const delta = isRotated ? dy : dx;
          unifiedSeek.preview(
            g.startVideoTime + delta * (duration / span) * 0.8,
          );
        }
      }
    };
    const handleEnd = (e: TouchEvent | MouseEvent) => {
      const g = gestureRef.current;
      if (g.isSeeking) {
        if (e.cancelable) e.preventDefault();
        e.stopPropagation();
        unifiedSeek.end();
      }
      g.active = false;
      g.isSeeking = false;
    };
    container.addEventListener('mousedown', handleStart);
    container.addEventListener('touchstart', handleStart, { passive: false });
    container.addEventListener('mousemove', handleMove);
    container.addEventListener('touchmove', handleMove, { passive: false });
    container.addEventListener('mouseup', handleEnd);
    container.addEventListener('touchend', handleEnd);
    container.addEventListener('touchcancel', handleEnd);
    return () => {
      container.removeEventListener('mousedown', handleStart);
      container.removeEventListener('touchstart', handleStart);
      container.removeEventListener('mousemove', handleMove);
      container.removeEventListener('touchmove', handleMove);
      container.removeEventListener('mouseup', handleEnd);
      container.removeEventListener('touchend', handleEnd);
      container.removeEventListener('touchcancel', handleEnd);
    };
  }, [containerRef, playerRef, duration, unifiedSeek, controlsVisible]); // FIX: Added controlsVisible dependency
};

const useCasShader = (
  playerReady: boolean,
  casEnabled: boolean,
  getTechVideoEl: () => HTMLVideoElement | null,
  isPiPActive: boolean,
  debug: boolean = false,
  techEpoch: number,
) => {
  const animationFrameRef = useRef<number | undefined>(undefined);
  const ownerRef = useRef<string>(
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Date.now()}_${Math.random()}`,
  );
  const techRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
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
    let glCleaned = false;
    const cleanupGL = () => {
      if (glCleaned) return;
      glCleaned = true;
      safeDeleteGL();
    };
    const handleContextLost = (e: Event) => {
      e.preventDefault();
      if (debug) console.warn('CAS Shader: WebGL Context Lost');
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
    tech.style.opacity = '0';
    const render = () => {
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
      } catch (e) {
        if (debug) console.warn('CAS Shader stopped: Texture tainted', e);
        cleanupGL();
        hardStop();
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
  ]);
};

const stopProp = (e: ReactMouseEvent | ReactTouchEvent | ReactPointerEvent) =>
  e.stopPropagation();

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
}: VideoJsPlayerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const videoWrapperRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<Player | null>(null);
  const hlsRef = useRef<Hls | null>(null);
  const hasSkippedIntroRef = useRef(false);
  const hasTriggeredOutroRef = useRef(false);
  const progressBarRef = useRef<HTMLDivElement>(null);
  const mountedRef = useRef(true);
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
  const [casEnabled, setCasEnabled] = useState(true);
  const [isRotatedFullscreen, setIsRotatedFullscreen] = useState(false);
  const [pipSupported, setPipSupported] = useState(false);
  const [isPiPActive, setIsPiPActive] = useState(false);
  const [techEpoch, setTechEpoch] = useState(0);
  const hasAirPlay =
    typeof window !== 'undefined' &&
    'WebKitPlaybackTargetAvailabilityEvent' in window;
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
  ); // FIX: Pass controlsVisible
  const onTapStart = useCallback(
    (e: ReactTouchEvent | ReactMouseEvent | ReactPointerEvent) => {
      tapGateRef.current.down = true;
      tapGateRef.current.moved = false;
      if ('touches' in e) {
        const t = e.touches[0];
        if (!t) return;
        tapGateRef.current.startX = t.clientX;
        tapGateRef.current.startY = t.clientY;
      } else {
        tapGateRef.current.startX = e.clientX;
        tapGateRef.current.startY = e.clientY;
      }
    },
    [],
  );
  const onTapMove = useCallback(
    (e: ReactTouchEvent | ReactMouseEvent | ReactPointerEvent) => {
      if (!tapGateRef.current.down) return;
      let clientX = 0,
        clientY = 0;
      if ('touches' in e) {
        const t = e.touches[0];
        if (!t) return;
        clientX = t.clientX;
        clientY = t.clientY;
      } else {
        clientX = e.clientX;
        clientY = e.clientY;
      }
      const dx = Math.abs(clientX - tapGateRef.current.startX);
      const dy = Math.abs(clientY - tapGateRef.current.startY);
      if (dx > 10 || dy > 10) tapGateRef.current.moved = true;
    },
    [],
  );
  const onTapEnd = useCallback(() => {
    tapGateRef.current.down = false;
  }, []);
  const onTapToggleControls = useCallback(() => {
    if (tapGateRef.current.moved) return;
    if (isScrubbing) return;
    const now = Date.now();
    // FIX 4: Increased debounce and use userActive() for consistent state
    if (now - lastToggleTimeRef.current < 200) return;
    lastToggleTimeRef.current = now;

    const player = playerRef.current;
    if (!player) return;

    if ((player as any).userActive()) {
      (player as any).userActive(false);
    } else {
      (player as any).userActive(true);
    }
  }, [isScrubbing]);
  useEffect(() => {
    configRef.current = { enableSkip, skipIntroTime, skipOutroTime, autoPlay };
  }, [enableSkip, skipIntroTime, skipOutroTime, autoPlay]);
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
    if (typeof document === 'undefined') return;
    setPipSupported(
      !!document.pictureInPictureEnabled &&
        typeof (
          HTMLVideoElement.prototype as unknown as {
            requestPictureInPicture: unknown;
          }
        ).requestPictureInPicture === 'function',
    );
  }, []);
  useEffect(() => {
    try {
      const s = localStorage.getItem(`lunatv_speed_${seriesId}`);
      setPlaybackRate(s ? parseFloat(s) : 1);
    } catch {
      setPlaybackRate(1);
    }
  }, [seriesId]);
  useEffect(() => {
    playbackRateRef.current = playbackRate;
    if (playerRef.current) playerRef.current.playbackRate(playbackRate);
  }, [playbackRate]);
  useEffect(() => {
    try {
      setCasEnabled(localStorage.getItem('lunatv_cas_enabled') !== 'false');
    } catch {
      /* */
    }
  }, []);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);
  const getTechVideoEl = useCallback((): WebKitHTMLVideoElement | null => {
    const p = playerRef.current as unknown as {
      tech?: (safe: boolean) => VideoJsTech;
    };
    const tech = p.tech?.(true);
    const el = tech?.el?.();
    return el instanceof HTMLVideoElement
      ? (el as WebKitHTMLVideoElement)
      : null;
  }, []);
  const bumpTechEpoch = useCallback(() => {
    if (mountedRef.current) setTechEpoch((prev) => prev + 1);
  }, []);
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
    if (mountedRef.current)
      setIsPiPActive(document.pictureInPictureElement === videoEl);
    videoEl.addEventListener('enterpictureinpicture', onEnter);
    videoEl.addEventListener('leavepictureinpicture', onLeave);
    pipRef.current = { video: videoEl, onEnter, onLeave };
  }, []);
  const toggleCas = useCallback(() => {
    setCasEnabled((p) => {
      const n = !p;
      try {
        localStorage.setItem('lunatv_cas_enabled', n.toString());
      } catch {
        /* */
      }
      return n;
    });
  }, []);
  const changeSpeed = useCallback(
    (rate: number) => {
      setPlaybackRate(rate);
      try {
        localStorage.setItem(`lunatv_speed_${seriesId}`, rate.toString());
      } catch {
        /* */
      }
    },
    [seriesId],
  );
  const togglePiP = useCallback(() => {
    if (typeof document === 'undefined') return;
    if (document.pictureInPictureElement) {
      document.exitPictureInPicture().catch(() => {});
    } else if (document.pictureInPictureEnabled) {
      const video = getTechVideoEl();
      if (video)
        (video as unknown as { requestPictureInPicture?: () => Promise<void> })
          .requestPictureInPicture?.()
          .catch(() => {});
    }
  }, [getTechVideoEl]);
  const initHls = useCallback(
    (video: HTMLVideoElement, src: string) => {
      hlsRef.current?.destroy();
      if (!Hls.isSupported()) {
        video.src = src;
        return;
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
      hls.loadSource(src);
      hls.attachMedia(video);
      hls.on(Hls.Events.ERROR, (_, data) => {
        if (data.fatal && mountedRef.current)
          callbacksRef.current.onError?.(data);
      });
      hlsRef.current = hls;
    },
    [customHlsLoader, debug, isLive],
  );
  const toggleFullscreen = useCallback(() => {
    if (typeof document === 'undefined') return;
    const container = containerRef.current;
    const video = (getTechVideoEl() ||
      container?.querySelector('video')) as WebKitHTMLVideoElement | null;
    if (!container) return;
    if (!isFullscreen) {
      if (container.requestFullscreen)
        container.requestFullscreen().catch(() => {});
      else if (
        (container as unknown as { webkitRequestFullscreen?: () => void })
          .webkitRequestFullscreen
      )
        (
          container as unknown as { webkitRequestFullscreen: () => void }
        ).webkitRequestFullscreen();
      else if (video?.webkitEnterFullscreen) video.webkitEnterFullscreen();
    } else {
      if (document.exitFullscreen) document.exitFullscreen().catch(() => {});
      else if (
        (document as unknown as { webkitExitFullscreen?: () => void })
          .webkitExitFullscreen
      )
        (
          document as unknown as { webkitExitFullscreen: () => void }
        ).webkitExitFullscreen();
      else if (video?.webkitExitFullscreen) video.webkitExitFullscreen();
    }
    setTimeout(() => {
      if (mountedRef.current) playerRef.current?.trigger('resize');
    }, 50);
  }, [isFullscreen, getTechVideoEl]);
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
  const togglePlay = useCallback(() => {
    if (isPaused) playerRef.current?.play();
    else playerRef.current?.pause();
  }, [isPaused]);
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
    videoElement.setAttribute('crossOrigin', 'anonymous');
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
      html5: { vhs: false },
      ...videoJsOptions,
    });
    playerRef.current = player;
    player.ready(() => {
      if (mountedRef.current) setPlayerReady(true);
      if (mountedRef.current) callbacksRef.current.onReady?.(player);
      const tech = (
        player as unknown as { tech?: (safe: boolean) => VideoJsTech }
      )?.tech?.(true);
      const v = tech?.el?.();
      if (v instanceof HTMLVideoElement) {
        v.crossOrigin = 'anonymous';
        attachIosFullscreen(v as WebKitHTMLVideoElement);
        attachPiPListeners(v);
        bumpTechEpoch();
      }
    });
    const handleLoadStart = () => {
      const tech = (
        player as unknown as { tech?: (safe: boolean) => VideoJsTech }
      )?.tech?.(true);
      const v = tech?.el?.();
      if (v instanceof HTMLVideoElement) {
        v.crossOrigin = 'anonymous';
        attachIosFullscreen(v as WebKitHTMLVideoElement);
        attachPiPListeners(v);
        bumpTechEpoch();
      }
    };
    player.on('loadstart', handleLoadStart);
    player.on('useractive', () => {
      if (mountedRef.current) setControlsVisible(true);
    });
    player.on('userinactive', () => {
      if (mountedRef.current) setControlsVisible(false);
    });
    player.on('play', () => {
      if (!mountedRef.current) return;
      setIsPaused(false);
      callbacksRef.current.onPlay?.();
    });
    player.on('pause', () => {
      if (!mountedRef.current) return;
      setIsPaused(true);
      callbacksRef.current.onPause?.();
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
    player.on('timeupdate', () => {
      if (!mountedRef.current) return;
      const t = player.currentTime() || 0;
      const d = player.duration() || 0;
      setCurrentTime(t);
      callbacksRef.current.onTimeUpdate?.(t, d);
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
      attachIosFullscreen(null);
      attachPiPListeners(null);
      hlsRef.current?.destroy();
      hlsRef.current = null;
      playerRef.current?.dispose();
      playerRef.current = null;
    }; // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
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
    hlsRef.current?.destroy();
    hlsRef.current = null;
    hasSkippedIntroRef.current = false;
    hasTriggeredOutroRef.current = false;
    player.pause();
    player.playbackRate(playbackRateRef.current);
    player.poster(poster || '');
    const tech = (
      player as unknown as { tech?: (safe: boolean) => VideoJsTech }
    )?.tech?.(true);
    const v = tech?.el?.();
    const videoEl = v instanceof HTMLVideoElement ? v : null;
    if (videoEl) {
      try {
        videoEl.removeAttribute('src');
        videoEl.load();
      } catch {
        /* */
      }
      videoEl.crossOrigin = 'anonymous';
      attachIosFullscreen(videoEl as WebKitHTMLVideoElement);
      attachPiPListeners(videoEl);
      bumpTechEpoch();
    }
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
      if (snap.wasPlaying) {
        const p = player.play();
        if (p !== undefined) p.catch(() => {});
      }
    };
    player.one('loadedmetadata', restore);
    const isHlsUrl =
      url?.includes('.m3u8') ||
      url?.includes('/proxy/m3u8') ||
      url?.includes('m3u8?');
    const isFlvUrl =
      url?.includes('.flv') ||
      url?.includes('/proxy/flv') ||
      url?.includes('flv?');
    const loadSource = (src: string, mime?: string) =>
      player.src({ src, type: mime });
    if (type) {
      if (
        type === 'application/x-mpegURL' ||
        type === 'application/vnd.apple.mpegurl'
      ) {
        if (videoEl) initHls(videoEl, url);
        else loadSource(url, type);
      } else {
        loadSource(url, type);
      }
    } else if (isHlsUrl) {
      if (videoEl) initHls(videoEl, url);
      else loadSource(url, 'application/x-mpegURL');
    } else if (isFlvUrl) {
      loadSource(url, 'video/x-flv');
    } else {
      loadSource(url, 'video/mp4');
    } // Autoplay on EVERY source load (not just first)
    const tryAutoPlay = () => {
      if (!mountedRef.current || !configRef.current.autoPlay) return;
      const p = player.play();
      if (p !== undefined)
        p.catch(() => {
          if (mountedRef.current) setControlsVisible(true);
        });
    };
    if (firstLoadRef.current) {
      firstLoadRef.current = false;
      tryAutoPlay();
    } else {
      player.one('canplay', tryAutoPlay);
    }
    return () => {
      restoreArmed = false;
      player.off('loadedmetadata', restore);
      player.off('canplay', tryAutoPlay);
    };
  }, [
    url,
    type,
    poster,
    playerReady,
    initHls,
    attachIosFullscreen,
    attachPiPListeners,
    bumpTechEpoch,
    isLive,
  ]);
  useEffect(() => {
    const handleFullscreenChange = () => {
      if (typeof document === 'undefined') return;
      const isFS = !!(
        document.fullscreenElement ||
        (document as unknown as { webkitFullscreenElement?: Element })
          .webkitFullscreenElement
      );
      if (mountedRef.current) setIsFullscreen(isFS);
    };
    if (typeof document !== 'undefined') {
      document.addEventListener('fullscreenchange', handleFullscreenChange);
      document.addEventListener(
        'webkitfullscreenchange',
        handleFullscreenChange,
      );
    }
    return () => {
      if (typeof document !== 'undefined') {
        document.removeEventListener(
          'fullscreenchange',
          handleFullscreenChange,
        );
        document.removeEventListener(
          'webkitfullscreenchange',
          handleFullscreenChange,
        );
      }
    };
  }, []);
  useCasShader(
    playerReady,
    casEnabled,
    getTechVideoEl,
    isPiPActive,
    debug,
    techEpoch,
  );
  const formatTime = (s: number) => {
    if (!Number.isFinite(s)) return '0:00';
    const h = Math.floor(s / 3600),
      m = Math.floor((s % 3600) / 60),
      sec = Math.floor(s % 60);
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
          // FIX 5: Report activity during interaction to prevent auto-hide
          if (playerRef.current)
            (playerRef.current as any).reportUserActivity();
        }}
        onPointerUp={(e) => {
          if (e.pointerType === 'mouse' && e.button !== 0) return;
          onTapEnd();
          onTapToggleControls();
        }}
        onPointerCancel={onTapEnd}
        onPointerLeave={onTapEnd}
        onTouchStart={onTapStart}
        onTouchMove={(e) => {
          onTapMove(e);
          // FIX 5: Report activity during interaction to prevent auto-hide
          if (playerRef.current)
            (playerRef.current as any).reportUserActivity();
        }}
        onTouchEnd={() => {
          onTapEnd();
          onTapToggleControls();
        }}
        onTouchCancel={onTapEnd}
      />
      <div
        className={`player-controls ${controlsVisible ? 'visible' : ''}`}
        aria-hidden={!controlsVisible}
      >
        <div className='top-bar'>
          <button
            type='button'
            className='ctrl-btn'
            onClick={(e) => {
              e.stopPropagation();
              setSettingsOpen(!settingsOpen);
            }}
            title='Settings'
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
        >
          {Icons.rotate}
        </button>
        <div className='center-area'>
          {/* FIX 2: Render center button regardless of pause state, toggle icon */}
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
        <div className='bottom-bar'>
          <button
            type='button'
            className='ctrl-btn'
            onClick={(e) => {
              e.stopPropagation();
              togglePlay();
            }}
          >
            {isPaused ? Icons.play : Icons.pause}
          </button>
          {hasNextEpisode && (
            <button
              type='button'
              className='ctrl-btn'
              onClick={(e) => {
                e.stopPropagation();
                onNextEpisode?.();
              }}
              title='Next'
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
            onClick={stopProp}
            onPointerDown={(e) => {
              stopProp(e);
              handleScrubStart(e);
            }}
            onTouchStart={(e) => {
              stopProp(e);
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
                e.stopPropagation();
                togglePiP();
              }}
              title='Picture-in-Picture'
            >
              {Icons.pip}
            </button>
          )}
          {hasAirPlay && (
            <button
              type='button'
              className='ctrl-btn'
              onClick={(e) => {
                e.stopPropagation();
                const video = getTechVideoEl();
                video?.webkitShowPlaybackTargetPicker?.();
              }}
              title='AirPlay'
            >
              {Icons.airplay}
            </button>
          )}
          <button
            type='button'
            className='ctrl-btn'
            onClick={(e) => {
              e.stopPropagation();
              toggleFullscreen();
            }}
            title='Fullscreen'
          >
            {isFullscreen ? Icons.exitFullscreen : Icons.fullscreen}
          </button>
        </div>
      </div>
      {settingsOpen && (
        <div
          className='settings-popup'
          onClick={stopProp}
          onMouseDown={stopProp}
          onTouchStart={stopProp}
        >
          <div className='settings-header'>Settings</div>
          <div className='settings-item' onClick={toggleCas}>
            <span>Enhance HD</span>
            <div className={`toggle ${casEnabled ? 'on' : ''}`}>
              <div className='toggle-knob' />
            </div>
          </div>
          <div className='settings-item'>
            <span>Speed</span>
            <select
              value={playbackRate}
              onChange={(e) => changeSpeed(parseFloat(e.target.value))}
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
      <style>{CSS}</style>
    </div>
  );
}

const CSS = `.player-container{position:relative;width:100%;height:100%;background:#000;overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}.video-wrapper{position:absolute;inset:0}.player-container .video-js{position:absolute;inset:0;width:100%;height:100%}.player-container .vjs-control-bar,.player-container .vjs-big-play-button,.player-container .vjs-touch-overlay,.player-container .vjs-mobile-ui-play-toggle,.player-container .vjs-loading-spinner,.player-container .vjs-modal-dialog{display:none!important}.icon{width:24px;height:24px;display:block}.tap-layer{position:absolute;inset:0;z-index:9;pointer-events:auto;background:transparent}.player-controls{position:absolute;inset:0;display:flex;flex-direction:column;justify-content:space-between;opacity:0;transition:opacity .3s;pointer-events:none;z-index:10}.player-controls.visible{opacity:1}.player-controls::before{content:'';position:absolute;inset:0;pointer-events:none;background:linear-gradient(to bottom,rgba(0,0,0,.6) 0%,transparent 25%,transparent 75%,rgba(0,0,0,.8) 100%)}.top-bar,.bottom-bar,.settings-popup{position:relative;pointer-events:none;z-index:11}.top-bar,.bottom-bar{display:flex;align-items:center;gap:8px;padding:12px 16px}.top-bar{justify-content:flex-end}.bottom-bar{padding-bottom:max(12px,env(safe-area-inset-bottom))}.ctrl-btn{width:44px;height:44px;display:flex;align-items:center;justify-content:center;background:transparent;border:none;color:#fff;cursor:pointer;padding:0;border-radius:8px;transition:background .2s;flex-shrink:0}.ctrl-btn:hover{background:rgba(255,255,255,.1)}.ctrl-btn:active{background:rgba(255,255,255,.2);transform:scale(.95)}.ctrl-btn.pip-active{color:#4CAF50}.speed-btn{font-size:13px;font-weight:600;min-width:44px}.center-area{flex:1;display:flex;align-items:center;justify-content:center;gap:20px;pointer-events:none;z-index:11}.big-play-btn{width:80px;height:80px;border-radius:50%;background:rgba(0,0,0,0.6);border:2px solid rgba(255,255,255,0.8);color:white;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(4px);cursor:pointer;pointer-events:none;transition:all 0.2s}.big-play-btn:hover{transform:scale(1.1);background:rgba(0,0,0,0.8)}.big-play-btn:active{transform:scale(0.95)}.rotate-fullscreen-btn{position:absolute;left:16px;top:50%;transform:translateY(-50%);width:44px;height:44px;border-radius:50%;background:rgba(0,0,0,.5);border:1px solid rgba(255,255,255,.3);color:#fff;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(4px);transition:transform .2s,background .2s;pointer-events:none;cursor:pointer;z-index:12}.rotate-fullscreen-btn:hover{background:rgba(0,0,0,.7)}.rotate-fullscreen-btn:active{transform:translateY(-50%) scale(.95)}.time-display{font-size:13px;color:#fff;font-variant-numeric:tabular-nums;min-width:45px;text-align:center;flex-shrink:0}.progress-bar{flex:1;height:44px;display:flex;align-items:center;cursor:pointer;padding:0 4px;min-width:60px;touch-action:none}.progress-track{position:relative;width:100%;height:4px;background:rgba(255,255,255,.3);border-radius:2px}.progress-fill{height:100%;background:#4CAF50;border-radius:2px}.progress-thumb{position:absolute;top:50%;width:14px;height:14px;background:#fff;border-radius:50%;transform:translate(-50%,-50%);box-shadow:0 2px 4px rgba(0,0,0,.3)}.settings-popup{position:absolute;top:60px;right:16px;background:rgba(28,28,30,.95);backdrop-filter:blur(20px);border-radius:12px;padding:8px 0;min-width:200px;border:1px solid rgba(255,255,255,.1)}.settings-header{padding:12px 16px;font-size:15px;font-weight:600;color:#fff;border-bottom:1px solid rgba(255,255,255,.1)}.settings-item{display:flex;justify-content:space-between;align-items:center;padding:12px 16px;color:#fff;cursor:pointer;font-size:14px}.settings-item:hover{background:rgba(255,255,255,.05)}.settings-item select{background:transparent;border:1px solid rgba(255,255,255,.2);color:#fff;padding:4px 8px;border-radius:6px;font-size:13px}.toggle{width:44px;height:26px;background:#555;border-radius:13px;position:relative;transition:background .2s;flex-shrink:0}.toggle.on{background:#4CAF50}.toggle-knob{position:absolute;top:3px;left:3px;width:20px;height:20px;background:#fff;border-radius:50%;transition:left .2s}.seek-overlay{position:absolute;inset:0;background:rgba(0,0,0,.7);display:flex;flex-direction:column;align-items:center;justify-content:center;z-index:50;pointer-events:none}.seek-time{font-size:32px;font-weight:600;color:#fff;margin-bottom:16px}.seek-bar{width:70%;height:6px;background:rgba(255,255,255,.3);border-radius:3px;overflow:hidden}.seek-fill{height:100%;background:#4CAF50;border-radius:2px}.videojs-rotated-fullscreen{position:fixed!important;width:100vh!important;height:100vw!important;top:50%!important;left:50%!important;transform:translate(-50%,-50%) rotate(90deg)!important;z-index:99999!important;background:#000!important}@supports(width:100dvh){.videojs-rotated-fullscreen{width:100dvh!important;height:100dvw!important}}@media(max-width:480px){.ctrl-btn{width:40px;height:40px}.time-display{font-size:12px;min-width:38px}.speed-btn{font-size:12px;min-width:40px}}.player-controls.visible .top-bar,.player-controls.visible .bottom-bar,.player-controls.visible .settings-popup,.player-controls.visible .big-play-btn,.player-controls.visible .rotate-fullscreen-btn{pointer-events:auto}.player-controls:not(.visible) *{pointer-events:none!important}`;
