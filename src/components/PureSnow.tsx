import React, { useEffect, useMemo, useRef } from 'react';

type PureSnowProps = {
  count?: number;
  mode?: 'winter' | 'spring' | 'autumn';
  textures?: string[];
};

const PureSnow: React.FC<PureSnowProps> = ({
  count = 100,
  mode = 'winter',
  textures = [],
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const styleRef = useRef<HTMLStyleElement | null>(null);

  // Configuration based on mode
  const config = useMemo(() => {
    switch (mode) {
      case 'winter':
        return {
          className: 'snowflake',
          sizeBase: 1, // vw
          opacityBase: 0.8,
        };
      case 'spring':
        return {
          className: 'petal',
          sizeBase: 1.2,
          opacityBase: 0.9,
        };
      case 'autumn':
        return {
          className: 'leaf',
          sizeBase: 1.5,
          opacityBase: 0.9,
        };
      default:
        return {
          className: 'snowflake',
          sizeBase: 1,
          opacityBase: 1,
        };
    }
  }, [mode]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // Clear previous
    container.innerHTML = '';
    if (styleRef.current) {
      document.head.removeChild(styleRef.current);
      styleRef.current = null;
    }

    // Physics Constants from pure-snow.js
    const pageHeightVh = 100; // Full screen

    // Generate CSS
    let cssRules = `
      .ps-particle {
        position: absolute;
        top: 0;
        border-radius: ${mode === 'winter' ? '50%' : '10% 50%'}; /* Circle for snow, Leaky for others */
        pointer-events: none;
      }
    `;

    // Create particles
    for (let i = 1; i <= count; i++) {
      // Logic from pure-snow.js
      const randomX = Math.random() * 100; // vw
      const randomOffset = Math.random() * 10; // vw sway
      const randomXEnd = randomX + randomOffset;
      const randomXEndYoyo = randomX + randomOffset / 2;
      const randomYoyoTime = 0.3 + Math.random() * 0.5; // 0.3-0.8
      const randomYoyoY = randomYoyoTime * pageHeightVh; // vh
      const randomScale = 0.5 + Math.random() * 0.5;
      const fallDuration = 10 + Math.random() * 20; // 10-30s
      const fallDelay = Math.random() * -30; // Negative delay for instant start
      const opacity = Math.random() * config.opacityBase;
      const sizeMode = config.sizeBase * (0.5 + Math.random()); // Variance

      // Texture selection
      let bgStyle = '';
      if (textures.length > 0) {
        const tex = textures[Math.floor(Math.random() * textures.length)];
        bgStyle = `background-image: url(${tex}); background-size: contain; background-repeat: no-repeat;`;
      } else {
        // Fallback colors if no texture
        let color = 'white';
        if (mode === 'autumn') {
          const colors = ['#D2691E', '#DAA520', '#8B0000'];
          color = colors[Math.floor(Math.random() * colors.length)];
        }
        if (mode === 'spring') {
          const colors = ['#FFC0CB', '#FFB7C5', '#FF69B4'];
          color = colors[Math.floor(Math.random() * colors.length)];
        }
        bgStyle = `background-color: ${color};`;
      }

      // Add Element
      const el = document.createElement('div');
      el.className = `ps-particle part-${i}`;
      el.style.opacity = opacity.toFixed(2);
      el.style.width = `${sizeMode}vw`;
      el.style.height = `${sizeMode}vw`;

      // Apply texture or color
      if (textures.length > 0) {
        el.style.backgroundImage = `url(${textures[Math.floor(Math.random() * textures.length)]})`;
        el.style.backgroundSize = 'contain';
        el.style.backgroundRepeat = 'no-repeat';
      } else {
        // Fallback logic
        let color = 'white';
        if (mode === 'autumn')
          color = ['#D2691E', '#DAA520', '#8B0000'][
            Math.floor(Math.random() * 3)
          ];
        if (mode === 'spring')
          color = ['#FFC0CB', '#FFB7C5', '#FF69B4'][
            Math.floor(Math.random() * 3)
          ];
        el.style.backgroundColor = color;
      }

      // Rotate for leaves/petals
      if (mode !== 'winter') {
        el.style.transform = `rotate(${Math.random() * 360}deg)`;
      }

      container.appendChild(el);

      // Add Keyframe
      cssRules += `
        .part-${i} {
          left: ${randomX}vw;
          top: -10px;
          transform: scale(${randomScale});
          animation: fall-${i} ${fallDuration}s ${fallDelay}s linear infinite;
        }
        @keyframes fall-${i} {
          ${(randomYoyoTime * 100).toFixed(0)}% {
            transform: translate(${(randomXEnd - randomX).toFixed(2)}vw, ${randomYoyoY}vh) scale(${randomScale});
          }
          100% {
            transform: translate(${(randomXEndYoyo - randomX).toFixed(2)}vw, ${pageHeightVh}vh) scale(${randomScale});
          }
        }
      `;
    }

    // Inject Style
    const style = document.createElement('style');
    style.innerHTML = cssRules;
    document.head.appendChild(style);
    styleRef.current = style;

    return () => {
      if (styleRef.current) {
        document.head.removeChild(styleRef.current);
      }
      container.innerHTML = '';
    };
  }, [count, mode, config, textures]);

  return (
    <div
      ref={containerRef}
      id='pure-snow-container'
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
        zIndex: 20,
        overflow: 'hidden',
      }}
    />
  );
};

export default PureSnow;
