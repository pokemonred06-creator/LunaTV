/**
 * VideoJsPlayer.tsx
 *
 * A fully custom video player component built on top of Video.js.
 * Features:
 * - Custom React-based UI controls (replaces Video.js native controls)
 * - Unified 44px button sizing for consistent touch targets
 * - CAS (Contrast Adaptive Sharpening) WebGL shader for video enhancement
 * - Swipe-to-seek gesture support with visual feedback
 * - Rotated fullscreen mode for mobile devices
 * - AirPlay support for Apple devices
 * - Persistent playback speed and enhancement settings per series
 * - HLS streaming with optional custom loader for ad filtering
 *
 * @author LunaTV Team
 * @version 2.0.0
 */

'use client';

import Hls from 'hls.js';
import type { MutableRefObject, RefObject } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import videojs from 'video.js';
import Player from 'video.js/dist/types/player';
import 'videojs-hotkeys';
import 'videojs-mobile-ui';

import 'videojs-mobile-ui/dist/videojs-mobile-ui.css';
import 'video.js/dist/video-js.css';

// ============================================================================
// TYPES
// ============================================================================

/**
 * Props for the VideoJsPlayer component
 */
interface VideoJsPlayerProps {
  /** Video source URL (supports HLS .m3u8 and direct video files) */
  url: string;
  /** Poster image URL shown before playback */
  poster?: string;
  /** Auto-start playback when ready */
  autoPlay?: boolean;
  /** Callback when player is ready */
  onReady?: (player: Player) => void;
  /** Callback on time update with current time and duration */
  onTimeUpdate?: (currentTime: number, duration: number) => void;
  /** Callback when video ends */
  onEnded?: () => void;
  /** Callback on playback error */
  onError?: (error: unknown) => void;
  /** Callback when playback starts */
  onPlay?: () => void;
  /** Callback when playback pauses */
  onPause?: () => void;
  /** Callback to navigate to next episode */
  onNextEpisode?: () => void;
  /** Whether a next episode is available */
  hasNextEpisode?: boolean;
  /** Time in seconds to skip intro to */
  skipIntroTime?: number;
  /** Seconds before end to trigger onEnded */
  skipOutroTime?: number;
  /** Enable auto skip intro/outro */
  enableSkip?: boolean;
  /** Custom HLS.js loader for ad filtering */
  customHlsLoader?: typeof Hls.DefaultConfig.loader;
  /** Additional CSS class for container */
  className?: string;
  /** Enable debug logging */
  debug?: boolean;
  /** Series ID for storing per-series settings */
  seriesId?: string;
  /** Whether this is a live stream (disables progress bar, enables live HLS config) */
  isLive?: boolean;
  /** Additional video.js options to merge */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  videoJsOptions?: any;
}

// ============================================================================
// ICONS
// All icons use consistent 24x24 viewBox for uniform sizing
// ============================================================================

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
      <path d='M19.14 12.94c.04-.31.06-.63.06-.94 0-.31-.02-.63-.06-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.04.31-.06.63-.06.94s.02.63.06.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z' />
    </svg>
  ),
  airplay: (
    <svg viewBox='0 0 24 24' fill='currentColor' className='icon'>
      <path d='M6 22h12l-6-6-6 6zM21 3H3c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h4v-2H3V5h18v12h-4v2h4c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2z' />
    </svg>
  ),
  rotate: (
    <svg viewBox='0 0 24 24' fill='currentColor' className='icon'>
      <path d='M7.11 8.53L5.7 7.11C4.8 8.27 4.24 9.61 4.07 11h2.02c.14-.87.49-1.72 1.02-2.47zM6.09 13H4.07c.17 1.39.72 2.73 1.62 3.89l1.41-1.42c-.52-.75-.87-1.59-1.01-2.47zm1.01 5.32c1.16.9 2.51 1.44 3.9 1.61V17.9c-.87-.15-1.71-.49-2.46-1.03L7.1 18.32zM13 4.07V1L8.45 5.55 13 10V6.09c2.84.48 5 2.94 5 5.91s-2.16 5.43-5 5.91v2.02c3.95-.49 7-3.85 7-7.93s-3.05-7.44-7-7.93z' />
    </svg>
  ),
};

// ============================================================================
// HOOKS
// ============================================================================

/**
 * CAS (Contrast Adaptive Sharpening) Shader Hook
 *
 * Applies real-time video enhancement using WebGL:
 * - Sharpening filter for improved clarity
 * - Slight saturation boost (1.15x)
 * - Slight contrast boost (1.05x)
 *
 * The shader renders to a canvas overlay on top of the video element,
 * hiding the original video when active.
 *
 * @param playerReady - Whether the Video.js player is ready
 * @param casEnabled - Whether CAS enhancement is enabled
 * @param containerRef - Ref to the player container element
 * @param debug - Enable debug logging
 */
