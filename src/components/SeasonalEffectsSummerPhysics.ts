import { DropState, TrailState } from '@/effects/renderer/types';

const GRID_CELL = 40;
const GRID_KEY_OFFSET = 1 << 15;
const GRID_KEY_MULTIPLIER = 1 << 16;

type SpatialGrid = Map<number, number[]>;

export interface SummerPhysicsConfig {
  MAX_DROPS: number;
  SPAWN_PER_SEC: number;
  RAMP_TIME: number;
  CLEAR_HOLD: number;
  GROWTH_PER_SEC: number;
  SHRINK_PER_SEC: number;
  TRAIL_LIFE: number;
  TRAIL_WIDTH: number;
  GRAVITY_ACC: number;
  TERMINAL_VEL: number;
  GRAVITY_R: number;
  GRAVITY: number;
  TERM_V: number;
  DRIFT: number;
  WET_SCAN_RADIUS: number;
  WET_SPRING: number;
  WET_DAMP: number;
  WET_VY_BOOST: number;
  MERGE_DIST_FACTOR: number;
  TRAIL_SPAWN_DY: number;
  TRAIL_DECAY: number;
  MAX_TRAILS: number;
}

export interface SummerPhysicsMutableState {
  drops: DropState[];
  trails: TrailState[];
  flash: number;
  // Seconds until a lightning re-strike (second return stroke). 0 = none pending.
  restrikeTimer: number;
  spawnAcc: number;
  startTime: number;
  dropGrid: SpatialGrid;
  dropGridPool: number[][];
  trailGrid: SpatialGrid;
  trailGridPool: number[][];
}

export interface SummerPhysicsPublicState {
  drops: DropState[];
  trails: TrailState[];
  flash: number;
}

export function createSummerPhysicsState(
  startTime: number,
): SummerPhysicsMutableState {
  return {
    drops: [],
    trails: [],
    flash: 0,
    restrikeTimer: 0,
    spawnAcc: 0,
    startTime,
    dropGrid: new Map(),
    dropGridPool: [],
    trailGrid: new Map(),
    trailGridPool: [],
  };
}

export function serializeSummerPhysics(
  drops: DropState[],
  trails: TrailState[],
): { dropsData: Float32Array; trailsData: Float32Array } {
  const dropsData = new Float32Array(drops.length * 9);
  for (let i = 0; i < drops.length; i++) {
    const d = drops[i];
    const off = i * 9;
    dropsData[off + 0] = d.x;
    dropsData[off + 1] = d.y;
    dropsData[off + 2] = d.r;
    dropsData[off + 3] = d.stretch;
    dropsData[off + 4] = d.vx;
    dropsData[off + 5] = d.vy;
    dropsData[off + 6] = d.seed;
    dropsData[off + 7] = d.wobble;
    dropsData[off + 8] = d.falling ? 1.0 : 0.0;
  }

  const trailsData = new Float32Array(trails.length * 6);
  for (let i = 0; i < trails.length; i++) {
    const t = trails[i];
    const off = i * 6;
    trailsData[off + 0] = t.x1;
    trailsData[off + 1] = t.y1;
    trailsData[off + 2] = t.x2;
    trailsData[off + 3] = t.y2;
    trailsData[off + 4] = t.w;
    trailsData[off + 5] = t.life;
  }

  return { dropsData, trailsData };
}

const getGridKey = (cx: number, cy: number) =>
  (cx + GRID_KEY_OFFSET) * GRID_KEY_MULTIPLIER + (cy + GRID_KEY_OFFSET);

function resetSpatialGrid(grid: SpatialGrid, pool: number[][]) {
  for (const arr of grid.values()) {
    arr.length = 0;
    pool.push(arr);
  }
  grid.clear();
}

function getOrCreateGridBucket(
  grid: SpatialGrid,
  key: number,
  pool: number[][],
) {
  let arr = grid.get(key);
  if (!arr) {
    arr = pool.pop() ?? [];
    grid.set(key, arr);
  }
  return arr;
}

function buildDropGrid(
  drops: DropState[],
  grid: SpatialGrid,
  pool: number[][],
) {
  resetSpatialGrid(grid, pool);
  for (let i = 0; i < drops.length; i++) {
    const d = drops[i];
    const key = getGridKey((d.x / GRID_CELL) | 0, (d.y / GRID_CELL) | 0);
    getOrCreateGridBucket(grid, key, pool).push(i);
  }
  return grid;
}

function buildTrailGrid(
  trails: TrailState[],
  grid: SpatialGrid,
  pool: number[][],
) {
  resetSpatialGrid(grid, pool);
  for (let i = 0; i < trails.length; i++) {
    const tr = trails[i];
    const cx0 = (Math.min(tr.x1, tr.x2) / GRID_CELL) | 0;
    const cx1 = (Math.max(tr.x1, tr.x2) / GRID_CELL) | 0;
    const cy0 = (Math.min(tr.y1, tr.y2) / GRID_CELL) | 0;
    const cy1 = (Math.max(tr.y1, tr.y2) / GRID_CELL) | 0;

    for (let cy = cy0; cy <= cy1; cy++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        const key = getGridKey(cx, cy);
        getOrCreateGridBucket(grid, key, pool).push(i);
      }
    }
  }
  return grid;
}

