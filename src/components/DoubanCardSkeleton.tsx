import React from 'react';

const DoubanCardSkeleton = () => {
  return (
    <div className='w-full animate-pulse group'>
      {/* 1. Image Placeholder */}
      {/* Replaced component with a raw div for better skeleton performance & dark mode control */}
      <div className='w-full aspect-2/3 bg-gray-200 dark:bg-gray-700 rounded-lg' />

      {/* 2. Info Layer */}
      {/* Changed from absolute to standard flow (mt-2) to prevent grid overlaps */}
      <div className='mt-2 flex flex-col items-center justify-center gap-1.5'>
        {/* Title Line */}
        <div className='h-4 w-3/4 bg-gray-200 dark:bg-gray-700 rounded' />

        {/* Subtitle/Rating Line (Optional but looks better) */}
        <div className='h-3 w-1/2 bg-gray-200 dark:bg-gray-700 rounded' />
      </div>
    </div>
  );
};

export default DoubanCardSkeleton;
