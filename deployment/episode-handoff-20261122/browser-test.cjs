/* global Buffer, console, document, process, require, setTimeout, URL, window */
/* eslint @typescript-eslint/no-require-imports: off */
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const { readFileSync } = require('node:fs');
const { chromium } = require('@playwright/test');

const origin = process.env.CANARY_ORIGIN;
const password = readFileSync(process.env.CANARY_PASSWORD_FILE, 'utf8').trim();
const baseline = process.env.EXPECT_REPLAY === '1';
const assets = new Map();
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function makeFixture(color, kind) {
  const hls = kind === 'hls';
  return execFileSync('ffmpeg', [
    '-nostdin', '-loglevel', 'error', '-f', 'lavfi', '-i',
    'color=c=' + color + ':s=' + (hls ? '256x144' : '160x256') + ':r=20',
    '-t', '6', '-c:v', 'libx264', '-g', '20', '-pix_fmt', 'yuv420p',
    ...(hls ? [] : ['-movflags', 'frag_keyframe+empty_moov']),
    '-f', hls ? 'mpegts' : 'mp4', 'pipe:1',
  ]);
}

const clips = Object.fromEntries(['mp4', 'hls'].map(kind =>
  [kind, ['red', 'lime', 'blue'].map(color => makeFixture(color, kind))],
));

function fulfillBytes(route, bytes, contentType) {
  const range = /^bytes=(\d+)-(\d*)$/.exec(route.request().headers().range || '');
  if (!range) return route.fulfill({
    status: 200, contentType, body: bytes, headers: { 'accept-ranges': 'bytes' },
  });
  const start = Number(range[1]);
  const end = range[2] ? Math.min(Number(range[2]), bytes.length - 1) : bytes.length - 1;
  if (start > end) return route.fulfill({
    status: 416, headers: { 'content-range': 'bytes */' + bytes.length },
  });
  return route.fulfill({
    status: 206,
    contentType,
    body: bytes.subarray(start, end + 1),
    headers: {
      'accept-ranges': 'bytes',
      'content-range': 'bytes ' + start + '-' + end + '/' + bytes.length,
    },
  });
}

async function captureDecodedEpisode(page, oldSrc, channel) {
  await page.waitForFunction(({ oldSrc, channel }) => {
    const video = document.querySelector('video.vjs-tech');
    if (!video || video.currentSrc === oldSrc || video.paused ||
        video.readyState < 2 || video.currentTime < 0.16 || !video.videoWidth) return false;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    const context = canvas.getContext('2d');
    context.drawImage(video, 0, 0, 1, 1);
    const pixel = Array.from(context.getImageData(0, 0, 1, 1).data).slice(0, 3);
    return pixel[channel] > 160 && pixel.every((value, i) => i === channel || value < 90);
  }, { oldSrc, channel });
}

