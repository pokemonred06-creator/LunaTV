'use client';

import React, { useEffect, useRef, useState } from 'react';

interface ScrollableDescriptionProps {
  content: string;
  className?: string;
}

export const ScrollableDescription: React.FC<ScrollableDescriptionProps> = ({
  content,
  className = '',
}) => {
  const [shouldScroll, setShouldScroll] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const checkScroll = () => {
      if (containerRef.current && textRef.current) {
        const containerHeight = containerRef.current.clientHeight;
        const textHeight = textRef.current.scrollHeight;
        // Add a small buffer (e.g. 1px) to avoid precision issues
        setShouldScroll(textHeight > containerHeight + 1);
      }
    };

    // Run immediately and on resize
    checkScroll();

    // Also run after a short delay to ensure layout catch-up
    const timer = setTimeout(checkScroll, 100);

    window.addEventListener('resize', checkScroll);
    return () => {
      window.removeEventListener('resize', checkScroll);
      clearTimeout(timer);
    };
  }, [content]);

  return (
    <div
      ref={containerRef}
      className={`relative overflow-hidden group/scroll ${className}`}
    >
      <div
        className={`${shouldScroll ? 'animate-scroll-y group-hover/scroll:pause will-change-transform' : ''}`}
        style={{ animationPlayState: 'running' }}
      >
        <div ref={textRef} className='pb-8 whitespace-pre-line'>
          {content}
        </div>
        {shouldScroll && (
          <div className='pb-8 whitespace-pre-line'>{content}</div>
        )}
      </div>
      {shouldScroll && (
        <div className='absolute inset-x-0 bottom-0 h-8 bg-linear-to-t from-gray-100 dark:from-gray-900 to-transparent pointer-events-none' />
      )}
    </div>
  );
};
