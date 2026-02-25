#!/usr/bin/env node

/**
 * Live stream health checker.
 *
 * Usage:
 *   node scripts/live_health_check.mjs \
 *     --base https://tv.example.com \
 *     --username admin \
 *     --password secret \
 *     --max-channels-per-source 8 \
 *     --timeout-ms 12000
 */

const args = parseArgs(process.argv.slice(2));
const base = (args.base || process.env.APP_URL || '').replace(/\/+$/, '');
const username = args.username || process.env.USERNAME || 'admin';
const password = args.password || process.env.PASSWORD || '';
const maxChannelsPerSource = toInt(args['max-channels-per-source'], 8);
const timeoutMs = toInt(args['timeout-ms'], 12000);
const rounds = toInt(args.rounds, 1);
const stableTop = toInt(args['stable-top'], 15);

if (!base) {
  console.error('Missing --base (or APP_URL env)');
  process.exit(1);
}
if (!password) {
  console.error('Missing --password (or PASSWORD env)');
  process.exit(1);
}

async function main() {
  const cookies = await loginAndGetCookies(base, username, password, timeoutMs);
  const sourcesRes = await fetchJson(
    `${base}/api/live/sources`,
    cookies,
    timeoutMs,
    'live sources',
  );
  const sources = (sourcesRes?.data || []).filter((s) => s && s.key);
  if (!sources.length) {
    console.log('No live sources found.');
    return;
  }

  const sourceSummaries = [];
  const failures = [];
  const perChannel = new Map();

  for (const source of sources) {
    const channelsRes = await fetchJson(
      `${base}/api/live/channels?source=${encodeURIComponent(source.key)}`,
      cookies,
      timeoutMs,
      `channels for source ${source.key}`,
    );

    const channels = Array.isArray(channelsRes?.data) ? channelsRes.data : [];
    const sampled = sampleChannels(channels, maxChannelsPerSource);
    let pass = 0;
    let fail = 0;

    for (let round = 1; round <= rounds; round++) {
      for (const channel of sampled) {
        const result = await checkChannel(
          base,
          source.key,
          channel,
          cookies,
          timeoutMs,
        );
        const chName = channel?.name || '(unknown)';
        const key = `${source.key}:::${chName}`;
        const prev = perChannel.get(key) || {
          source: source.key,
          channel: chName,
          pass: 0,
          fail: 0,
          reasons: new Map(),
        };
        if (result.ok) {
          pass++;
          prev.pass++;
        } else {
          fail++;
          prev.fail++;
          failures.push({
            source: source.key,
            channel: chName,
            reason: result.reason,
          });
          prev.reasons.set(result.reason, (prev.reasons.get(result.reason) || 0) + 1);
        }
        perChannel.set(key, prev);
      }
    }

    sourceSummaries.push({
      source: source.key,
      tested: sampled.length * rounds,
      pass,
      fail,
      passRate: sampled.length * rounds
        ? `${((pass / (sampled.length * rounds)) * 100).toFixed(1)}%`
        : 'n/a',
    });
  }

  printSummary(sourceSummaries, failures, perChannel, stableTop, rounds);
}

async function checkChannel(baseUrl, sourceKey, channel, cookieHeader, timeout) {
  const rawUrl = channel?.url;
  if (!rawUrl) return { ok: false, reason: 'Missing channel URL' };

  try {
    const precheckUrl = `${baseUrl}/api/live/precheck?url=${encodeURIComponent(rawUrl)}&moontv-source=${encodeURIComponent(sourceKey)}`;
    const precheck = await fetchJson(
      precheckUrl,
      cookieHeader,
      timeout,
      'precheck',
      true,
    );
    if (!precheck?.success || !precheck?.type) {
      return { ok: false, reason: `precheck failed: ${precheck?.error || 'unknown'}` };
    }

    const proxyType = precheck.type;
    const proxyUrl = `${baseUrl}/api/proxy/${encodeURIComponent(proxyType)}?url=${encodeURIComponent(rawUrl)}&moontv-source=${encodeURIComponent(sourceKey)}`;
    const res = await fetch(proxyUrl, {
      method: 'GET',
      headers: {
        Cookie: cookieHeader,
      },
      signal: AbortSignal.timeout(timeout),
    });

    if (!res.ok) {
      const text = await safeReadText(res);
      return { ok: false, reason: `proxy ${res.status}${text ? `: ${truncate(text, 80)}` : ''}` };
    }

    if (proxyType === 'm3u8') {
      const text = await safeReadText(res);
      if (!text || (!text.includes('#EXTM3U') && text.length < 32)) {
        return { ok: false, reason: 'm3u8 response empty/invalid' };
      }
      return { ok: true };
    }

    const gotData = await readFirstChunk(res, timeout);
    if (!gotData) return { ok: false, reason: 'no stream data before timeout' };
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: normalizeError(err) };
  }
}

async function loginAndGetCookies(baseUrl, user, pass, timeout) {
  const loginRes = await fetch(`${baseUrl}/api/login`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({ username: user, password: pass }),
    signal: AbortSignal.timeout(timeout),
  });
  if (!loginRes.ok) {
    const body = await safeReadText(loginRes);
    throw new Error(`Login failed ${loginRes.status}${body ? `: ${truncate(body, 120)}` : ''}`);
  }
  const setCookies = loginRes.headers.getSetCookie?.() || [];
  const cookies = setCookies.map((c) => c.split(';')[0]).filter(Boolean);
  if (!cookies.length) {
    throw new Error('Login succeeded but no auth cookies returned');
  }
  return cookies.join('; ');
}