async function playFixture(context, scenario, index) {
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  const { kind, action } = scenario;
  const id = String(912345670 + index);
  const source = kind === 'hongguo' ? 'hongguo' : kind === 'hls' ? 'handoff-tv' : 'eightmovie';
  const urls = [1, 2, 3].map(episode => kind === 'hongguo'
    ? '/api/hongguo/media/' + id + '/' + episode + '.mp4'
    : kind === 'hls'
      ? '/api/proxy/m3u8?fixture=' + id + '&episode=' + episode
      : '/handoff-fixtures/' + id + '/' + episode + '.mp4');
  const labels = ['Fixture One', 'Fixture Two', 'Fixture Three'];
  const item = {
    id, source, title: 'Handoff Fixture ' + index, source_name: 'Playback QA',
    episodes: urls, episodes_titles: labels, poster: '', year: '2026', desc: '',
    type_name: kind === 'hls' ? '电视剧' : '短劇',
  };

  page.on('response', async response => {
    const path = new URL(response.url()).pathname;
    if (!path.startsWith('/_next/static/') || !path.endsWith('.js') || !response.ok()) return;
    try {
      const bytes = await response.body();
      if (bytes.includes(Buffer.from('onNextEpisode')) || bytes.includes(Buffer.from('Fixture Two')))
        assets.set(path, createHash('sha256').update(bytes).digest('hex'));
    } catch {
      // Browser canceled a duplicate resource during navigation.
    }
  });

  let preparations = 0;
  let markPreparing;
  const preparingEpisodeTwo = new Promise(resolve => { markPreparing = resolve; });
  try {
    await page.route('**/api/detail?**', route => route.fulfill({ json: item }));
    await page.route('**/api/search?**', route => route.fulfill({ json: { results: [item] } }));
    await page.route('**/api/hongguo/media/' + id + '/*.mp4*', async route => {
      const episode = Number(new URL(route.request().url()).pathname.split('/').pop().split('.')[0]);
      if (episode === 2 && route.request().headers().range === 'bytes=0-0') {
        preparations++;
        markPreparing();
        await sleep(1100);
      }
      return fulfillBytes(route, clips.mp4[episode - 1], 'video/mp4');
    });
    await page.route(url => url.pathname === '/api/proxy/m3u8' && url.searchParams.get('fixture') === id, route => {
      const episode = new URL(route.request().url()).searchParams.get('episode');
      return route.fulfill({
        contentType: 'application/vnd.apple.mpegurl',
        body: '#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:6\n#EXT-X-PLAYLIST-TYPE:VOD\n#EXTINF:6.0,\n/handoff-fixtures/' + id + '/' + episode + '/segment.ts\n#EXT-X-ENDLIST\n',
      });
    });
    await page.route('**/handoff-fixtures/' + id + '/**', route => {
      const path = new URL(route.request().url()).pathname;
      const match = path.match(/\/(\d+)(?:\.mp4|\/(segment\.ts))$/);
      assert.ok(match, path);
      const episode = Number(match[1]);
      return fulfillBytes(route, clips[match[2] ? 'hls' : 'mp4'][episode - 1],
        match[2] ? 'video/mp2t' : 'video/mp4');
    });
    await page.goto(origin + '/play?source=' + source + '&id=' + id);
    await captureDecodedEpisode(page, '', 0);

    if (scenario.fullscreen) {
      await page.getByTitle('Page Fullscreen', { exact: true }).evaluate(button => button.click());
      await page.waitForSelector('.videojs-page-fullscreen');
    }

    const video = page.locator('video.vjs-tech');
    const oldSrc = await video.evaluate((media, action) => {
      const oldSrc = media.currentSrc;
      window.handoffEvents = [];
      const mark = event => window.handoffEvents.push({
        event, old: media.currentSrc === oldSrc, time: media.currentTime,
      });
      media.addEventListener('ended', () => {
        mark('ended');
        if (action === 'next') {
          const next = document.querySelector('button[aria-label="Next episode"]');
          window.handoffNextClicked = !!next;
          next?.click();
        }
      }, { capture: true, once: true });
      media.addEventListener('play', () => mark('play'));
      media.addEventListener('playing', () => mark('playing'));
      media.currentTime = media.duration - 0.45;
      return oldSrc;
    }, action);

    await page.waitForFunction(() => window.handoffEvents.some(event => event.event === 'ended'));
    if (action === 'next') {
      assert.equal(await page.evaluate(() => window.handoffNextClicked), true);
    } else if (action === 'pick-third') {
      await Promise.race([
        preparingEpisodeTwo,
        sleep(5000).then(() => { throw Error('Episode two did not start preparation'); }),
      ]);
      await page.getByRole('button', { name: labels[2], exact: true }).evaluate(button => button.click());
    }

    const expectedChannel = action === 'pick-third' ? 2 : 1;
    await captureDecodedEpisode(page, oldSrc, expectedChannel);
    if (scenario.fullscreen) assert.equal(
      await page.locator('.player-container').getAttribute('data-page-fullscreen'), 'true',
    );

    const events = await page.evaluate(() => window.handoffEvents);
    const oldRestart = events.some(event =>
      event.old && event.time < 1 && ['play', 'playing'].includes(event.event),
    );
    if (kind === 'hongguo') assert.ok(preparations > 0, 'Delayed preparation was not exercised');
    assert.equal(oldRestart, baseline && (kind === 'hongguo' || action === 'next'), JSON.stringify(events));

    let finalReplay;
    if (action === 'pick-third') {
      await sleep(1150);
      await captureDecodedEpisode(page, oldSrc, 2);
      await video.evaluate(media => { media.currentTime = media.duration - 0.3; });
      await page.waitForFunction(() => document.querySelector('video.vjs-tech')?.ended);
      assert.equal(await page.getByRole('button', { name: 'Next episode', exact: true }).count(), 0);
      const finalSource = await video.evaluate(media => media.currentSrc);
      await page.getByRole('button', { name: 'Play', exact: true }).first().evaluate(button => button.click());
      await page.waitForFunction(() => {
        const media = document.querySelector('video.vjs-tech');
        return media && !media.paused && media.currentTime > 0.15 && media.currentTime < 2;
      });
      finalReplay = await video.evaluate(media => media.currentSrc) === finalSource;
      assert.equal(finalReplay, true);
    }

    return { kind, action, oldRestart, preparations, fullscreen: !!scenario.fullscreen, finalReplay };
  } catch (error) {
    const state = await page.evaluate(() => {
      const media = document.querySelector('video.vjs-tech');
      return { ready: media?.readyState, paused: media?.paused, time: media?.currentTime,
        error: media?.error?.code, src: media?.currentSrc, heading: document.querySelector('h1')?.textContent,
        events: window.handoffEvents };
    });
    throw Error(JSON.stringify(state), { cause: error });
  } finally {
    await page.close();
  }
}

async function main() {
  const browser = await chromium.launch({
    channel: 'chrome', headless: true, args: ['--autoplay-policy=no-user-gesture-required'],
  });
  try {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
    });
    const login = await context.request.post(origin + '/api/login', {
      data: { username: 'canary-handoff', password },
    });
    assert.equal(login.status(), 200);
    const scenarios = [
      { kind: 'hongguo', action: 'auto', fullscreen: true },
      { kind: 'mp4', action: 'auto' },
      { kind: 'hls', action: 'auto' },
      { kind: 'hls', action: 'next' },
      ...(!baseline ? [{ kind: 'hongguo', action: 'pick-third' }] : []),
    ];
    const checks = await Promise.all(scenarios.map((scenario, index) =>
      playFixture(context, scenario, index).catch(error => { throw Error(JSON.stringify(scenario), { cause: error }); }),
    ));
    assert.ok(assets.size > 0, 'No player assets observed');
    console.log(JSON.stringify({ passed: true, baseline, checks, assets: Object.fromEntries(assets) }));
  } finally {
    await browser.close();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
