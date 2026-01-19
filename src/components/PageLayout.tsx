'use client';

import { useEffect, useState } from 'react';

import { isForcedMobile } from '@/lib/utils'; // Assuming this checks window.innerWidth

import { BackButton } from './BackButton';
import { LanguageToggle } from './LanguageToggle';
import MobileBottomNav from './MobileBottomNav';
import MobileHeader from './MobileHeader';
import Sidebar from './Sidebar';
import { ThemeToggle } from './ThemeToggle';
import { UserMenu } from './UserMenu';

interface PageLayoutProps {
  children: React.ReactNode;
  activePath?: string;
}

const PageLayout = ({ children, activePath = '/' }: PageLayoutProps) => {
  // Default to false to match Server Side Rendering (SSR)
  const [forcedMobile, setForcedMobile] = useState(false);

  // Sync state after mount to avoid Hydration Mismatch
  useEffect(() => {
    // If your isForcedMobile() is just "window.innerWidth < 768",
    // you might not even need this state and could rely purely on CSS 'md:'.
    // We keep it here in case you have complex logic (e.g. user preference override).
    setForcedMobile(isForcedMobile());

    // Optional: Add resize listener if 'forcedMobile' depends on window width
    const handleResize = () => setForcedMobile(isForcedMobile());
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Helper: Are we effectively in desktop mode?
  // We use CSS 'md:' for the base truth, but this bool helps with conditional rendering
  const isDesktopMode = !forcedMobile;
  const showBackButton = ['/play', '/live'].includes(activePath);

  return (
    <div className='relative min-h-screen w-full bg-background text-foreground'>
      {/* --- Mobile Header --- */}
      {/* Hidden on desktop via CSS, or forced visible if isDesktopMode is false */}
      <div className={isDesktopMode ? 'md:hidden' : 'block'}>
        <MobileHeader showBackButton={showBackButton} forced={forcedMobile} />
      </div>

      {/* --- Main Layout Wrapper --- */}
      {/* Structure:
         - Mobile: Flex column
         - Desktop: Grid (Sidebar | Content)
         - We conditionally apply 'md:grid' only if we are NOT in forced mobile mode.
      */}
      <div
        className={`
        flex flex-col min-h-screen w-full
        ${isDesktopMode ? 'md:grid md:grid-cols-[auto_1fr]' : ''}
      `}
      >
        {/* --- Sidebar (Desktop) --- */}
        {/* Sticky Sidebar Pattern: 
            Sidebar stays fixed height, Main content scrolls the body.
            'self-start' ensures it sticks to top.
        */}
        <div
          className={`
          ${isDesktopMode ? 'hidden md:block' : 'hidden'} 
          sticky top-0 h-screen overflow-y-auto self-start 
          border-r border-border bg-card/50 backdrop-blur-sm z-30
        `}
        >
          <Sidebar activePath={activePath} />
        </div>

        {/* --- Content Area --- */}
        <div className='relative flex flex-1 flex-col min-w-0'>
          {/* Desktop Controls (Absolute Top-Right) */}
          {isDesktopMode && (
            <>
              {showBackButton && (
                <div className='hidden md:flex absolute top-4 left-4 z-40'>
                  <BackButton />
                </div>
              )}

              <div className='hidden md:flex absolute top-4 right-6 z-40 items-center gap-3'>
                <LanguageToggle />
                <ThemeToggle />
                <UserMenu />
              </div>
            </>
          )}

          {/* Main Content */}
          <main
            className={`
              flex-1 w-full
              /* Mobile: add top margin for header */
              mt-[48px] 
              /* Desktop: remove top margin */
              ${isDesktopMode ? 'md:mt-0' : ''}
            `}
            style={{
              // Safe area padding for mobile bottom nav
              paddingBottom: isDesktopMode
                ? '0px'
                : 'calc(4rem + env(safe-area-inset-bottom))',
            }}
          >
            {children}
          </main>
        </div>
      </div>

      {/* --- Mobile Bottom Nav --- */}
      <div className={isDesktopMode ? 'md:hidden' : 'block'}>
        <MobileBottomNav activePath={activePath} forced={forcedMobile} />
      </div>
    </div>
  );
};

export default PageLayout;