async function fetchJson(url, cookieHeader, timeout, label, allowErrorJson = false) {
  const res = await fetch(url, {
    headers: {
      Cookie: cookieHeader,
    },
    signal: AbortSignal.timeout(timeout),
  });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!res.ok && !allowErrorJson) {
    throw new Error(`${label} failed ${res.status}${text ? `: ${truncate(text, 120)}` : ''}`);
  }
  return data;
}

function sampleChannels(channels, max) {
  if (!Array.isArray(channels) || channels.length === 0 || max <= 0) return [];
  if (channels.length <= max) return channels;
  const out = [];
  const step = (channels.length - 1) / (max - 1);
  for (let i = 0; i < max; i++) {
    out.push(channels[Math.round(i * step)]);
  }
  return out;
}

async function readFirstChunk(res, timeout) {
  if (!res.body) return false;
  const reader = res.body.getReader();
  const timer = delay(timeout).then(() => ({ timeout: true }));
  const read = reader.read().then((r) => ({ timeout: false, r }));
  const first = await Promise.race([timer, read]);
  try {
    await reader.cancel();
  } catch {
    // ignore
  }
  if (first.timeout) return false;
  const { value, done } = first.r;
  return !done && value && value.length > 0;
}

async function safeReadText(res) {
  try {
    return await res.text();
  } catch {
    return '';
  }
}

function printSummary(sourceSummaries, failures, perChannel, topN, roundsCount) {
  const totalTested = sourceSummaries.reduce((n, s) => n + s.tested, 0);
  const totalPass = sourceSummaries.reduce((n, s) => n + s.pass, 0);
  const totalFail = sourceSummaries.reduce((n, s) => n + s.fail, 0);
  const overall = totalTested ? `${((totalPass / totalTested) * 100).toFixed(1)}%` : 'n/a';

  console.log(`\nOverall: ${totalPass}/${totalTested} pass (${overall}), ${totalFail} fail\n`);
  console.log('| Source | Tested | Pass | Fail | Pass Rate |');
  console.log('|---|---:|---:|---:|---:|');
  for (const s of sourceSummaries) {
    console.log(`| ${s.source} | ${s.tested} | ${s.pass} | ${s.fail} | ${s.passRate} |`);
  }

  if (failures.length) {
    console.log('\nFailures:');
    console.log('| Source | Channel | Reason |');
    console.log('|---|---|---|');
    for (const f of failures) {
      console.log(`| ${escapePipe(f.source)} | ${escapePipe(f.channel)} | ${escapePipe(f.reason)} |`);
    }
  }

  const ranked = Array.from(perChannel.values())
    .map((x) => {
      const total = x.pass + x.fail;
      const topReason = Array.from(x.reasons.entries()).sort((a, b) => b[1] - a[1])[0];
      return {
        source: x.source,
        channel: x.channel,
        pass: x.pass,
        fail: x.fail,
        total,
        rate: total ? ((x.pass / total) * 100).toFixed(1) : '0.0',
        topReason: topReason ? `${topReason[0]} (${topReason[1]})` : '',
      };
    })
    .sort((a, b) => {
      if (b.pass !== a.pass) return b.pass - a.pass;
      if (a.fail !== b.fail) return a.fail - b.fail;
      return a.channel.localeCompare(b.channel);
    });

  console.log(`\nTop Stable Channels (across ${roundsCount} rounds):`);
  console.log('| Rank | Source | Channel | Pass | Fail | Pass Rate |');
  console.log('|---:|---|---|---:|---:|---:|');
  ranked.slice(0, topN).forEach((r, idx) => {
    console.log(`| ${idx + 1} | ${escapePipe(r.source)} | ${escapePipe(r.channel)} | ${r.pass} | ${r.fail} | ${r.rate}% |`);
  });

  const unstable = ranked
    .filter((r) => r.fail > 0)
    .sort((a, b) => b.fail - a.fail)
    .slice(0, topN);
  if (unstable.length) {
    console.log('\nTop Unstable Channels:');
    console.log('| Rank | Source | Channel | Pass | Fail | Main Error |');
    console.log('|---:|---|---|---:|---:|---|');
    unstable.forEach((r, idx) => {
      console.log(`| ${idx + 1} | ${escapePipe(r.source)} | ${escapePipe(r.channel)} | ${r.pass} | ${r.fail} | ${escapePipe(r.topReason)} |`);
    });
  }
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      out[key] = 'true';
      continue;
    }
    out[key] = next;
    i++;
  }
  return out;
}

function toInt(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : fallback;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeError(err) {
  if (!err) return 'unknown error';
  if (typeof err === 'string') return err;
  if (err.name === 'TimeoutError') return 'timeout';
  if (err.name === 'AbortError') return 'timeout/aborted';
  return err.message || String(err);
}

function truncate(s, max) {
  return s.length > max ? `${s.slice(0, max)}...` : s;
}

function escapePipe(s) {
  return String(s || '').replace(/\|/g, '\\|');
}

main().catch((err) => {
  console.error('Health check failed:', normalizeError(err));
  process.exit(1);
});
