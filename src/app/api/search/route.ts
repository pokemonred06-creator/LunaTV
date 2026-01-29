/* eslint-disable @typescript-eslint/no-explicit-any */

import { NextRequest, NextResponse } from 'next/server';
import * as OpenCC from 'opencc-js';

import { getAuthInfoFromCookie } from '@/lib/auth/server';
import { getAvailableApiSites, getConfig } from '@/lib/config';
import { searchFromApi } from '@/lib/downstream';
import { yellowWords } from '@/lib/yellow';

export const runtime = 'nodejs';

// --- HELPERS & CONSTANTS ---

const NO_CACHE_HEADERS = {
  'Cache-Control': 'private, no-cache, no-store, must-revalidate',
  Pragma: 'no-cache',
  Expires: '0',
};

// OpenCC converter instance (HK -> CN)
const OPENCC_CONVERTER = OpenCC.Converter({ from: 'hk', to: 'cn' });

// Centralized normalization logic: Lowercase + remove whitespace/punctuation/underscores
const normalize = (s: string): string =>
  (s || '').toLowerCase().replace(/[^\u4e00-\u9fa5a-zA-Z0-9]+/g, '');

// Pre-compute blocklist at module scope.
// CRITICAL: Filter out empty strings to prevent matching everything (e.g. if a word is just " ").
const NORMALIZED_BLOCKLIST = yellowWords
  .map((w) => normalize(String(w)))
  .filter((w) => w.length > 0);

// --- HANDLER ---

export async function GET(request: NextRequest) {
  // 1. AUTHENTICATION
  const authInfo = await getAuthInfoFromCookie(request);
  if (!authInfo || !authInfo.username) {
    return NextResponse.json(
      { error: 'Unauthorized' },
      { status: 401, headers: NO_CACHE_HEADERS },
    );
  }

  // 2. INPUT VALIDATION
  const { searchParams } = new URL(request.url);
  const rawQuery = searchParams.get('q');

  // Trim first to prevent whitespace padding attacks
  const query = typeof rawQuery === 'string' ? rawQuery.trim() : '';

  // Early return for empty queries or abusive lengths
  if (!query || query.length > 200) {
    return NextResponse.json({ results: [] }, { headers: NO_CACHE_HEADERS });
  }

  // 3. CONFIGURATION LOADING
  const config = await getConfig();

  // 4. DETERMINE FILTER RULES
  // Default to enabled unless explicitly disabled in config
  let applyFilter = !config.SiteConfig?.DisableYellowFilter;

  const OWNER_USERNAME = process.env.USERNAME;
  const isOwner = !!OWNER_USERNAME && authInfo.username === OWNER_USERNAME;

  if (applyFilter) {
    if (isOwner) {
      applyFilter = false;
    } else {
      // Safe access to UserConfig
      const users = config.UserConfig?.Users ?? [];
      const user = users.find((u) => u.username === authInfo.username);
      if (user?.disableYellowFilter) {
        applyFilter = false;
      }
    }
  }

  // 5. PRE-FLIGHT FILTER (Security check on Query)
  const convertedQuery = OPENCC_CONVERTER(query);

  if (applyFilter) {
    const normalizedQuery = normalize(convertedQuery);

    // Check if any blocked word exists inside the normalized query
    const isRestricted = NORMALIZED_BLOCKLIST.some((word) =>
      normalizedQuery.includes(word),
    );

    if (isRestricted) {
      if (process.env.NODE_ENV !== 'production') {
        console.log('[Filter] Blocked restricted query.');
      }
      return NextResponse.json(
        { results: [], blocked: true },
        { headers: NO_CACHE_HEADERS },
      );
    }
  }

  // 6. FETCH & CAP DOWNSTREAM SITES
  const rawApiSites = await getAvailableApiSites(authInfo.username);
  // Cap at 20 sites to prevent fan-out DoS issues
  const apiSites = rawApiSites.slice(0, 20);

  // 7. CONCURRENT SEARCH EXECUTION
  const searchPromises = apiSites.map((site) =>
    Promise.race([
      searchFromApi(site, convertedQuery),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`${site.name} timeout`)), 20000),
      ),
    ]).catch((err) => {
      console.warn(`Search failed ${site.name}:`, err.message);
      return [];
    }),
  );

  try {
    const results = await Promise.allSettled(searchPromises);
    const successResults = results
      .filter((result) => result.status === 'fulfilled')
      .map((result) => (result as PromiseFulfilledResult<any>).value);

    let flattenedResults = successResults.flat();

    // 8. POST-FLIGHT FILTER (Cleanup on Results)
    if (applyFilter) {
      flattenedResults = flattenedResults.filter((result) => {
        const typeName = result.type_name ? normalize(result.type_name) : '';
        const name = result.name ? normalize(result.name) : '';

        return (
          !NORMALIZED_BLOCKLIST.some((word) => typeName.includes(word)) &&
          !NORMALIZED_BLOCKLIST.some((word) => name.includes(word))
        );
      });
    }

    return NextResponse.json(
      { results: flattenedResults },
      { headers: NO_CACHE_HEADERS },
    );
  } catch (error) {
    console.error('Search Aggregation Error:', error);
    return NextResponse.json(
      { error: 'Search failed' },
      { status: 500, headers: NO_CACHE_HEADERS },
    );
  }
}