const useCasShader = (
  playerReady: boolean,
  casEnabled: boolean,
  containerRef: RefObject<HTMLDivElement | null>,
  debug: boolean = false,
) => {
  const animationFrameRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (!playerReady || !casEnabled) return;

    // Find the video element
    const tech = containerRef.current?.querySelector(
      '.vjs-tech',
    ) as HTMLVideoElement;
    if (!tech || tech.getAttribute('data-cas-active') === 'true') return;

    // Create canvas overlay for WebGL rendering
    const canvas = document.createElement('canvas');
    canvas.id = 'cas-canvas';
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
    tech.parentElement?.insertBefore(canvas, tech.nextSibling);

    // Initialize WebGL context
    const gl = canvas.getContext('webgl', {
      alpha: false,
      preserveDrawingBuffer: false,
      antialias: false,
    });
    if (!gl) {
      canvas.remove();
      tech.style.opacity = '1';
      return;
    }

    // Vertex shader - simple passthrough with texture coordinate flip
    const vs = `attribute vec2 position; varying vec2 v_texCoord; void main() { gl_Position = vec4(position,0,1); v_texCoord = position*0.5+0.5; v_texCoord.y=1.0-v_texCoord.y; }`;

    // Fragment shader - CAS algorithm with saturation/contrast boost
    const fs = `precision mediump float; varying vec2 v_texCoord; uniform sampler2D u_image; uniform vec2 u_resolution; uniform float u_sharpness;
      void main() {
        vec2 tex = 1.0 / u_resolution; vec3 e = texture2D(u_image, v_texCoord).rgb;
        vec3 a = texture2D(u_image, v_texCoord + vec2(0.0, -tex.y)).rgb;
        vec3 c = texture2D(u_image, v_texCoord + vec2(-tex.x, 0.0)).rgb;
        vec3 g = texture2D(u_image, v_texCoord + vec2(tex.x, 0.0)).rgb;
        vec3 i = texture2D(u_image, v_texCoord + vec2(0.0, tex.y)).rgb;
        float w = -1.0 / mix(8.0, 5.0, clamp(u_sharpness, 0.0, 1.0));
        vec3 res = (a + c + g + i) * w + e; float div = 1.0 + 4.0 * w; vec3 final = res / div;
        vec3 mn = min(min(min(a, c), g), i); vec3 mx = max(max(max(a, c), g), i);
        final = clamp(final, min(mn, e), max(mx, e));
        float lum = dot(final, vec3(0.2126, 0.7152, 0.0722));
        gl_FragColor = vec4((mix(vec3(lum), final, 1.15) - 0.5) * 1.05 + 0.5, 1.0);
      }`;

    // Compile shader helper
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

    // Create and link shader program
    const program = gl.createProgram();
    const vsS = createShader(gl.VERTEX_SHADER, vs);
    const fsS = createShader(gl.FRAGMENT_SHADER, fs);
    if (!program || !vsS || !fsS) {
      canvas.remove();
      tech.style.opacity = '1';
      return;
    }

    gl.attachShader(program, vsS);
    gl.attachShader(program, fsS);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      canvas.remove();
      tech.style.opacity = '1';
      return;
    }

    gl.useProgram(program);

    // Set up vertex buffer for fullscreen quad
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
      gl.STATIC_DRAW,
    );
    const posLoc = gl.getAttribLocation(program, 'position');
    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

    // Set up video texture
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

    // Mark as active and hide original video
    tech.setAttribute('data-cas-active', 'true');
    tech.style.opacity = '0';

    // Render loop - uploads video frame to texture and draws enhanced version
    const render = () => {
      if (!tech.videoWidth) {
        animationFrameRef.current = requestAnimationFrame(render);
        return;
      }

      // Resize canvas to match video resolution
      if (
        canvas.width !== tech.videoWidth ||
        canvas.height !== tech.videoHeight
      ) {
        canvas.width = tech.videoWidth;
        canvas.height = tech.videoHeight;
        gl.viewport(0, 0, canvas.width, canvas.height);
      }

      // Upload current video frame
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, tech);

      // Set shader uniforms
      const resLoc = gl.getUniformLocation(program, 'u_resolution');
      const sharpLoc = gl.getUniformLocation(program, 'u_sharpness');
      if (resLoc) gl.uniform2f(resLoc, canvas.width, canvas.height);
      if (sharpLoc) gl.uniform1f(sharpLoc, 0.6); // Sharpness intensity

      // Draw
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      animationFrameRef.current = requestAnimationFrame(render);
    };
    render();

    // Cleanup on unmount or disable
    return () => {
      if (animationFrameRef.current)
        cancelAnimationFrame(animationFrameRef.current);
      gl.deleteTexture(texture);
      gl.deleteBuffer(buffer);
      gl.detachShader(program, vsS);
      gl.deleteShader(vsS);
      gl.detachShader(program, fsS);
      gl.deleteShader(fsS);
      gl.deleteProgram(program);
      canvas.remove();
      tech.style.opacity = '1';
      tech.removeAttribute('data-cas-active');
    };
  }, [playerReady, casEnabled, containerRef, debug]);
};

