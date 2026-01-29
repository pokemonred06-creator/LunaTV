/* eslint-disable @typescript-eslint/no-explicit-any */

import { NextRequest } from 'next/server';
import * as OpenCC from 'opencc-js';

import { getAuthInfoFromCookie } from '@/lib/auth/server';
import { getAvailableApiSites, getConfig } from '@/lib/config';
import { searchFromApi } from '@/lib/downstream';
import { yellowWords } from '@/lib/yellow';

export const runtime = 'nodejs';

// --- HELPERS ---

const normalize = (s: string) =>
  (s || '').toLowerCase().replace(/[^\u4e00-\u9fa5a-zA-Z0-9]+/g, '');

const NORMALIZED_BLOCKLIST = yellowWords
  .map((w) => normalize(String(w)))
  .filter((w) => w.length > 0);

const OPENCC_CONVERTER = OpenCC.Converter({ from: 'hk', to: 'cn' });

// Abort-aware timeout wrapper
// Rejects immediately if signal aborts, preventing hanging promises
const withTimeout = <T>(
  promise: Promise<T>,
  ms: number,
  signal?: AbortSignal,
): Promise<T> => {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error('aborted'));

    const timer = setTimeout(() => reject(new Error('timeout')), ms);

    const onAbort = () => {
      clearTimeout(timer);
      reject(new Error('aborted'));
    };

    if (signal) signal.addEventListener('abort', onAbort, { once: true });

    promise.then(
      (val) => {
        clearTimeout(timer);
        if (signal) signal.removeEventListener('abort', onAbort);
        resolve(val);
      },
      (err) => {
        clearTimeout(timer);
        if (signal) signal.removeEventListener('abort', onAbort);
        reject(err);
      },
    );
  });
};

export async function GET(request: NextRequest) {
  const authInfo = await getAuthInfoFromCookie(request);
  if (!authInfo || !authInfo.username) {
    return new Response('Unauthorized', { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const rawQuery = searchParams.get('q');
  const query = typeof rawQuery === 'string' ? rawQuery.trim() : '';

  if (!query || query.length > 200) {
    return new Response('Invalid query', { status: 400 });
  }

  const convertedQuery = OPENCC_CONVERTER(query);
  const config = await getConfig();

  let applyFilter = !config.SiteConfig?.DisableYellowFilter;
  const OWNER_USERNAME = process.env.USERNAME;
  const isOwner = !!OWNER_USERNAME && authInfo.username === OWNER_USERNAME;

  if (applyFilter) {
    if (isOwner) {
      applyFilter = false;
    } else {
      const users = config.UserConfig?.Users ?? [];
      const user = users.find((u) => u.username === authInfo.username);
      if (user?.disableYellowFilter) applyFilter = false;
    }
  }

  const encoder = new TextEncoder();
  const signal = request.signal;

  const stream = new ReadableStream({
    async start(controller) {
      let isStreamClosed = false;

      // Safe close logic: set flag, then close
      const safeClose = () => {
        if (!isStreamClosed) {
          isStreamClosed = true;
          try {
            controller.close();
          } catch {
            /* ignore */
          }
        }
      };

      const send = (data: any) => {
        if (isStreamClosed || signal.aborted) return;
        try {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(data)}\n\n`),
          );
        } catch (e) {
          isStreamClosed = true;
          safeClose();
        }
      };

      // Correctly close stream on client disconnect
      signal.addEventListener(
        'abort',
        () => {
          safeClose();
        },
        { once: true },
      );

      // Send Ping to flush buffers
      if (!isStreamClosed && !signal.aborted) {
        try {
          controller.enqueue(encoder.encode(':ok\n\n'));
        } catch {
          safeClose();
          return;
        }
      }

      // 1. PRE-FLIGHT BLOCK CHECK
      if (applyFilter) {
        const normalizedQuery = normalize(convertedQuery);
        const isRestricted = NORMALIZED_BLOCKLIST.some((word) =>
          normalizedQuery.includes(word),
        );

        if (isRestricted) {
          if (process.env.NODE_ENV !== 'production') {
            console.log('[SSE] Blocked query:', query);
          }
          send({ type: 'blocked' });
          safeClose();
          return;
        }
      }

      if (signal.aborted) {
        safeClose();
        return;
      }

      const rawApiSites = await getAvailableApiSites(authInfo.username);
      const apiSites = rawApiSites.slice(0, 20);

      send({ type: 'start', totalSources: apiSites.length });

      let completedCount = 0;

      const promises = apiSites.map(async (site) => {
        if (signal.aborted) return;

        try {
          // Pass signal to downstream fetch for true cancellation
          const results = await withTimeout(
            searchFromApi(site, convertedQuery, { signal }),
            20000,
            signal,
          );

          let safeResults = results;
          if (applyFilter) {
            safeResults = results.filter((item: any) => {
              const typeName = normalize(item.type_name);
              const name = normalize(item.title);
              return (
                !NORMALIZED_BLOCKLIST.some((w) => typeName.includes(w)) &&
                !NORMALIZED_BLOCKLIST.some((w) => name.includes(w))
              );
            });
          }

          send({
            type: 'source_result',
            source: site.name,
            results: safeResults,
          });
        } catch (err) {
          send({ type: 'source_error', source: site.name });
        } finally {
          completedCount++;
        }
      });

      await Promise.allSettled(promises);

      if (!signal.aborted) {
        send({ type: 'complete', completedSources: completedCount });
        safeClose();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control':
        'private, no-cache, no-store, must-revalidate, no-transform',
      Pragma: 'no-cache',
      Expires: '0',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no', // Critical for Nginx
    },
  });
}
