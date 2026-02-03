'use client';

import React, { useEffect, useMemo, useState } from 'react';

type PureSnowProps = {
  count?: number;
  mode?: 'winter' | 'spring' | 'autumn';
  textures?: string[];
};

type Particle = {
  id: number;
  xStart: number;
  xEnd: number;
  size: number;
  opacity: number;
  duration: number;
  delay: number;
  rotation: number;
  bgStyle: React.CSSProperties;
};

const PureSnow: React.FC<PureSnowProps> = ({
  count = 100,
  mode = 'winter',
  textures = [],
}) => {
  const [particles, setParticles] = useState<Particle[]>([]);

  const config = useMemo(() => {
    switch (mode) {
      case 'winter':
        return { sizeBase: 1, opacityBase: 0.8, rotate: false };
      case 'spring':
        return { sizeBase: 1.2, opacityBase: 0.9, rotate: true };
      case 'autumn':
        return { sizeBase: 1.5, opacityBase: 0.9, rotate: true };
      default:
        return { sizeBase: 1, opacityBase: 1, rotate: false };
    }
  }, [mode]);

  // Stability: Join textures to string to prevent re-runs on new array references
  const texturesKey = useMemo(() => textures.join('|'), [textures]);

  useEffect(() => {
    // Generate particles only on client to avoid hydration mismatch
    const newParticles: Particle[] = [];
    const hasTextures = textures.length > 0;

    for (let i = 0; i < count; i++) {
      const size = config.sizeBase * (0.5 + Math.random());

      let bgStyle: React.CSSProperties = {};

      if (hasTextures) {
        const tex = textures[Math.floor(Math.random() * textures.length)];
        bgStyle = {
          backgroundImage: `url(${tex})`,
          backgroundSize: 'contain',
          backgroundRepeat: 'no-repeat',
          backgroundPosition: 'center',
        };
      } else {
        let color = 'white';
        if (mode === 'autumn') {
          const colors = ['#D2691E', '#DAA520', '#8B0000'];
          color = colors[Math.floor(Math.random() * colors.length)];
        } else if (mode === 'spring') {
          const colors = ['#FFC0CB', '#FFB7C5', '#FF69B4'];
          color = colors[Math.floor(Math.random() * colors.length)];
        }
        bgStyle = { backgroundColor: color };
      }

      newParticles.push({
        id: i,
        xStart: Math.random() * 100, // vw
        xEnd: Math.random() * 100, // vw
        size, // vw
        opacity: Math.random() * config.opacityBase,
        duration: 10 + Math.random() * 20, // s
        delay: Math.random() * -30, // s
        rotation: config.rotate ? Math.random() * 360 : 0,
        bgStyle,
      });
    }

    setParticles(newParticles);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [count, mode, config, texturesKey]);

  return (
    <div
      id='pure-snow-container'
      style={{
        position: 'absolute',
        inset: 0,
        pointerEvents: 'none',
        zIndex: 20,
        overflow: 'hidden',
      }}
    >
      {/* Global style prevents duplication if multiple instances mount.
        Using translate3d forces GPU promotion.
      */}
      {/* eslint-disable-next-line react/no-unknown-property */}
      <style jsx global>{`
        @keyframes ps-fall {
          0% {
            transform: translate3d(var(--ps-x-start), -10vh, 0) rotate(0deg);
          }
          100% {
            transform: translate3d(var(--ps-x-end), 110vh, 0)
              rotate(var(--ps-rotation));
          }
        }
        .ps-particle {
          position: absolute;
          top: 0;
          left: 0;
          animation-name: ps-fall;
          animation-timing-function: linear;
          animation-iteration-count: infinite;
          will-change: transform;
        }
      `}</style>

      {particles.map((p) => (
        <div
          key={p.id}
          className='ps-particle'
          style={
            {
              width: `${p.size}vw`,
              height: `${p.size}vw`,
              opacity: p.opacity,
              borderRadius: mode === 'winter' ? '50%' : '10% 50%',
              // CSS Variables for performant keyframe animation
              '--ps-x-start': `${p.xStart}vw`,
              '--ps-x-end': `${p.xEnd}vw`,
              '--ps-rotation': `${p.rotation}deg`,
              animationDuration: `${p.duration}s`,
              animationDelay: `${p.delay}s`,
              ...p.bgStyle,
            } as React.CSSProperties
          }
        />
      ))}
    </div>
  );
};

export default React.memo(PureSnow);