function trailXAtY(tr: TrailState, y: number) {
  const dy = tr.y2 - tr.y1;
  if (Math.abs(dy) < 1e-4) return tr.x2;
  const t = Math.max(0, Math.min(1, (y - tr.y1) / dy));
  return tr.x1 + (tr.x2 - tr.x1) * t;
}

export function stepSummerPhysics(
  state: SummerPhysicsMutableState,
  params: {
    now: number;
    dt: number;
    width: number;
    height: number;
    config: SummerPhysicsConfig;
  },
): SummerPhysicsPublicState {
  const { now, dt, width: w, height: h, config } = params;
  const { drops, trails } = state;

  const elapsed = (now - state.startTime) / 1000;
  let ramp = 0;
  if (elapsed > config.CLEAR_HOLD) {
    const x = Math.min(1, (elapsed - config.CLEAR_HOLD) / config.RAMP_TIME);
    ramp = x * x * (3 - 2 * x);
  }

  if (ramp > 0) {
    state.spawnAcc += config.SPAWN_PER_SEC * ramp * dt;
  }

  while (state.spawnAcc >= 1 && drops.length < config.MAX_DROPS) {
    state.spawnAcc -= 1;
    const isRain = Math.random() < 0.8;
    const isDesktop = w >= 800;
    const r = isRain
      ? 0.5 + Math.random() * 1.5
      : isDesktop
        ? 2.5 + Math.random() * 4.0
        : 3.0 + Math.random() * 4.0;

    drops.push({
      x: 20 + Math.random() * (w - 40),
      y: isRain ? -50 : Math.random() * h,
      r,
      vx: isRain ? 200 + (Math.random() - 0.5) * 50 : 0,
      vy: isRain ? 1200 + Math.random() * 600 : 0,
      seed: Math.random(),
      wobble: Math.random(),
      stretch: isRain ? 1.0 : 0,
      age: 0,
      falling: isRain,
      isRain,
      trailY: 0,
    });
  }

  const trailGrid =
    trails.length > 0
      ? buildTrailGrid(trails, state.trailGrid, state.trailGridPool)
      : (resetSpatialGrid(state.trailGrid, state.trailGridPool), null);

  for (let i = drops.length - 1; i >= 0; i--) {
    const d = drops[i];
    d.age += dt;

    if (!d.falling) {
      d.r = Math.min(d.r + config.GROWTH_PER_SEC * dt, 20);
      const threshold = config.GRAVITY_R + d.seed * 5;
      if (d.r > threshold && d.age > 0.8) {
        d.falling = true;
        d.vy = 0;
      }
    }

    if (d.falling) {
      const mass = Math.max(0.4, d.r / 6);
      const speedMod = Math.max(
        0.1,
        Math.sin(d.y * 0.05 + d.seed * 50.0) * 0.5 + 0.5,
      );
      const gravityForce = config.GRAVITY * mass * speedMod;
      d.vy = Math.min(config.TERM_V, d.vy + gravityForce * dt);

      const zigzagFrequency = 0.03 + d.seed * 0.02;
      const zigzagAmplitude = config.DRIFT * 1.5;
      const targetVx =
        Math.sin(d.y * zigzagFrequency + d.seed * 20.0) * zigzagAmplitude +
        (d.isRain ? 200 : 0);
      d.vx += (targetVx - d.vx) * 4.0 * dt;

      let bestDx = 0;
      let bestAbs = Infinity;
      if (trailGrid && !d.isRain) {
        const cx = (d.x / GRID_CELL) | 0;
        const cy = (d.y / GRID_CELL) | 0;
        for (let oy = -1; oy <= 1; oy++) {
          for (let ox = -1; ox <= 1; ox++) {
            const arr = trailGrid.get(getGridKey(cx + ox, cy + oy));
            if (!arr) continue;
            for (const idx of arr) {
              const tr = trails[idx];
              if (d.y < tr.y1 - 12 || d.y > tr.y2 + 12) {
                continue;
              }
              const xOnTrail = trailXAtY(tr, d.y);
              const dx = xOnTrail - d.x;
              const adx = Math.abs(dx);
              if (adx < config.WET_SCAN_RADIUS && adx < bestAbs) {
                bestAbs = adx;
                bestDx = dx;
              }
            }
          }
        }
      }
      if (bestAbs < Infinity) {
        d.vx += bestDx * config.WET_SPRING * dt;
        d.vy += config.WET_VY_BOOST * dt;
        d.vx *= Math.exp(-config.WET_DAMP * dt);
      }

      d.vx *= Math.exp(-2.5 * dt);
      d.vy *= Math.exp(-0.7 * dt);

      const oldY = d.y;
      d.x += d.vx * dt;
      d.y += d.vy * dt;

      if (d.x < 20) d.x = 20;
      else if (d.x > w - 20) d.x = w - 20;

      const speed = Math.hypot(d.vx, d.vy);
      d.stretch = Math.min(1, speed / 500);
      d.trailY += d.y - oldY;

      if (d.trailY > config.TRAIL_SPAWN_DY && !d.isRain) {
        trails.push({
          x1: d.x - d.vx * dt * (d.trailY / (d.y - oldY || 1)),
          y1: d.y - d.trailY,
          x2: d.x,
          y2: d.y,
          w: d.r * 0.65,
          life: 1,
        });

        d.trailY = 0;
        if (d.r > 1.5) d.r -= 0.05;
      }

      if (d.y > h + 80) {
        d.y = -30 - Math.random() * 60;
        d.x = 20 + Math.random() * (w - 40);

        const isRain = Math.random() < 0.8;
        d.isRain = isRain;
        d.falling = isRain;

        const isBead = Math.random() > 0.6;
        d.r = isRain
          ? 0.5 + Math.random() * 1.5
          : isBead
            ? 1.0 + Math.random() * 1.5
            : 2.0 + Math.random() * 3.0;

        d.vx = isRain ? 200 + (Math.random() - 0.5) * 50 : 0;
        d.vy = isRain ? 1200 + Math.random() * 600 : 0;
        d.age = 0;
        d.stretch = isRain ? 1.0 : 0;
      }
    } else {
      d.stretch *= Math.exp(-2.0 * dt);
    }
  }

  let grid = buildDropGrid(drops, state.dropGrid, state.dropGridPool);
  const mergePass = () => {
    for (let i = 0; i < drops.length; i++) {
      const a = drops[i];
      if (a.isRain) continue;
      const cx = (a.x / GRID_CELL) | 0;
      const cy = (a.y / GRID_CELL) | 0;
      for (let oy = -1; oy <= 1; oy++) {
        for (let ox = -1; ox <= 1; ox++) {
          const arr = grid.get(getGridKey(cx + ox, cy + oy));
          if (!arr) continue;
          for (const j of arr) {
            if (j <= i || j >= drops.length) continue;
            const b = drops[j];
            if (b.isRain) continue;

            const dx = a.x - b.x;
            const dy = a.y - b.y;
            const rr = (a.r + b.r) * config.MERGE_DIST_FACTOR;
            if (dx * dx + dy * dy > rr * rr) continue;

            const wa = a.r * a.r;
            const wb = b.r * b.r;
            a.x = (a.x * wa + b.x * wb) / (wa + wb);
            a.y = (a.y * wa + b.y * wb) / (wa + wb);

            const incomingSpeed = Math.max(a.vy, b.vy);
            if (incomingSpeed > 300) {
              a.vy = incomingSpeed * 0.9;
              a.vx = 0;
            } else {
              a.vx = 0;
              a.vy = 10;
            }

            a.r = Math.sqrt(wa + wb);
            if (a.falling || b.falling) a.falling = true;

            drops[j] = drops[drops.length - 1];
            drops.pop();
            return true;
          }
        }
      }
    }
    return false;
  };

  for (let k = 0; k < 3; k++) {
    if (!mergePass()) break;
    grid = buildDropGrid(drops, state.dropGrid, state.dropGridPool);
  }

  // Decay trails using swap-and-pop (O(1) removal instead of O(n) splice)
  let tLen = trails.length;
  for (let i = tLen - 1; i >= 0; i--) {
    trails[i].life -= config.TRAIL_DECAY * dt;
    if (trails[i].life <= 0) {
      // Fast removal: swap with last element and shrink array
      trails[i] = trails[tLen - 1];
      tLen--;
    }
  }
  trails.length = tLen;

  // Hard cap: keep only the most recent trails (trim oldest from start)
  const maxTrails = config.MAX_TRAILS ?? 1200;
  if (trails.length > maxTrails) {
    trails.splice(0, trails.length - maxTrails);
  }

  // Lightning. A strike flashes the sky bright then fades; ~40% of strikes
  // flicker with a quick second return stroke, like real bolts — so the storm
  // reads less mechanical than a single uniform pop.
  if (state.flash > 0) {
    state.flash *= 0.86;
    if (state.flash < 0.01) state.flash = 0;
  }
  if (state.restrikeTimer > 0) {
    state.restrikeTimer -= dt;
    if (state.restrikeTimer <= 0) {
      state.restrikeTimer = 0;
      state.flash = 0.85 + Math.random() * 0.15;
    }
  }
  if (state.flash === 0 && state.restrikeTimer === 0 && Math.random() < 0.0006) {
    state.flash = 0.9 + Math.random() * 0.1;
    if (Math.random() < 0.4) {
      // Second stroke 70–190ms later.
      state.restrikeTimer = 0.07 + Math.random() * 0.12;
    }
  }

  return {
    drops,
    trails,
    flash: state.flash,
  };
}
