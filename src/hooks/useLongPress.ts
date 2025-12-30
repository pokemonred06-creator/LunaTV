import { useCallback, useRef } from 'react';

interface UseLongPressOptions {
  onLongPress: () => void;
  // onClick is removed as we now rely on native click events
  longPressDelay?: number;
  moveThreshold?: number;
}

interface TouchPosition {
  x: number;
  y: number;
}

export const useLongPress = ({
  onLongPress,
  longPressDelay = 500,
  moveThreshold = 10,
}: UseLongPressOptions) => {
  const isLongPress = useRef(false);
  const pressTimer = useRef<NodeJS.Timeout | null>(null);
  const startPosition = useRef<TouchPosition | null>(null);
  const isActive = useRef(false); // 防止重复触发

  const clearTimer = useCallback(() => {
    if (pressTimer.current) {
      clearTimeout(pressTimer.current);
      pressTimer.current = null;
    }
  }, []);

  const handleStart = useCallback(
    (clientX: number, clientY: number) => {
      // 如果已经有活跃的手势，忽略新的开始
      if (isActive.current) {
        return;
      }

      isActive.current = true;
      isLongPress.current = false;
      startPosition.current = { x: clientX, y: clientY };

      pressTimer.current = setTimeout(() => {
        // 再次检查是否仍然活跃
        if (!isActive.current) return;

        isLongPress.current = true;

        if (navigator.vibrate) {
          navigator.vibrate(50);
        }

        // 触发长按事件
        onLongPress();
      }, longPressDelay);
    },
    [onLongPress, longPressDelay]
  );

  const handleMove = useCallback(
    (clientX: number, clientY: number) => {
      if (!startPosition.current || !isActive.current) return;

      const distance = Math.sqrt(
        Math.pow(clientX - startPosition.current.x, 2) +
        Math.pow(clientY - startPosition.current.y, 2)
      );

      // 如果移动距离超过阈值，取消长按
      if (distance > moveThreshold) {
        clearTimer();
        isActive.current = false;
      }
    },
    [clearTimer, moveThreshold]
  );

  const handleEnd = useCallback(() => {
    clearTimer();
    // Reverted manual onClick logic.
    // relying on the browser to fire 'click' naturally if we don't preventDefault.

    // 重置所有状态
    // Note: isLongPress.current is checked in onTouchEnd before calling handleEnd
    // preventing the click if needed.
    // We reset it here after the check is done.
    
    // Defer resetting isLongPress slightly? No, onTouchEnd runs synchronously.
    // We check isLongPress in onTouchEnd, then call handleEnd.
    isLongPress.current = false;
    startPosition.current = null;
    isActive.current = false;
  }, [clearTimer]);

  // 触摸事件处理器
  const onTouchStart = useCallback(
    (e: React.TouchEvent) => {
      const touch = e.touches[0];
      handleStart(touch.clientX, touch.clientY);
    },
    [handleStart]
  );

  const onTouchMove = useCallback(
    (e: React.TouchEvent) => {
      const touch = e.touches[0];
      handleMove(touch.clientX, touch.clientY);
    },
    [handleMove]
  );

  const onTouchEnd = useCallback(
    (e: React.TouchEvent) => {
      // If it was a long press, prevent default to avoid the subsequent click
      if (isLongPress.current) {
        e.preventDefault();
      }
      // Do NOT stop propagation randomly.
      
      handleEnd();
    },
    [handleEnd]
  );

  return {
    onTouchStart,
    onTouchMove,
    onTouchEnd,
  };
};