/**
 * Touch/Mouse Gesture Hook for Swipe-to-Seek
 *
 * Handles horizontal swipe gestures on the video surface to seek:
 * - Detects swipe direction (horizontal = seek, vertical = cancel)
 * - Shows seek overlay with current seek position
 * - Pauses video during seek, resumes on release
 * - Adapts to rotated fullscreen mode (swaps axes)
 *
 * @param containerRef - Ref to the player container
 * @param playerRef - Ref to the Video.js player instance
 * @param setSeekingTime - State setter for seek overlay display
 */
const usePlayerGestures = (
  containerRef: RefObject<HTMLDivElement | null>,
  playerRef: MutableRefObject<Player | null>,
  setSeekingTime: (time: number | null) => void,
) => {
  // Gesture state tracked in ref to avoid re-renders
  const gestureRef = useRef({
    startX: 0,
    startY: 0,
    startVideoTime: 0,
    isSeeking: false,
    wasPlaying: false,
    active: false,
    currentSeekTime: 0,
  });

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // Helper to extract position from touch or mouse event
    const getPos = (e: TouchEvent | MouseEvent) => {
      const touch =
        'touches' in e ? e.touches[0] || e.changedTouches?.[0] : null;
      return touch
        ? { x: touch.clientX, y: touch.clientY }
        : 'clientX' in e
          ? { x: e.clientX, y: e.clientY }
          : null;
    };

    // Start gesture - record initial position and video state
    const handleStart = (e: TouchEvent | MouseEvent) => {
      const target = e.target as HTMLElement;
      // Don't interfere with control buttons
      if (
        !container.contains(target) ||
        target.closest('.player-controls, button')
      )
        return;
      const pos = getPos(e);
      if (!pos) return;
      const g = gestureRef.current;
      g.startX = pos.x;
      g.startY = pos.y;
      g.startVideoTime = playerRef.current?.currentTime() || 0;
      g.wasPlaying = playerRef.current ? !playerRef.current.paused() : false;
      g.isSeeking = false;
      g.active = true;
      g.currentSeekTime = g.startVideoTime;
    };

    // Move gesture - detect direction and update seek position
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

      // Threshold detection - determine if horizontal or vertical swipe
      if (!g.isSeeking && (Math.abs(dx) > 10 || Math.abs(dy) > 10)) {
        const isHorizontal = Math.abs(dx) > Math.abs(dy);
        // In rotated mode, vertical becomes the seek direction
        if (isRotated ? !isHorizontal : isHorizontal) {
          g.isSeeking = true;
          if (g.wasPlaying) playerRef.current?.pause();
        } else {
          g.active = false;
        }
      }

      // Calculate new seek position
      if (g.isSeeking) {
        if (e.cancelable) e.preventDefault(); // Prevent scroll
        const duration = playerRef.current?.duration() || 0,
          width = container.clientWidth || 1;
        if (duration > 0) {
          const delta = isRotated ? dy : dx;
          // Seek sensitivity: 80% of duration across screen width
          g.currentSeekTime = Math.max(
            0,
            Math.min(
              duration,
              g.startVideoTime + delta * (duration / width) * 0.8,
            ),
          );
          setSeekingTime(g.currentSeekTime);
        }
      }
    };

    // End gesture - apply seek and resume if needed
    const handleEnd = () => {
      const g = gestureRef.current;
      if (g.isSeeking) {
        playerRef.current?.currentTime(g.currentSeekTime);
        setSeekingTime(null);
        if (g.wasPlaying) playerRef.current?.play();
      }
      g.active = false;
      g.isSeeking = false;
    };

    // Register event listeners
    container.addEventListener('mousedown', handleStart);
    container.addEventListener('touchstart', handleStart, { passive: true });
    container.addEventListener('mousemove', handleMove);
    container.addEventListener('touchmove', handleMove, { passive: false });
    container.addEventListener('mouseup', handleEnd);
    container.addEventListener('touchend', handleEnd);

    return () => {
      container.removeEventListener('mousedown', handleStart);
      container.removeEventListener('touchstart', handleStart);
      container.removeEventListener('mousemove', handleMove);
      container.removeEventListener('touchmove', handleMove);
      container.removeEventListener('mouseup', handleEnd);
      container.removeEventListener('touchend', handleEnd);
    };
  }, [containerRef, playerRef, setSeekingTime]);
};

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export default function VideoJsPlayer({
  url,
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
  // ========== REFS ==========
  const containerRef = useRef<HTMLDivElement>(null);
  const videoWrapperRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<Player | null>(null);
  const hlsRef = useRef<Hls | null>(null);
  const hasSkippedIntroRef = useRef(false);
  const callbacksRef = useRef({
    onReady,
    onTimeUpdate,
    onEnded,
    onError,
    onPlay,
    onPause,
  });

  // ========== STATE ==========
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [playerReady, setPlayerReady] = useState(false);
  const [isPaused, setIsPaused] = useState(true);
  const [seekingTime, setSeekingTime] = useState<number | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [casEnabled, setCasEnabled] = useState(true);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [isRotatedFullscreen, setIsRotatedFullscreen] = useState(false);

  // Check for AirPlay support (Safari only)
  const hasAirPlay =
    typeof window !== 'undefined' &&
    'WebKitPlaybackTargetAvailabilityEvent' in window;

  // ========== EFFECTS ==========

  // Keep callbacks ref in sync
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

  // Load persisted settings on mount
  useEffect(() => {
    try {
      setCasEnabled(localStorage.getItem('lunatv_cas_enabled') !== 'false');
    } catch {
      /* ignore */
    }
    try {
      const s = localStorage.getItem(`lunatv_speed_${seriesId}`);
      if (s) setPlaybackRate(parseFloat(s));
    } catch {
      /* ignore */
    }
  }, [seriesId]);

  // ========== HANDLERS ==========

  /** Toggle CAS enhancement and persist setting */
  const toggleCas = useCallback(() => {
    setCasEnabled((p) => {
      const n = !p;
      try {
        localStorage.setItem('lunatv_cas_enabled', n.toString());
      } catch {
        /* ignore */
      }
      return n;
    });
  }, []);

  /** Change playback speed and persist setting */
  const changeSpeed = useCallback(
    (rate: number) => {
      setPlaybackRate(rate);
      playerRef.current?.playbackRate(rate);
      try {
        localStorage.setItem(`lunatv_speed_${seriesId}`, rate.toString());
      } catch {
        /* ignore */
      }
    },
    [seriesId],
  );

  /** Initialize HLS.js for streaming playback */
  const initHls = useCallback(
    (video: HTMLVideoElement, src: string) => {
      hlsRef.current?.destroy();
      if (!Hls.isSupported()) {
        video.src = src;
        return;
      }

      // Configure HLS.js - use different settings for live vs VOD
      const hlsConfig: Partial<typeof Hls.DefaultConfig> = {
        debug,
        enableWorker: true,
        lowLatencyMode: isLive, // Enable low latency for live streams
        loader: customHlsLoader || Hls.DefaultConfig.loader,
        // Live-specific settings
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
        if (data.fatal) callbacksRef.current.onError?.(data);
      });
      hlsRef.current = hls;
    },
    [customHlsLoader, debug, isLive],
  );

  /** Toggle native browser fullscreen mode */
  const toggleFullscreen = useCallback(() => {
    const container = containerRef.current;
    const video = container?.querySelector('video') as HTMLVideoElement | null;
    if (!container) return;

    if (!isFullscreen) {
      // Try native fullscreen API first (desktop browsers)
      if (container.requestFullscreen) {
        container.requestFullscreen().catch(() => {
          /* ignore */
        });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } else if ((container as any).webkitRequestFullscreen) {
        // Safari desktop
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (container as any).webkitRequestFullscreen();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } else if (video && (video as any).webkitEnterFullscreen) {
        // iOS Safari - must use video element directly
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (video as any).webkitEnterFullscreen();
      }
      setIsFullscreen(true);
    } else {
      // Exit fullscreen
      if (document.exitFullscreen) {
        document.exitFullscreen().catch(() => {
          /* ignore */
        });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } else if ((document as any).webkitExitFullscreen) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (document as any).webkitExitFullscreen();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } else if (video && (video as any).webkitExitFullscreen) {
        // iOS Safari
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (video as any).webkitExitFullscreen();
      }
      setIsFullscreen(false);
    }
    // Trigger resize for proper video scaling
    setTimeout(() => playerRef.current?.trigger('resize'), 50);
  }, [isFullscreen]);

  /** Toggle rotated/page fullscreen mode (CSS-based, for mobile landscape) */
  const toggleRotatedFullscreen = useCallback(() => {
    if (!isRotatedFullscreen) {
      containerRef.current?.classList.add('videojs-rotated-fullscreen');
      setIsRotatedFullscreen(true);
    } else {
      containerRef.current?.classList.remove('videojs-rotated-fullscreen');
      setIsRotatedFullscreen(false);
    }
    setTimeout(() => playerRef.current?.trigger('resize'), 50);
  }, [isRotatedFullscreen]);

  /** Toggle play/pause */
  const togglePlay = useCallback(() => {
    if (isPaused) {
      playerRef.current?.play();
    } else {
      playerRef.current?.pause();
    }
  }, [isPaused]);

  /** Handle click/touch on progress bar to seek */
  const handleSeek = useCallback(
    (
      e: React.MouseEvent<HTMLDivElement> | React.TouchEvent<HTMLDivElement>,
    ) => {
      const bar = e.currentTarget;
      const rect = bar.getBoundingClientRect();
      const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
      const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      playerRef.current?.currentTime(pct * duration);
    },
    [duration],
  );

  // ========== PLAYER INITIALIZATION ==========

  useEffect(() => {
    if (!videoWrapperRef.current) return;

    // Cleanup previous instance
    playerRef.current?.dispose();
    playerRef.current = null;
    setPlayerReady(false);

    // Create video element
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
    videoElement.setAttribute('crossOrigin', 'anonymous'); // Required for CAS shader
    wrapper.appendChild(videoElement);

    // Initialize Video.js with minimal config (we use custom controls)
    const player = videojs(videoElement, {
      controls: false, // Using custom React controls
      autoPlay,
      preload: 'auto',
      fluid: false,
      fill: true,
      poster,
      playsinline: true,
      html5: { vhs: false }, // Disable native VHS, using HLS.js
      ...videoJsOptions,
    });

    playerRef.current = player;
    hasSkippedIntroRef.current = false;

    // Player ready handler
    player.ready(() => {
      setPlayerReady(true);
      player.playbackRate(playbackRate);

      // Force autoplay if requested
      if (autoPlay) {
        const playPromise = player.play();
        if (playPromise !== undefined) {
          playPromise.catch((error) => {
            console.warn('Autoplay prevented:', error);
            // If autoplay is blocked, show controls so user can start
            setControlsVisible(true);
          });
        }
      }

      callbacksRef.current.onReady?.(player);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (player as any).hotkeys?.({
        volumeStep: 0.1,
        seekStep: 10,
        enableMute: true,
        enableFullscreen: true,
        enableNumbers: false,
      });
    });

    // Event bindings
    player.on('useractive', () => setControlsVisible(true));
    player.on('userinactive', () => setControlsVisible(false));
    player.on('play', () => {
      setIsPaused(false);
      callbacksRef.current.onPlay?.();
    });
    player.on('pause', () => {
      setIsPaused(true);
      callbacksRef.current.onPause?.();
    });
    player.on('ended', () => callbacksRef.current.onEnded?.());
    player.on('durationchange', () => setDuration(player.duration() || 0));
    player.on('timeupdate', () => {
      const t = player.currentTime() || 0,
        d = player.duration() || 0;
      setCurrentTime(t);
      callbacksRef.current.onTimeUpdate?.(t, d);

      // Auto skip intro/outro
      if (enableSkip) {
        if (
          skipIntroTime > 0 &&
          t < skipIntroTime &&
          !hasSkippedIntroRef.current
        ) {
          player.currentTime(skipIntroTime);
          hasSkippedIntroRef.current = true;
        }
        if (skipOutroTime > 0 && d - t <= skipOutroTime) {
          callbacksRef.current.onEnded?.();
        }
      }
    });

    // Load video source - detect HLS by URL pattern (including proxy URLs)
    const isHlsUrl =
      url?.includes('.m3u8') ||
      url?.includes('/proxy/m3u8') ||
      url?.includes('m3u8?');
    if (isHlsUrl) {
      player.ready(() => {
        const v = videoElement.querySelector('.vjs-tech') as HTMLVideoElement;
        if (v) initHls(v, url);
      });
    } else {
      player.src({ src: url, type: 'video/mp4' });
    }

    // Cleanup
    return () => {
      hlsRef.current?.destroy();
      hlsRef.current = null;
      playerRef.current?.dispose();
      playerRef.current = null;
      setPlayerReady(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    url,
    autoPlay,
    poster,
    enableSkip,
    skipIntroTime,
    skipOutroTime,
    initHls,
    playbackRate,
  ]);

  // Handle window resize/orientation
  useEffect(() => {
    const handleResize = () => playerRef.current?.trigger('resize');
    window.addEventListener('resize', handleResize);
    window.addEventListener('orientationchange', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('orientationchange', handleResize);
    };
  }, []);

  // Sync fullscreen state with browser
  useEffect(() => {
    const handleFullscreenChange = () => {
      const isFS = !!(
        document.fullscreenElement ||
        (document as any).webkitFullscreenElement // eslint-disable-line @typescript-eslint/no-explicit-any
      );
      setIsFullscreen(isFS);
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    document.addEventListener('webkitfullscreenchange', handleFullscreenChange);
    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
      document.removeEventListener(
        'webkitfullscreenchange',
        handleFullscreenChange,
      );
    };
  }, []);

  // Apply custom hooks
  useCasShader(playerReady, casEnabled, containerRef, debug);
  usePlayerGestures(containerRef, playerRef, setSeekingTime);

  // ========== HELPERS ==========

  /** Format seconds to MM:SS or HH:MM:SS */
  const formatTime = (s: number) => {
    if (!Number.isFinite(s)) return '0:00';
    const h = Math.floor(s / 3600),
      m = Math.floor((s % 3600) / 60),
      sec = Math.floor(s % 60);
    return h > 0
      ? `${h}:${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`
      : `${m}:${sec.toString().padStart(2, '0')}`;
  };

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

  // ========== RENDER ==========

  return (
    <div
      className={`player-container ${className}`}
      ref={containerRef}
      onClick={() => {
        // Toggle controls on container click (background/video tap)
        setControlsVisible((v) => !v);
      }}
    >
      {/* Video.js wrapper - video element inserted here dynamically */}
      <div ref={videoWrapperRef} className='video-wrapper' />

      {/* Custom Controls Overlay */}
      <div
        className={`player-controls ${controlsVisible ? 'visible' : ''}`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Top Bar - Settings only */}
        <div className='top-bar'>
          <button
            className='ctrl-btn'
            onClick={() => setSettingsOpen(!settingsOpen)}
            title='Settings'
          >
            {Icons.settings}
          </button>
        </div>

        {/* Center - Large Play/Pause + Floating Rotate Button */}
        <div className='center-area' onClick={togglePlay}>
          <button className='big-play-btn'>
            {isPaused ? Icons.play : Icons.pause}
          </button>

          {/* Floating Page/Rotate Fullscreen Button - Middle Left */}
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
        </div>

        {/* Bottom Bar - Main Controls */}
        <div className='bottom-bar'>
          {/* Play/Pause */}
          <button className='ctrl-btn' onClick={togglePlay}>
            {isPaused ? Icons.play : Icons.pause}
          </button>

          {/* Next Episode (if available) */}
          {hasNextEpisode && (
            <button
              className='ctrl-btn'
              onClick={() => onNextEpisode?.()}
              title='Next'
            >
              {Icons.next}
            </button>
          )}

          {/* Current Time */}
          <div className='time-display'>
            {formatTime(seekingTime ?? currentTime)}
          </div>

          {/* Progress Bar */}
          <div
            className='progress-bar'
            onClick={handleSeek}
            onTouchStart={handleSeek}
          >
            <div className='progress-track'>
              <div
                className='progress-fill'
                style={{ width: `${progress}%` }}
              />
              <div
                className='progress-thumb'
                style={{ left: `${progress}%` }}
              />
            </div>
          </div>

          {/* Duration */}
          <div className='time-display'>{formatTime(duration)}</div>

          {/* Speed Control */}
          <button
            className='ctrl-btn speed-btn'
            onClick={() =>
              changeSpeed(playbackRate >= 2 ? 0.5 : playbackRate + 0.25)
            }
            title='Speed'
          >
            {playbackRate}x
          </button>

          {/* AirPlay (Safari only) */}
          {hasAirPlay && (
            <button
              className='ctrl-btn'
              onClick={() => {
                (containerRef.current?.querySelector('video') as any) // eslint-disable-line @typescript-eslint/no-explicit-any
                  ?.webkitShowPlaybackTargetPicker?.();
              }}
              title='AirPlay'
            >
              {Icons.airplay}
            </button>
          )}

          {/* Fullscreen Toggle */}
          <button
            className='ctrl-btn'
            onClick={toggleFullscreen}
            title='Fullscreen'
          >
            {isFullscreen ? Icons.exitFullscreen : Icons.fullscreen}
          </button>
        </div>
      </div>

      {/* Settings Popup */}
      {settingsOpen && (
        <div className='settings-popup' onClick={(e) => e.stopPropagation()}>
          <div className='settings-header'>Settings</div>

          {/* CAS Toggle */}
          <div className='settings-item' onClick={toggleCas}>
            <span>Enhance HD</span>
            <div className={`toggle ${casEnabled ? 'on' : ''}`}>
              <div className='toggle-knob' />
            </div>
          </div>

          {/* Speed Selector */}
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

      {/* Seek Overlay - Shows during swipe-to-seek */}
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

// ============================================================================
// CSS STYLES
// ============================================================================

const CSS = `
/* ===== Container ===== */
.player-container { 
  position: relative; 
  width: 100%; 
  height: 100%; 
  background: #000; 
  overflow: hidden; 
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; 
}

.video-wrapper { 
  position: absolute; 
  inset: 0; 
}

.player-container .video-js { 
  position: absolute; 
  inset: 0; 
  width: 100%; 
  height: 100%; 
}

/* Hide Video.js native controls */
.player-container .vjs-control-bar { display: none !important; }
.player-container .vjs-big-play-button { display: none !important; }

/* ===== Icon Sizing ===== */
.icon { 
  width: 24px; 
  height: 24px; 
  display: block; 
}

/* ===== Controls Overlay ===== */
.player-controls { 
  position: absolute; 
  inset: 0; 
  display: flex; 
  flex-direction: column; 
  justify-content: space-between; 
  opacity: 0; 
  transition: opacity 0.3s; 
  pointer-events: none; 
  z-index: 10; 
  background: linear-gradient(to bottom, rgba(0,0,0,0.6) 0%, transparent 25%, transparent 75%, rgba(0,0,0,0.8) 100%); 
}

.player-controls.visible { 
  opacity: 1; 
  pointer-events: auto; 
}

/* ===== Top & Bottom Bars ===== */
.top-bar, .bottom-bar { 
  display: flex; 
  align-items: center; 
  gap: 8px; 
  padding: 12px 16px; 
}

.top-bar { 
  justify-content: flex-end; 
}

.bottom-bar { 
  padding-bottom: max(12px, env(safe-area-inset-bottom)); 
}

/* ===== Control Buttons - Unified 44x44px ===== */
.ctrl-btn { 
  width: 44px; 
  height: 44px; 
  display: flex; 
  align-items: center; 
  justify-content: center; 
  background: transparent; 
  border: none; 
  color: white; 
  cursor: pointer; 
  padding: 0; 
  border-radius: 8px; 
  transition: background 0.2s; 
  flex-shrink: 0; 
}

.ctrl-btn:hover { 
  background: rgba(255,255,255,0.1); 
}

.ctrl-btn:active { 
  background: rgba(255,255,255,0.2); 
  transform: scale(0.95); 
}

/* Speed Button with Text */
.speed-btn { 
  font-size: 13px; 
  font-weight: 600; 
  min-width: 44px; 
}

/* ===== Center Play Button ===== */
.center-area { 
  flex: 1; 
  display: flex; 
  align-items: center; 
  justify-content: center; 
  cursor: pointer; 
}

.big-play-btn { 
  width: 72px; 
  height: 72px; 
  border-radius: 50%; 
  background: rgba(0,0,0,0.5); 
  border: 2px solid rgba(255,255,255,0.8); 
  color: white; 
  display: flex; 
  align-items: center; 
  justify-content: center; 
  cursor: pointer; 
  backdrop-filter: blur(8px); 
  transition: transform 0.2s, background 0.2s; 
}

.big-play-btn:hover { 
  background: rgba(0,0,0,0.7); 
}

.big-play-btn:active { 
  transform: scale(0.95); 
}

.big-play-btn .icon { 
  width: 36px; 
  height: 36px; 
}

/* ===== Floating Rotate Fullscreen Button ===== */
.rotate-fullscreen-btn {
  position: absolute;
  left: 16px;
  top: 50%;
  transform: translateY(-50%);
  width: 44px;
  height: 44px;
  border-radius: 50%;
  background: rgba(0,0,0,0.5);
  border: 1px solid rgba(255,255,255,0.3);
  color: white;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  backdrop-filter: blur(4px);
  transition: transform 0.2s, background 0.2s;
}

.rotate-fullscreen-btn:hover {
  background: rgba(0,0,0,0.7);
}

.rotate-fullscreen-btn:active {
  transform: translateY(-50%) scale(0.95);
}

/* ===== Time Display ===== */
.time-display { 
  font-size: 13px; 
  color: white; 
  font-variant-numeric: tabular-nums; 
  min-width: 45px; 
  text-align: center; 
  flex-shrink: 0; 
}

/* ===== Progress Bar ===== */
.progress-bar { 
  flex: 1; 
  height: 44px; 
  display: flex; 
  align-items: center; 
  cursor: pointer; 
  padding: 0 4px; 
  min-width: 60px; 
}

.progress-track { 
  position: relative; 
  width: 100%; 
  height: 4px; 
  background: rgba(255,255,255,0.3); 
  border-radius: 2px; 
}

.progress-fill { 
  height: 100%; 
  background: #4CAF50; 
  border-radius: 2px; 
}

.progress-thumb { 
  position: absolute; 
  top: 50%; 
  width: 14px; 
  height: 14px; 
  background: white; 
  border-radius: 50%; 
  transform: translate(-50%, -50%); 
  box-shadow: 0 2px 4px rgba(0,0,0,0.3); 
}

/* ===== Settings Popup ===== */
.settings-popup { 
  position: absolute; 
  top: 60px; 
  right: 16px; 
  background: rgba(28,28,30,0.95); 
  backdrop-filter: blur(20px); 
  border-radius: 12px; 
  padding: 8px 0; 
  min-width: 200px; 
  z-index: 100; 
  border: 1px solid rgba(255,255,255,0.1); 
}

.settings-header { 
  padding: 12px 16px; 
  font-size: 15px; 
  font-weight: 600; 
  color: white; 
  border-bottom: 1px solid rgba(255,255,255,0.1); 
}

.settings-item { 
  display: flex; 
  justify-content: space-between; 
  align-items: center; 
  padding: 12px 16px; 
  color: white; 
  cursor: pointer; 
  font-size: 14px; 
}

.settings-item:hover { 
  background: rgba(255,255,255,0.05); 
}

.settings-item select { 
  background: transparent; 
  border: 1px solid rgba(255,255,255,0.2); 
  color: white; 
  padding: 4px 8px; 
  border-radius: 6px; 
  font-size: 13px; 
}

/* ===== Toggle Switch ===== */
.toggle { 
  width: 44px; 
  height: 26px; 
  background: #555; 
  border-radius: 13px; 
  position: relative; 
  transition: background 0.2s; 
  flex-shrink: 0; 
}

.toggle.on { 
  background: #4CAF50; 
}

.toggle-knob { 
  position: absolute; 
  top: 3px; 
  left: 3px; 
  width: 20px; 
  height: 20px; 
  background: white; 
  border-radius: 50%; 
  transition: left 0.2s; 
}

.toggle.on .toggle-knob { 
  left: 21px; 
}

/* ===== Seek Overlay ===== */
.seek-overlay { 
  position: absolute; 
  inset: 0; 
  background: rgba(0,0,0,0.7); 
  display: flex; 
  flex-direction: column; 
  align-items: center; 
  justify-content: center; 
  z-index: 50; 
  pointer-events: none; 
}

.seek-time { 
  font-size: 32px; 
  font-weight: 600; 
  color: white; 
  margin-bottom: 16px; 
}

.seek-bar { 
  width: 70%; 
  height: 6px; 
  background: rgba(255,255,255,0.3); 
  border-radius: 3px; 
  overflow: hidden; 
}

.seek-fill { 
  height: 100%; 
  background: #4CAF50; 
}

/* ===== Rotated Fullscreen Mode ===== */
.videojs-rotated-fullscreen { 
  position: fixed !important; 
  width: 100vh !important; 
  height: 100vw !important; 
  top: 50% !important; 
  left: 50% !important; 
  transform: translate(-50%, -50%) rotate(90deg) !important; 
  z-index: 99999 !important; 
  background: #000 !important; 
}

@supports (width: 100dvh) { 
  .videojs-rotated-fullscreen { 
    width: 100dvh !important; 
    height: 100dvw !important; 
  } 
}

/* ===== Mobile Adjustments ===== */
@media (max-width: 480px) {
  .ctrl-btn { 
    width: 40px; 
    height: 40px; 
  }
  
  .time-display { 
    font-size: 12px; 
    min-width: 38px; 
  }
  
  .speed-btn { 
    font-size: 12px; 
    min-width: 40px; 
  }
  
  .big-play-btn { 
    width: 64px; 
    height: 64px; 
  }
  
  .big-play-btn .icon { 
    width: 32px; 
    height: 32px; 
  }
}
`;
