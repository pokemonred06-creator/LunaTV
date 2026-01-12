'use client';

import Hls from 'hls.js';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import videojs from 'video.js';
import Player from 'video.js/dist/types/player';

import 'video.js/dist/video-js.css';

interface VideoJsPlayerProps {
  url: string;
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
}

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
}: VideoJsPlayerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const videoWrapperRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<Player | null>(null);
  const hlsRef = useRef<Hls | null>(null);
  const animationFrameRef = useRef<number | undefined>(undefined);
  
  // Core State
  const [fullscreenLevel, setFullscreenLevel] = useState<0 | 1 | 2>(0);
  const fullscreenLevelRef = useRef<0 | 1 | 2>(0);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [playerReady, setPlayerReady] = useState(false);
  
  // Mount points for control bar buttons
  const [settingsMount, setSettingsMount] = useState<HTMLElement | null>(null);
  const [nextMount, setNextMount] = useState<HTMLElement | null>(null);

  // Settings UI State
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(1.0);
  const [casEnabled, setCasEnabled] = useState(true); // Default ON
  
  // Seeking State  
  const [seekingTime, setSeekingTime] = useState<number | null>(null);
  const gestureRef = useRef({
    startX: 0, startY: 0, startTime: 0, startVideoTime: 0,
    isSeeking: false, wasPlaying: false, active: false
  });

  // Callbacks ref for stability
  const callbacksRef = useRef({ onReady, onTimeUpdate, onEnded, onError, onPlay, onPause });
  useEffect(() => { 
    callbacksRef.current = { onReady, onTimeUpdate, onEnded, onError, onPlay, onPause }; 
  }, [onReady, onTimeUpdate, onEnded, onError, onPlay, onPause]);
  
  useEffect(() => { fullscreenLevelRef.current = fullscreenLevel; }, [fullscreenLevel]);

  // Check for AirPlay support
  const hasAirPlay = typeof window !== 'undefined' && 'WebKitPlaybackTargetAvailabilityEvent' in window;

  // Load persisted settings
  useEffect(() => {
    try {
      const savedSpeed = localStorage.getItem(`lunatv_speed_${seriesId}`);
      if (savedSpeed) setPlaybackSpeed(parseFloat(savedSpeed));
      const savedCas = localStorage.getItem('lunatv_cas_enabled');
      setCasEnabled(savedCas !== 'false');
    } catch (_e) { /* ignore */ }
  }, [seriesId]);

  // Utility: Format time
  const formatTime = useCallback((seconds: number): string => {
    if (!isFinite(seconds) || isNaN(seconds)) return '0:00';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    return h > 0 ? `${h}:${m.toString().padStart(2,'0')}:${s.toString().padStart(2,'0')}` : `${m}:${s.toString().padStart(2,'0')}`;
  }, []);

  // Settings handlers
  const handleSpeedChange = useCallback((speed: number) => {
    setPlaybackSpeed(speed);
    if (playerRef.current) playerRef.current.playbackRate(speed);
    try { localStorage.setItem(`lunatv_speed_${seriesId}`, speed.toString()); } catch { /* localStorage unavailable */ }
    setSettingsOpen(false);
  }, [seriesId]);

  const handleCasToggle = useCallback(() => {
    setCasEnabled(prev => {
      const newState = !prev;
      try { localStorage.setItem('lunatv_cas_enabled', newState.toString()); } catch { /* localStorage unavailable */ }
      return newState;
    });
  }, []);

  // Toggle controls visibility
  const toggleControls = useCallback(() => {
    if (playerRef.current) {
      const current = playerRef.current.userActive();
      playerRef.current.userActive(!current);
      setControlsVisible(!current);
    }
  }, []);

  // Fullscreen handlers
  const enterRotated = useCallback(() => { 
    containerRef.current?.classList.add('videojs-rotated-fullscreen'); 
    setFullscreenLevel(1); 
    playerRef.current?.trigger('resize'); 
  }, []);

  const exitFullscreen = useCallback(() => { 
    containerRef.current?.classList.remove('videojs-rotated-fullscreen'); 
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    setFullscreenLevel(0); 
    playerRef.current?.trigger('resize'); 
  }, []);

  const toggleFullscreen = useCallback(() => {
    if (fullscreenLevel === 0) {
      enterRotated();
    } else {
      exitFullscreen();
    }
  }, [fullscreenLevel, enterRotated, exitFullscreen]);

  // AirPlay handler
  const showAirPlayPicker = useCallback(() => {
    const video = containerRef.current?.querySelector('video');
    if (video && 'webkitShowPlaybackTargetPicker' in video) {
      (video as HTMLVideoElement & { webkitShowPlaybackTargetPicker: () => void }).webkitShowPlaybackTargetPicker();
    }
  }, []);

  // HLS initialization
  const initHls = useCallback((video: HTMLVideoElement, src: string) => {
    if (hlsRef.current) hlsRef.current.destroy();
    if (!Hls.isSupported()) { 
      video.src = src; 
      return; 
    }
    const hls = new Hls({ 
      debug, 
      enableWorker: true, 
      lowLatencyMode: true, 
      loader: customHlsLoader || Hls.DefaultConfig.loader 
    });
    hls.loadSource(src);
    hls.attachMedia(video);
    hls.on(Hls.Events.ERROR, (_, data) => { 
      if (data.fatal) callbacksRef.current.onError?.(data); 
    });
    hlsRef.current = hls;
  }, [customHlsLoader, debug]);

  // ==================== GESTURE HANDLING ====================
  // Use document-level listeners but check if target is in control bar
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const getPos = (e: TouchEvent | MouseEvent) => {
      const touch = 'touches' in e ? (e.touches[0] || e.changedTouches?.[0]) : null;
      if (touch) return { x: touch.clientX, y: touch.clientY };
      if ('clientX' in e) return { x: e.clientX, y: e.clientY };
      return null;
    };

    const handleStart = (e: TouchEvent | MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!container.contains(target)) return;
      // Ignore if clicking on control bar, buttons, or rotation button
      if (target.closest('.vjs-control-bar, .vjs-big-play-button, .settings-popup, .rotation-button, button')) return;

      const pos = getPos(e);
      if (!pos) return;
      
      const gesture = gestureRef.current;
      gesture.startX = pos.x;
      gesture.startY = pos.y;
      gesture.startTime = Date.now();
      gesture.startVideoTime = playerRef.current?.currentTime() || 0;
      gesture.wasPlaying = playerRef.current ? !playerRef.current.paused() : false;
      gesture.isSeeking = false;
      gesture.active = true;
    };

    const handleMove = (e: TouchEvent | MouseEvent) => {
      const gesture = gestureRef.current;
      if (!gesture.active) return;

      const pos = getPos(e);
      if (!pos) return;

      const dx = pos.x - gesture.startX;
      const dy = pos.y - gesture.startY;
      const isRotated = fullscreenLevelRef.current === 1;

      if (!gesture.isSeeking) {
        const threshold = 10; // Lower threshold for easier swipe detection
        if (Math.abs(dx) > threshold || Math.abs(dy) > threshold) {
          const isHorizontalSwipe = Math.abs(dx) > Math.abs(dy);
          const isSeekDirection = isRotated ? !isHorizontalSwipe : isHorizontalSwipe;
          if (isSeekDirection) {
            gesture.isSeeking = true;
            if (gesture.wasPlaying) playerRef.current?.pause();
          } else {
            gesture.active = false;
          }
        }
      }

      if (gesture.isSeeking) {
        const duration = playerRef.current?.duration() || 0;
        if (duration > 0) {
          const delta = isRotated ? dy : dx;
          const sensitivity = 0.5; // seconds per pixel - higher = faster seeking
          const newTime = Math.max(0, Math.min(duration, gesture.startVideoTime + (delta * sensitivity)));
          setSeekingTime(newTime);
        }
      }
    };

    const handleEnd = (e: TouchEvent | MouseEvent) => {
      const gesture = gestureRef.current;
      
      if (gesture.isSeeking && seekingTime !== null) {
        playerRef.current?.currentTime(seekingTime);
        setSeekingTime(null);
        if (gesture.wasPlaying) playerRef.current?.play();
      } else if (gesture.active && !gesture.isSeeking) {
        const pos = getPos(e);
        const dt = Date.now() - gesture.startTime;
        const dist = pos ? Math.sqrt(Math.pow(pos.x - gesture.startX, 2) + Math.pow(pos.y - gesture.startY, 2)) : 0;
        if (dt < 300 && dist < 15) {
          toggleControls();
        }
      }
      
      gesture.active = false;
      gesture.isSeeking = false;
      gesture.startX = 0;
      gesture.startY = 0;
    };

    document.addEventListener('mousedown', handleStart, { capture: true });
    document.addEventListener('touchstart', handleStart, { capture: true, passive: true });
    document.addEventListener('mousemove', handleMove, { capture: true });
    document.addEventListener('touchmove', handleMove, { capture: true, passive: true });
    document.addEventListener('mouseup', handleEnd, { capture: true });
    document.addEventListener('touchend', handleEnd, { capture: true });

    return () => {
      document.removeEventListener('mousedown', handleStart, { capture: true });
      document.removeEventListener('touchstart', handleStart, { capture: true });
      document.removeEventListener('mousemove', handleMove, { capture: true });
      document.removeEventListener('touchmove', handleMove, { capture: true });
      document.removeEventListener('mouseup', handleEnd, { capture: true });
      document.removeEventListener('touchend', handleEnd, { capture: true });
    };
  }, [seekingTime, toggleControls]);

  // ==================== MAIN PLAYER INITIALIZATION ====================
  useEffect(() => {
    if (!videoWrapperRef.current) return;
    const wrapper = videoWrapperRef.current;
    wrapper.innerHTML = '';
    
    const videoElement = document.createElement('video-js');
    videoElement.classList.add('vjs-big-play-centered');
    Object.assign(videoElement.style, { 
      position: 'absolute', top: '0', left: '0', width: '100%', height: '100%' 
    });
    videoElement.setAttribute('crossOrigin', 'anonymous');
    wrapper.appendChild(videoElement);

    const player = videojs(videoElement, {
      controls: true, autoplay: autoPlay, preload: 'auto', fluid: false, fill: true,
      poster, playsinline: true, html5: { vhs: false },
      playbackRates: [0.5, 0.75, 1, 1.25, 1.5, 2]
    });
    playerRef.current = player;

    // Inject settings mount into control bar
    const injectMount = () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const controlBar = (player as any).controlBar;
      if (!controlBar) return;
      const el = controlBar.el() as HTMLElement;
      if (!el) return;
      
      // Settings mount (before fullscreen)
      if (!el.querySelector('.vjs-custom-settings-mount')) {
        const mount = document.createElement('div');
        mount.className = 'vjs-custom-settings-mount vjs-control';
        mount.style.cssText = 'display: flex; align-items: center; height: 100%; margin-right: 8px;';
        const fullscreenBtn = el.querySelector('.vjs-fullscreen-control');
        if (fullscreenBtn) {
          el.insertBefore(mount, fullscreenBtn);
        } else {
          el.appendChild(mount);
        }
        setSettingsMount(mount);
      }
      
      // Next episode mount (after play button)
      if (!el.querySelector('.vjs-custom-next-mount')) {
        const nextMountEl = document.createElement('div');
        nextMountEl.className = 'vjs-custom-next-mount vjs-control';
        nextMountEl.style.cssText = 'display: flex; align-items: center; height: 100%;';
        const playBtn = el.querySelector('.vjs-play-control');
        if (playBtn && playBtn.nextSibling) {
          el.insertBefore(nextMountEl, playBtn.nextSibling);
        } else if (playBtn) {
          playBtn.parentNode?.insertBefore(nextMountEl, playBtn.nextSibling);
        }
        setNextMount(nextMountEl);
      }
    };

    player.ready(() => {
      setPlayerReady(true);
      callbacksRef.current.onReady?.(player);
      injectMount();
      setTimeout(injectMount, 200);
      setTimeout(injectMount, 500);
      
      // Apply saved speed
      try {
        const savedSpeed = localStorage.getItem(`lunatv_speed_${seriesId}`);
        if (savedSpeed) {
          const speed = parseFloat(savedSpeed);
          player.playbackRate(speed);
          setPlaybackSpeed(speed);
        }
      } catch { /* localStorage unavailable */ }
    });

    // Event listeners
    player.on('useractive', () => setControlsVisible(true));
    player.on('userinactive', () => setControlsVisible(false));
    player.on('play', () => callbacksRef.current.onPlay?.());
    player.on('pause', () => callbacksRef.current.onPause?.());
    player.on('ratechange', () => { 
      const r = player.playbackRate(); 
      if (r) setPlaybackSpeed(r); 
    });
    player.on('ended', () => callbacksRef.current.onEnded?.());
    player.on('timeupdate', () => {
      const t = player.currentTime() || 0;
      const d = player.duration() || 0;
      callbacksRef.current.onTimeUpdate?.(t, d);
      if (enableSkip && skipIntroTime > 0 && t < skipIntroTime) player.currentTime(skipIntroTime);
      if (enableSkip && skipOutroTime > 0 && d - t <= skipOutroTime) callbacksRef.current.onEnded?.();
    });
    player.options_.inactivityTimeout = 3000;

    // Load source
    if (url?.includes('.m3u8')) {
      player.ready(() => { 
        const v = videoElement.querySelector('.vjs-tech') as HTMLVideoElement;
        if (v) initHls(v, url);
      });
    } else {
      player.src({ src: url, type: 'video/mp4' });
    }

    return () => {
      if (hlsRef.current) hlsRef.current.destroy();
      if (playerRef.current) playerRef.current.dispose();
      setPlayerReady(false);
      setSettingsMount(null);
    };
  }, [url, autoPlay, poster, enableSkip, skipIntroTime, skipOutroTime, initHls, seriesId]);

  // ==================== CAS EFFECT ====================
  useEffect(() => {
    if (!playerReady || !casEnabled) return;
    const tech = containerRef.current?.querySelector('.vjs-tech') as HTMLVideoElement;
    if (!tech) return;
    if (document.getElementById('cas-canvas')) return;
    
    const canvas = document.createElement('canvas');
    canvas.id = 'cas-canvas';
    Object.assign(canvas.style, { 
      position: 'absolute', top: '0', left: '0', width: '100%', height: '100%', 
      pointerEvents: 'none', zIndex: '1', objectFit: 'contain'
    });
    tech.parentElement?.insertBefore(canvas, tech.nextSibling);
    
    const gl = canvas.getContext('webgl', { alpha: false, preserveDrawingBuffer: false, antialias: false });
    if (!gl) return;
    
    const vs = `attribute vec2 position; varying vec2 v_texCoord; void main() { gl_Position = vec4(position,0,1); v_texCoord = position*0.5+0.5; v_texCoord.y=1.0-v_texCoord.y; }`;
    const fs = `precision mediump float; varying vec2 v_texCoord; uniform sampler2D u_image; uniform vec2 u_resolution; uniform float u_sharpness;
      void main() {
        vec2 tex = 1.0 / u_resolution;
        vec3 e = texture2D(u_image, v_texCoord).rgb;
        vec3 a = texture2D(u_image, v_texCoord + vec2(0.0, -tex.y)).rgb;
        vec3 c = texture2D(u_image, v_texCoord + vec2(-tex.x, 0.0)).rgb;
        vec3 g = texture2D(u_image, v_texCoord + vec2(tex.x, 0.0)).rgb;
        vec3 i = texture2D(u_image, v_texCoord + vec2(0.0, tex.y)).rgb;
        float sharp = clamp(u_sharpness, 0.0, 1.0);
        float w = -1.0 / mix(8.0, 5.0, sharp);
        vec3 res = (a + c + g + i) * w + e;
        float div = 1.0 + 4.0 * w;
        vec3 final = res / div;
        vec3 mn = min(min(min(a, c), g), i); vec3 mx = max(max(max(a, c), g), i);
        mn = min(mn, e); mx = max(mx, e);
        final = clamp(final, mn, mx);
        float luminance = dot(final, vec3(0.2126, 0.7152, 0.0722));
        vec3 satColor = mix(vec3(luminance), final, 1.15);
        vec3 contrastColor = (satColor - 0.5) * 1.05 + 0.5;
        gl_FragColor = vec4(contrastColor, 1.0);
      }`;
    
    const createShader = (type: number, src: string) => { 
      const s = gl.createShader(type); if (!s) return null; 
      gl.shaderSource(s, src); gl.compileShader(s); return s; 
    };
    
    const program = gl.createProgram();
    const vsS = createShader(gl.VERTEX_SHADER, vs);
    const fsS = createShader(gl.FRAGMENT_SHADER, fs);
    
    if (program && vsS && fsS) {
      gl.attachShader(program, vsS); gl.attachShader(program, fsS);
      gl.linkProgram(program); gl.useProgram(program);
      
      const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, -1,1, 1,-1, 1,1]), gl.STATIC_DRAW);
      
      const posLoc = gl.getAttribLocation(program, 'position');
      gl.enableVertexAttribArray(posLoc);
      gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);
      
      const texture = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      
      tech.style.opacity = '0';
      
      const render = () => {
        if (!casEnabled) return;
        if (tech.videoWidth > 0 && (canvas.width !== tech.videoWidth || canvas.height !== tech.videoHeight)) {
          canvas.width = tech.videoWidth; canvas.height = tech.videoHeight;
          gl.viewport(0, 0, canvas.width, canvas.height);
        }
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, tech);
        gl.uniform2f(gl.getUniformLocation(program, 'u_resolution'), canvas.width, canvas.height);
        gl.uniform1f(gl.getUniformLocation(program, 'u_sharpness'), 0.6);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
        animationFrameRef.current = requestAnimationFrame(render);
      };
      render();
    }
    
    return () => { 
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
      const c = document.getElementById('cas-canvas'); if (c) c.remove();
      if (tech) tech.style.opacity = '1';
    };
  }, [playerReady, casEnabled]);

  // Button styles - adaptive, no forced sizes
  const ctrlBtnStyle: React.CSSProperties = {
    display: 'flex', 
    alignItems: 'center', 
    justifyContent: 'center',
    cursor: 'pointer', 
    color: 'white', 
    opacity: 0.9,
    background: 'transparent', 
    border: 'none', 
    padding: 4,
    margin: 0,
  };

  const rotationBtnStyle: React.CSSProperties = {
    position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)',
    zIndex: 50, opacity: controlsVisible ? 1 : 0, pointerEvents: controlsVisible ? 'auto' : 'none',
    transition: 'opacity 0.3s',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    width: 44, height: 44, background: 'rgba(0,0,0,0.5)', borderRadius: '50%',
    border: 'none', cursor: 'pointer'
  };

  const popupStyle: React.CSSProperties = {
    position: 'absolute', bottom: 40, right: 0,
    background: 'rgba(30,30,30,0.95)', borderRadius: 8, padding: 12,
    minWidth: 180, zIndex: 9999
  };

  // Settings Button Content (rendered via portal into control bar)
  const settingsPortalContent = settingsMount ? createPortal(
    <>
      {/* AirPlay Button */}
      {hasAirPlay && (
        <button className="custom-ctrl-btn" style={ctrlBtnStyle} onClick={(e) => { e.stopPropagation(); showAirPlayPicker(); }} title="AirPlay">
          <svg viewBox="0 0 24 24" fill="currentColor" width={20} height={20}>
            <path d="M6 22h12l-6-6-6 6zM21 3H3c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h4v-2H3V5h18v12h-4v2h4c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2z"/>
          </svg>
        </button>
      )}
      
      {/* Settings Button */}
      <div style={{ position: 'relative' }}>
        <button className="custom-ctrl-btn" style={ctrlBtnStyle} onClick={(e) => { e.stopPropagation(); setSettingsOpen(!settingsOpen); }} title="Settings">
          <svg viewBox="0 0 24 24" fill="currentColor" width={20} height={20}>
            <path d="M19.14 12.94c.04-.31.06-.63.06-.94 0-.31-.02-.63-.06-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.04.31-.06.63-.06.94s.02.63.06.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z"/>
          </svg>
        </button>
        
        {/* Settings Popup */}
        {settingsOpen && (
          <div className="settings-popup" style={popupStyle} onClick={(e) => e.stopPropagation()}>
            <div 
              style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', color: 'white', padding: '8px 0', cursor: 'pointer' }}
              onClick={handleCasToggle}
            >
              <span>Enhance HD</span>
              <div style={{ 
                width: 40, height: 22, background: casEnabled ? '#4caf50' : '#555', 
                borderRadius: 11, position: 'relative', transition: 'background 0.2s'
              }}>
                <div style={{ 
                  width: 18, height: 18, background: 'white', borderRadius: '50%', 
                  position: 'absolute', top: 2, left: casEnabled ? 20 : 2, transition: 'left 0.2s'
                }} />
              </div>
            </div>
          </div>
        )}
      </div>
    </>,
    settingsMount
  ) : null;

  // Next Episode Button (rendered near play button)
  const nextEpisodePortalContent = (nextMount && hasNextEpisode && onNextEpisode) ? createPortal(
    <button className="custom-ctrl-btn" style={ctrlBtnStyle} onClick={(e) => { e.stopPropagation(); onNextEpisode(); }} title="Next Episode">
      <svg viewBox="0 0 24 24" fill="currentColor" width={20} height={20}>
        <path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z"/>
      </svg>
    </button>,
    nextMount
  ) : null;

  return (
    <div 
      className={`videojs-player-container ${className}`}
      ref={containerRef}
      style={{
        position: fullscreenLevel === 1 ? 'fixed' : 'relative',
        width: fullscreenLevel === 1 ? '100vh' : '100%',
        height: fullscreenLevel === 1 ? '100vw' : '100%',
        top: fullscreenLevel === 1 ? '50%' : undefined,
        left: fullscreenLevel === 1 ? '50%' : undefined,
        transform: fullscreenLevel === 1 ? 'translate(-50%, -50%) rotate(90deg)' : undefined,
        zIndex: fullscreenLevel === 1 ? 99999 : undefined,
        background: '#000',
        overflow: 'hidden'
      }}
    >
      <div ref={videoWrapperRef} style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' }} />
      
      {/* Rotation Button */}
      <button className="rotation-button" style={rotationBtnStyle} onClick={(e) => { e.stopPropagation(); toggleFullscreen(); }}>
        <svg viewBox="0 0 24 24" fill="white" width={24} height={24}>
          <path d="M7.11 8.53L5.7 7.11C4.8 8.27 4.24 9.61 4.07 11h2.02c.14-.87.49-1.72 1.02-2.47zM6.09 13H4.07c.17 1.39.72 2.73 1.62 3.89l1.41-1.42c-.52-.75-.87-1.59-1.01-2.47zm1.01 5.32c1.16.9 2.51 1.44 3.9 1.61V17.9c-.87-.15-1.71-.49-2.46-1.03L7.1 18.32zM13 4.07V1L8.45 5.55 13 10V6.09c2.84.48 5 2.94 5 5.91s-2.16 5.43-5 5.91v2.02c3.95-.49 7-3.85 7-7.93s-3.05-7.44-7-7.93z"/>
        </svg>
      </button>

      {/* Seek Overlay */}
      {seekingTime !== null && (
        <div style={{
          position: 'absolute', top: 0, left: 0, width: '100%', height: '100%',
          background: 'rgba(0,0,0,0.6)', display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center', zIndex: 100, pointerEvents: 'none'
        }}>
          <div style={{ fontSize: 32, fontWeight: 'bold', color: 'white', marginBottom: 16, textShadow: '0 2px 8px rgba(0,0,0,0.8)' }}>
            {formatTime(seekingTime)} / {formatTime(playerRef.current?.duration() || 0)}
          </div>
          <div style={{ width: '70%', height: 6, background: 'rgba(255,255,255,0.3)', borderRadius: 3, overflow: 'hidden' }}>
            <div style={{ height: '100%', background: '#00ff00', width: `${(seekingTime / (playerRef.current?.duration() || 1)) * 100}%` }} />
          </div>
        </div>
      )}

      {/* Portal content */}
      {settingsPortalContent}
      {nextEpisodePortalContent}

      <style>{`
        .videojs-player-container .video-js { 
          position: absolute; 
          top: 0; left: 0; 
          width: 100%; 
          height: 100%; 
        }
        .videojs-player-container .vjs-tech { 
          width: 100% !important; 
          height: 100% !important; 
          object-fit: contain; 
        }
        .videojs-player-container .vjs-control-bar { 
          display: flex !important; 
          width: 100% !important; 
          max-width: 100% !important;
          background: rgba(43,51,63,0.85) !important;
          box-sizing: border-box !important; 
          padding: 0 4px !important;
          align-items: center !important;
          z-index: 10 !important;
        }
        .videojs-player-container .vjs-control-bar .vjs-button,
        .videojs-player-container .vjs-control-bar .vjs-control:not(.vjs-progress-control):not(.vjs-time-control) {
          width: 3em !important;
          min-width: 3em !important;
          flex-shrink: 0 !important;
        }
        .videojs-player-container .vjs-progress-control { 
          flex: 1 1 auto !important; 
        }
        .videojs-player-container canvas { pointer-events: none; }
        .videojs-player-container .vjs-custom-settings-mount { 
          display: flex !important; 
          align-items: center !important;
          height: 100% !important;
          margin-right: 4px !important;
        }
        .videojs-player-container .vjs-custom-next-mount {
          display: flex !important;
          align-items: center !important;
          height: 100% !important;
        }
        .custom-ctrl-btn { 
          width: 3em !important;
          height: 100% !important;
          display: flex !important;
          align-items: center !important;
          justify-content: center !important;
          transition: opacity 0.15s ease; 
          flex-shrink: 0 !important;
        }
        .custom-ctrl-btn svg {
          width: 1.5em;
          height: 1.5em;
        }
        .custom-ctrl-btn:hover, .custom-ctrl-btn:active { opacity: 1 !important; }
        
        /* Rotated fullscreen mode */
        .videojs-rotated-fullscreen {
          position: fixed !important;
          top: 50% !important;
          left: 50% !important;
          width: 100vh !important;
          height: 100vw !important;
          transform: translate(-50%, -50%) rotate(90deg) !important;
          z-index: 99999 !important;
          background: #000 !important;
        }
        .videojs-rotated-fullscreen .vjs-control-bar {
          position: absolute !important;
          bottom: 0 !important;
          left: 0 !important;
          right: 0 !important;
        }
      `}</style>
    </div>
  );
}
