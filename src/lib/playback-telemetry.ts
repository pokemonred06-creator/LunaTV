type PlaybackEventType =
  | 'session_start'
  | 'startup_complete'
  | 'rebuffer_start'
  | 'rebuffer_recover'
  | 'fatal_error'
  | 'session_end';

interface PlaybackTelemetryEvent {
  event: PlaybackEventType;
  sessionId: string;
  seriesId: string;
  isLive: boolean;
  startupMs?: number;
  stalls?: number;
  recoveries?: number;
  fatalErrors?: number;
}

interface SessionState {
  isLive: boolean;
  seriesId: string;
  startedAt: number;
  startupMs?: number;
  stalls: number;
  recoveries: number;
  fatalErrors: number;
}

interface SeriesAggregate {
  seriesId: string;
  sessions: number;
  stalls: number;
  fatalErrors: number;
}

export interface PlaybackTelemetrySnapshot {
  windowMinutes: number;
  generatedAt: string;
  sessions: number;
  startupCompleted: number;
  startupP50Ms: number;
  startupP95Ms: number;
  totalStalls: number;
  totalRecoveries: number;
  totalFatalErrors: number;
  stallRatePerSession: number;
  fatalRatePerSession: number;
  recoveryRate: number;
  liveSessions: number;
  vodSessions: number;
  healthScore: number;
  topSeries: SeriesAggregate[];
}

const DEFAULT_WINDOW_MS = 60 * 60 * 1000;
const MAX_WINDOW_MS = 24 * 60 * 60 * 1000;
const MAX_SESSIONS = 5000;

const sessionStore = new Map<string, SessionState>();

function cleanup(now: number) {
  const expiredBefore = now - MAX_WINDOW_MS;
  for (const [sessionId, s] of sessionStore.entries()) {
    if (s.startedAt < expiredBefore) sessionStore.delete(sessionId);
  }

  if (sessionStore.size <= MAX_SESSIONS) return;
  const ordered = Array.from(sessionStore.entries()).sort(
    (a, b) => a[1].startedAt - b[1].startedAt,
  );
  const overflow = sessionStore.size - MAX_SESSIONS;
  for (let i = 0; i < overflow; i += 1) {
    sessionStore.delete(ordered[i][0]);
  }
}

function percentile(sorted: number[], p: number) {
  if (sorted.length === 0) return 0;
  const idx = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((p / 100) * sorted.length) - 1),
  );
  return Math.round(sorted[idx]);
}

export function ingestPlaybackTelemetry(raw: unknown) {
  if (!raw || typeof raw !== 'object') return;
  const event = raw as PlaybackTelemetryEvent;
  if (!event.sessionId || !event.event) return;

  const now = Date.now();
  cleanup(now);

  const prev = sessionStore.get(event.sessionId);
  const state: SessionState = prev || {
    isLive: !!event.isLive,
    seriesId: event.seriesId || 'global',
    startedAt: now,
    stalls: 0,
    recoveries: 0,
    fatalErrors: 0,
  };

  if (event.event === 'session_start') {
    state.startedAt = now;
    state.isLive = !!event.isLive;
    state.seriesId = event.seriesId || state.seriesId;
  } else if (event.event === 'startup_complete') {
    if (Number.isFinite(event.startupMs)) {
      state.startupMs = Number(event.startupMs);
    }
  } else if (event.event === 'rebuffer_start') {
    state.stalls += 1;
  } else if (event.event === 'rebuffer_recover') {
    state.recoveries += 1;
  } else if (event.event === 'fatal_error') {
    state.fatalErrors += 1;
  } else if (event.event === 'session_end') {
    if (Number.isFinite(event.stalls)) state.stalls = Number(event.stalls);
    if (Number.isFinite(event.recoveries))
      state.recoveries = Number(event.recoveries);
    if (Number.isFinite(event.fatalErrors))
      state.fatalErrors = Number(event.fatalErrors);
  }

  sessionStore.set(event.sessionId, state);
}

export function getPlaybackTelemetrySnapshot(
  windowMinutes = 60,
): PlaybackTelemetrySnapshot {
  const now = Date.now();
  cleanup(now);
  const clampedWindowMs = Math.min(
    MAX_WINDOW_MS,
    Math.max(
      5 * 60 * 1000,
      Math.round((Number(windowMinutes) || 60) * 60 * 1000),
    ),
  );
  const cutoff = now - clampedWindowMs;

  const sessions = Array.from(sessionStore.values()).filter(
    (s) => s.startedAt >= cutoff,
  );
  const startupSamples = sessions
    .map((s) => s.startupMs)
    .filter((v): v is number => Number.isFinite(v))
    .sort((a, b) => a - b);

  let totalStalls = 0;
  let totalRecoveries = 0;
  let totalFatalErrors = 0;
  let liveSessions = 0;
  let vodSessions = 0;
  const perSeries = new Map<string, SeriesAggregate>();

  for (const s of sessions) {
    totalStalls += s.stalls;
    totalRecoveries += s.recoveries;
    totalFatalErrors += s.fatalErrors;
    if (s.isLive) liveSessions += 1;
    else vodSessions += 1;
    const key = s.seriesId || 'global';
    const curr = perSeries.get(key) || {
      seriesId: key,
      sessions: 0,
      stalls: 0,
      fatalErrors: 0,
    };
    curr.sessions += 1;
    curr.stalls += s.stalls;
    curr.fatalErrors += s.fatalErrors;
    perSeries.set(key, curr);
  }

  const sessionCount = sessions.length;
  const stallRatePerSession =
    sessionCount > 0 ? Number((totalStalls / sessionCount).toFixed(3)) : 0;
  const fatalRatePerSession =
    sessionCount > 0 ? Number((totalFatalErrors / sessionCount).toFixed(3)) : 0;
  const recoveryRate =
    totalStalls > 0 ? Number((totalRecoveries / totalStalls).toFixed(3)) : 0;
  const healthScoreRaw =
    100 - stallRatePerSession * 15 - fatalRatePerSession * 30;
  const healthScore = Math.max(
    0,
    Math.min(100, Number(healthScoreRaw.toFixed(1))),
  );

  const topSeries = Array.from(perSeries.values())
    .sort((a, b) => {
      const scoreA = a.stalls * 2 + a.fatalErrors * 4;
      const scoreB = b.stalls * 2 + b.fatalErrors * 4;
      if (scoreB !== scoreA) return scoreB - scoreA;
      return b.sessions - a.sessions;
    })
    .slice(0, 5);

  return {
    windowMinutes: Math.round(clampedWindowMs / 60000),
    generatedAt: new Date().toISOString(),
    sessions: sessionCount,
    startupCompleted: startupSamples.length,
    startupP50Ms: percentile(startupSamples, 50),
    startupP95Ms: percentile(startupSamples, 95),
    totalStalls,
    totalRecoveries,
    totalFatalErrors,
    stallRatePerSession,
    fatalRatePerSession,
    recoveryRate,
    liveSessions,
    vodSessions,
    healthScore,
    topSeries,
  };
}
