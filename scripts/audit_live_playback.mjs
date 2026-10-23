#!/usr/bin/env node
import { writeFile } from 'node:fs/promises';

// Checks every configured channel through the site's authenticated proxy,
// including a media segment for HLS. This is a transport audit, not a decoder test.
const base = (process.env.APP_URL || 'http://127.0.0.1:3099').replace(
  /\/$/,
  '',
);
const output = process.env.LIVE_AUDIT_OUTPUT || '/tmp/lunatv-live-audit.json';
const timeout = Number(process.env.LIVE_AUDIT_TIMEOUT) || 10000;
const concurrency = Math.min(
  12,
  Math.max(1, Number(process.env.LIVE_AUDIT_CONCURRENCY) || 6),
);
const maximum = Number(process.env.LIVE_AUDIT_MAX) || Infinity;
const login = await fetch(`${base}/api/login`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    username: process.env.USERNAME,
    password: process.env.PASSWORD,
  }),
  signal: AbortSignal.timeout(timeout),
});
if (!login.ok) throw new Error(`Login HTTP ${login.status}`);
const cookie = login.headers
  .getSetCookie()
  .map((value) => value.split(';')[0])
  .join('; ');
const get = (url) =>
  fetch(url, {
    headers: { Cookie: cookie },
    signal: AbortSignal.timeout(timeout),
  });
const json = async (url) => {
  const response = await get(url);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
};
const sources = (await json(`${base}/api/live/sources`)).data || [];
const jobs = [];
for (const source of sources) {
  const channels =
    (
      await json(
        `${base}/api/live/channels?source=${encodeURIComponent(source.key)}`,
      )
    ).data || [];
  for (const channel of channels.slice(0, maximum))
    jobs.push({ source: source.key, channel });
}
const media = async (url, depth = 0) => {
  const response = await get(url);
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`media HTTP ${response.status}`);
  }
  if ((response.headers.get('content-type') || '').includes('mpegurl')) {
    if (depth >= 4) throw new Error('Manifest nesting exceeds limit');
    const manifest = await response.text();
    if (!manifest.trimStart().startsWith('#EXTM3U'))
      throw new Error('Invalid manifest');
    const uri = manifest
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line && !line.startsWith('#'));
    if (!uri) throw new Error('Manifest has no media');
    return media(new URL(uri, url).toString(), depth + 1);
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Empty media');
  try {
    const { value } = await reader.read();
    if (!value?.length) throw new Error('Empty media');
    return { bytes: value.length, mime: response.headers.get('content-type') };
  } finally {
    await reader.cancel().catch(() => {});
  }
};
let index = 0;
const results = [];
await Promise.all(
  Array.from({ length: concurrency }, async () => {
    while (index < jobs.length) {
      const { source, channel } = jobs[index++];
      const query = new URLSearchParams({
        url: channel.url,
        'moontv-source': source,
        'moontv-channel': channel.id,
      });
      const start = Date.now();
      const result = {
        source,
        channel: channel.name,
        id: channel.id,
        host: new URL(channel.url).hostname,
      };
      try {
        const precheck = await json(`${base}/api/live/precheck?${query}`);
        if (!precheck.success || !precheck.type || precheck.type === 'unknown')
          throw new Error(precheck.error || 'Unknown media format');
        result.type = precheck.type;
        Object.assign(
          result,
          await media(`${base}/api/proxy/${precheck.type}?${query}`),
        );
        result.available = true;
      } catch (error) {
        result.available = false;
        result.reason = error.message;
      }
      result.elapsedMs = Date.now() - start;
      results.push(result);
      if (results.length % 50 === 0)
        console.log(
          `Checked ${results.length}/${jobs.length}; media received from ${results.filter((result) => result.available).length}`,
        );
    }
  }),
);
const failures = {};
for (const result of results.filter((result) => !result.available))
  failures[result.reason] = (failures[result.reason] || 0) + 1;
const report = {
  timestamp: new Date().toISOString(),
  base,
  verification:
    'HTTP media transport and first HLS media segment; decoding requires a browser playback test',
  total: results.length,
  available: results.filter((result) => result.available).length,
  failures,
  results,
};
await writeFile(output, JSON.stringify(report, null, 2));
console.log(
  JSON.stringify({
    total: report.total,
    available: report.available,
    failures,
    report: output,
  }),
);
