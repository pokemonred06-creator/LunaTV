import React, { useCallback, useEffect, useRef, useState } from 'react';

interface CapsuleSwitchProps {
  options: { label: string; value: string }[];
  active: string;
  onChange: (value: string) => void;
  className?: string;
}

const CapsuleSwitch: React.FC<CapsuleSwitchProps> = ({
  options,
  active,
  onChange,
  className,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [indicatorStyle, setIndicatorStyle] = useState<{
    left: number;
    width: number;
  }>({ left: 0, width: 0 });

  const activeIndex = options.findIndex((opt) => opt.value === active);

  // 更新指示器位置
  const updateIndicatorPosition = useCallback(() => {
    if (
      activeIndex >= 0 &&
      buttonRefs.current[activeIndex] &&
      containerRef.current
    ) {
      const button = buttonRefs.current[activeIndex];
      const container = containerRef.current;
      if (button && container) {
        const buttonRect = button.getBoundingClientRect();
        const containerRect = container.getBoundingClientRect();

        if (buttonRect.width > 0) {
          setIndicatorStyle({
            left: buttonRect.left - containerRect.left,
            width: buttonRect.width,
          });
        }
      }
    }
  }, [activeIndex]);

  // 组件挂载时立即计算初始位置
  useEffect(() => {
    const timeoutId = setTimeout(updateIndicatorPosition, 0);
    return () => clearTimeout(timeoutId);
  }, [updateIndicatorPosition]);

  // 监听选中项变化
  useEffect(() => {
    const timeoutId = setTimeout(updateIndicatorPosition, 0);
    return () => clearTimeout(timeoutId);
  }, [activeIndex, updateIndicatorPosition]);

  return (
    <div
      ref={containerRef}
      className={`relative inline-flex bg-slate-200/50 dark:bg-slate-900/60 backdrop-blur-md border border-slate-250/20 dark:border-white/5 p-1 rounded-full shadow-inner ${
        className || ''
      }`}
    >
      {/* 滑动的绿色背景指示器 */}
      {indicatorStyle.width > 0 && (
        <div
          className='absolute top-1 bottom-1 bg-linear-to-r from-brand-500 to-emerald-500 dark:from-brand-500/90 dark:to-emerald-600/90 rounded-full shadow-md shadow-brand-500/20 transition-all duration-300 ease-out z-10'
          style={{
            left: `${indicatorStyle.left}px`,
            width: `${indicatorStyle.width}px`,
          }}
        />
      )}

      {options.map((opt, index) => {
        const isActive = active === opt.value;
        return (
          <button
            key={opt.value}
            ref={(el) => {
              buttonRefs.current[index] = el;
            }}
            onClick={() => onChange(opt.value)}
            className={`relative z-20 w-fit px-3 py-1.5 text-xs sm:px-4 sm:py-2.5 sm:text-sm rounded-full font-semibold transition-colors duration-300 cursor-pointer ${
              isActive
                ? 'text-white'
                : 'text-slate-650 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
            }`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
};

export default CapsuleSwitch;
