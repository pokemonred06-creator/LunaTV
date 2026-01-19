type LogLevel = 'info' | 'warn' | 'error' | 'debug';

export const remoteLog = (level: LogLevel, message: string, data?: unknown) => {
  // 1. Prepare Payload
  const payload = JSON.stringify({
    level,
    message,
    data,
    url: typeof window !== 'undefined' ? window.location.href : 'server-side',
    timestamp: new Date().toISOString(),
  });

  // 2. Select Transport
  // Blob + sendBeacon is strictly better for "unload" events (closing tab)
  if (typeof navigator !== 'undefined' && navigator.sendBeacon) {
    const blob = new Blob([payload], { type: 'application/json' });
    const success = navigator.sendBeacon('/api/log', blob);
    if (success) return;
  }

  // 3. Fallback to Fetch (keepalive ensures it survives navigation)
  fetch('/api/log', {
    method: 'POST',
    body: payload,
    headers: { 'Content-Type': 'application/json' },
    keepalive: true,
  }).catch(() => {
    /* Silent Fail */
  });
};
