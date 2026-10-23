import { type ChildProcess, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

interface Relay {
  id: string;
  key: string;
  directory: string;
  process: ChildProcess;
  lastAccess: number;
  error?: string;
  ready: Promise<void>;
}

const state = globalThis as typeof globalThis & {
  __lunatvLiveRelays?: Map<string, Relay>;
  __lunatvPendingRelays?: Map<string, Promise<Relay>>;
  __lunatvRelayCleanup?: ReturnType<typeof setInterval>;
};
const relays = (state.__lunatvLiveRelays ||= new Map<string, Relay>());
const pending = (state.__lunatvPendingRelays ||= new Map<
  string,
  Promise<Relay>
>());
const limit = Math.max(1, Number(process.env.LIVE_TRANSCODE_LIMIT) || 2);
const idleMs = 45000;

async function dispose(relay: Relay) {
  if (relays.get(relay.id) !== relay) return;
  relays.delete(relay.id);
  relay.process.kill('SIGKILL');
  await rm(relay.directory, { recursive: true, force: true });
}

const cleanup = (state.__lunatvRelayCleanup ||= setInterval(() => {
  for (const relay of relays.values()) {
    if (Date.now() - relay.lastAccess > idleMs) void dispose(relay);
  }
}, 15000));
cleanup.unref();

export async function getLiveRelay(
  key: string,
  inputUrl: string,
  cookie: string,
) {
  const existing = [...relays.values()].find(
    (relay) => relay.key === key && !relay.error,
  );
  if (existing) {
    existing.lastAccess = Date.now();
    await existing.ready;
    return existing.id;
  }
  const inFlight = pending.get(key);
  if (inFlight) return (await inFlight).id;
  const activeKeys = new Set([
    ...[...relays.values()].map((relay) => relay.key),
    ...pending.keys(),
  ]);
  if (activeKeys.size >= limit)
    throw new Error('Compatibility player is busy; try again shortly');
  const creating = (async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'lunatv-live-'));
    const id = randomUUID();
    const child = spawn(
      'ffmpeg',
      [
        '-hide_banner',
        '-loglevel',
        'error',
        '-nostdin',
        '-headers',
        `Cookie: ${cookie}\r\n`,
        '-re',
        '-i',
        inputUrl,
        '-map',
        '0:v:0?',
        '-map',
        '0:a:0?',
        '-c:v',
        'libx264',
        '-preset',
        'veryfast',
        '-tune',
        'zerolatency',
        '-vf',
        'scale=w=1280:h=720:force_original_aspect_ratio=decrease:force_divisible_by=2',
        '-pix_fmt',
        'yuv420p',
        '-force_key_frames',
        'expr:gte(t,n_forced*2)',
        '-c:a',
        'aac',
        '-b:a',
        '128k',
        '-ac',
        '2',
        '-f',
        'hls',
        '-hls_time',
        '2',
        '-hls_list_size',
        '8',
        '-hls_delete_threshold',
        '4',
        '-hls_flags',
        'delete_segments+omit_endlist+independent_segments',
        '-hls_segment_filename',
        path.join(directory, 'segment-%d.ts'),
        path.join(directory, 'index.m3u8'),
      ],
      { stdio: ['ignore', 'ignore', 'pipe'] },
    );
    const relay: Relay = {
      id,
      key,
      directory,
      process: child,
      lastAccess: Date.now(),
      ready: Promise.resolve(),
    };
    relays.set(id, relay);
    child.stderr?.on('data', () => {
      /* Provider URLs and cookies must stay out of logs. */
    });
    child.on('error', () => {
      relay.error = 'Compatibility playback tool is unavailable';
    });
    child.on('exit', (code) => {
      if (code !== 0) relay.error ||= 'The source could not be decoded';
    });
    relay.ready = (async () => {
      const deadline = Date.now() + 25000;
      while (Date.now() < deadline) {
        if (relay.error) throw new Error(relay.error);
        try {
          const manifest = await readFile(
            path.join(directory, 'index.m3u8'),
            'utf8',
          );
          if (manifest.includes('#EXTINF:')) return;
        } catch {
          /* Wait for the first complete media segment. */
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      throw new Error('The source did not produce video in time');
    })();
    try {
      await relay.ready;
    } catch (error) {
      await dispose(relay);
      throw error;
    }
    return relay;
  })();
  pending.set(key, creating);
  try {
    return (await creating).id;
  } finally {
    pending.delete(key);
  }
}

export async function readLiveRelay(
  id: string,
  file: string,
  username: string,
  sources: string[],
) {
  const relay = relays.get(id);
  if (!relay || !/^(index\.m3u8|segment-\d+\.ts)$/.test(file)) return null;
  const [owner, source] = JSON.parse(relay.key) as string[];
  if (owner !== username || !sources.includes(source)) return null;
  relay.lastAccess = Date.now();
  try {
    return await readFile(path.join(relay.directory, file));
  } catch {
    return null;
  }
}
