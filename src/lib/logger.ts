// logger.ts (Client Side)

const LOGGING_ENDPOINT = '/api/log';
const LOG_SECRET = process.env.NEXT_PUBLIC_LOG_SECRET; // If using secret

export const remoteLog = async (
  level: 'info' | 'error',
  message: string,
  data?: unknown,
) => {
  if (process.env.NODE_ENV === 'development') {
    console[level](message, data); // Standard console in dev
    return;
  }

  try {
    // Fire and forget - don't await this in UI interactions
    fetch(LOGGING_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(LOG_SECRET && { 'x-log-secret': LOG_SECRET }),
      },
      body: JSON.stringify({
        level,
        message,
        data,
        url: window.location.href,
        timestamp: new Date().toISOString(),
      }),
    });
  } catch (e) {
    // Fail silently if logging fails
  }
};
