import { describe, expect, it, vi } from 'vitest';
import type {
  AppSettings,
  ProviderAdapter,
  ProviderContext,
  ProviderId,
  ProviderSnapshot,
  ResetEvent,
  UsageWindow,
} from '../src/providers/types';
import { PROVIDER_IDS } from '../src/providers/types';
import { baseSnapshot } from '../src/providers/util';
import { defaultSettings } from '../src/core/settings';
import {
  dueProviders,
  parseResetAlarm,
  runProviders,
} from '../src/core/scheduler';
import type { ScheduleState, SchedulerDeps } from '../src/core/scheduler';
import type { SnapshotMap } from '../src/core/store';

const NOW = new Date('2026-10-01T12:00:00.000Z');
const FUTURE = new Date('2026-10-01T12:03:00.000Z').toISOString();

function settingsFor(enabled: ProviderId[], intervalMin = 3): AppSettings {
  const settings = defaultSettings();
  for (const id of enabled) {
    settings.providers[id] = { ...settings.providers[id], enabled: true, intervalMin };
  }
  return settings;
}

function windowWith(kind: UsageWindow['kind'], resetsAt: string | null = null, usedPercent = 50): UsageWindow {
  return { kind, label: `${kind} 창`, unit: 'percent', usedPercent, resetsAt };
}

function grantFor(remaining: number, idHash = 'hash-1'): ProviderSnapshot['grants'][number] {
  return { provider: 'claude', idHash, scope: 'session_5h', remaining, status: 'available' };
}

interface RecordedDeps extends SchedulerDeps {
  saved: ProviderSnapshot[];
  events: ResetEvent[];
  states: ScheduleState[];
  alarms: { name: string; whenMs: number }[];
  presents: { snapshots: SnapshotMap; settings: AppSettings; events: ResetEvent[] }[];
  contexts: ProviderId[];
  adapterCalls: ProviderId[];
}

interface DepsOptions {
  settings?: AppSettings;
  snapshots?: SnapshotMap;
  state?: ScheduleState;
  fetch?: (id: ProviderId, ctx: ProviderContext) => Promise<ProviderSnapshot>;
  hasOrigins?: boolean;
  timeoutMs?: number;
}

function fakeContext(settings: AppSettings, provider: ProviderId): ProviderContext {
  return {
    now: () => NOW,
    settings,
    providerSettings: settings.providers[provider],
    get: async () => {
      throw new Error('unexpected fetch');
    },
    cache: {
      get: async () => undefined,
      set: async () => undefined,
    },
  };
}

function makeDeps(opts: DepsOptions = {}): RecordedDeps {
  const recorded = {} as RecordedDeps;
  const adapters = Object.fromEntries(
    PROVIDER_IDS.map((id): [ProviderId, ProviderAdapter] => [
      id,
      {
        id,
        fetchSnapshot: (ctx) => {
          recorded.adapterCalls.push(id);
          return opts.fetch ? opts.fetch(id, ctx) : Promise.resolve(baseSnapshot(id, NOW));
        },
      },
    ]),
  ) as Record<ProviderId, ProviderAdapter>;
  const schedulerDeps: SchedulerDeps = {
    now: (): Date => NOW,
    getSettings: async () => opts.settings ?? settingsFor([]),
    getSnapshots: async (): Promise<SnapshotMap> => ({ ...(opts.snapshots ?? {}) }),
    saveSnapshot: async (snapshot: ProviderSnapshot) => {
      recorded.saved.push(snapshot);
    },
    appendEvents: async (events: ResetEvent[]) => {
      recorded.events.push(...events);
    },
    getState: async (): Promise<ScheduleState> => ({ ...(opts.state ?? {}) }),
    setState: async (state: ScheduleState) => {
      recorded.states.push(state);
    },
    adapters,
    makeContext: (settings: AppSettings, provider: ProviderId) => {
      recorded.contexts.push(provider);
      return fakeContext(settings, provider);
    },
    hasOrigins: async () => opts.hasOrigins ?? true,
    scheduleAlarm: async (name: string, whenMs: number) => {
      recorded.alarms.push({ name, whenMs });
    },
    present: async (snapshots: SnapshotMap, settings: AppSettings, events: ResetEvent[]) => {
      recorded.presents.push({ snapshots, settings, events });
    },
    ...(opts.timeoutMs !== undefined ? { timeoutMs: opts.timeoutMs } : {}),
  };
  Object.assign(
    recorded,
    {
      saved: [],
      events: [],
      states: [],
      alarms: [],
      presents: [],
      contexts: [],
      adapterCalls: [],
    },
    schedulerDeps,
  );
  return recorded;
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

describe('dueProviders', () => {
  const settings = settingsFor(['claude', 'poe']);

  it('treats a missing state entry as due', () => {
    expect(dueProviders(settings, { poe: { nextDueAt: FUTURE, failures: 0 } }, NOW)).toEqual(['claude']);
  });

  it('treats nextDueAt at or before now as due', () => {
    const state: ScheduleState = {
      claude: { nextDueAt: NOW.toISOString(), failures: 0 },
      poe: { nextDueAt: new Date(NOW.getTime() - 1).toISOString(), failures: 2 },
    };
    expect(dueProviders(settings, state, NOW)).toEqual(['claude', 'poe']);
  });

  it('treats a future nextDueAt as not due', () => {
    const state: ScheduleState = { claude: { nextDueAt: FUTURE, failures: 0 } };
    expect(dueProviders(settings, state, NOW)).toEqual(['poe']);
  });

  it('treats null nextDueAt as paused, not due', () => {
    const state: ScheduleState = { claude: { nextDueAt: null, failures: 0 } };
    expect(dueProviders(settings, state, NOW)).toEqual(['poe']);
  });

  it('ignores disabled providers even without a state entry', () => {
    expect(dueProviders(settingsFor(['claude']), {}, NOW)).toEqual(['claude']);
  });
});

describe('parseResetAlarm', () => {
  it('parses reset alarm names', () => {
    expect(parseResetAlarm('reset:claude:session_5h')).toBe('claude');
    expect(parseResetAlarm('reset:zai:weekly_7d')).toBe('zai');
    expect(parseResetAlarm('reset:openrouter:month')).toBe('openrouter');
  });

  it('rejects other names', () => {
    expect(parseResetAlarm('tick')).toBeNull();
    expect(parseResetAlarm('reset:claude')).toBeNull();
    expect(parseResetAlarm('reset:claude:session_5h:extra')).toBeNull();
    expect(parseResetAlarm('reset:unknown:day')).toBeNull();
    expect(parseResetAlarm('')).toBeNull();
  });
});

describe('runProviders', () => {
  it('skips disabled providers', async () => {
    const deps = makeDeps({ settings: settingsFor(['claude']) });
    await runProviders(['claude', 'poe'], deps);
    expect(deps.adapterCalls).toEqual(['claude']);
    expect(deps.saved.map((snapshot) => snapshot.provider)).toEqual(['claude']);
  });

  it('skips providers that are not due unless force is set', async () => {
    const state: ScheduleState = { claude: { nextDueAt: FUTURE, failures: 0 } };
    const paused: ScheduleState = { poe: { nextDueAt: null, failures: 1 } };
    const settings = settingsFor(['claude', 'poe']);

    const skipped = makeDeps({ settings, state: { ...state, ...paused } });
    await runProviders(['claude', 'poe'], skipped);
    expect(skipped.adapterCalls).toEqual([]);

    const forced = makeDeps({ settings, state: { ...state, ...paused } });
    await runProviders(['claude', 'poe'], forced, { force: true });
    expect(forced.adapterCalls).toEqual(['claude', 'poe']);
  });

  it('reports permission_missing without calling the adapter and pauses the provider', async () => {
    const deps = makeDeps({ settings: settingsFor(['claude']), hasOrigins: false });
    await runProviders(['claude'], deps);
    expect(deps.adapterCalls).toEqual([]);
    expect(deps.saved).toHaveLength(1);
    expect(deps.saved[0].status).toBe('permission_missing');
    expect(deps.saved[0].error?.message).toBe('호스트 권한이 필요합니다');
    expect(deps.states[0].claude).toEqual({ nextDueAt: null, failures: 1 });
  });

  it('skips the permission check when the provider needs no host origin', async () => {
    const settings = settingsFor(['litellm']);
    const deps = makeDeps({ settings, hasOrigins: false });
    await runProviders(['litellm'], deps);
    expect(deps.adapterCalls).toEqual(['litellm']);
    expect(deps.saved[0].status).toBe('ok');
  });

  it('turns an adapter throw into an error snapshot with backoff and failures + 1', async () => {
    const previous = { ...baseSnapshot('claude', NOW), windows: [windowWith('session_5h')] };
    const deps = makeDeps({
      settings: settingsFor(['claude']),
      snapshots: { claude: previous },
      state: { claude: { nextDueAt: FUTURE, failures: 2 } },
      fetch: () => Promise.reject(new Error('boom')),
    });
    await runProviders(['claude'], deps, { force: true });
    expect(deps.saved[0].status).toBe('error');
    expect(deps.saved[0].error?.message).toBe('boom');
    expect(deps.saved[0].windows).toEqual(previous.windows);
    expect(deps.states[0].claude).toEqual({
      nextDueAt: new Date(NOW.getTime() + 240_000).toISOString(),
      failures: 3,
    });
  });

  it('turns a timed-out adapter into an error snapshot', async () => {
    const deps = makeDeps({
      settings: settingsFor(['claude']),
      timeoutMs: 20,
      fetch: () => new Promise<ProviderSnapshot>(() => undefined),
    });
    await runProviders(['claude'], deps);
    expect(deps.saved[0].status).toBe('error');
    expect(deps.saved[0].error?.message).toBe('timeout');
    expect(deps.states[0].claude).toEqual({ nextDueAt: FUTURE, failures: 1 });
  });

  it('saves each snapshot as soon as it resolves', async () => {
    const gate = deferred<void>();
    const deps = makeDeps({
      settings: settingsFor(['claude', 'chatgpt']),
      fetch: (id) =>
        id === 'claude'
          ? Promise.resolve(baseSnapshot('claude', NOW))
          : gate.promise.then(() => baseSnapshot('chatgpt', NOW)),
    });
    const running = runProviders(['claude', 'chatgpt'], deps);
    await vi.waitFor(() => {
      expect(deps.saved.map((snapshot) => snapshot.provider)).toContain('claude');
    });
    expect(deps.saved.some((snapshot) => snapshot.provider === 'chatgpt')).toBe(false);
    gate.resolve();
    await running;
    expect(deps.saved.map((snapshot) => snapshot.provider)).toEqual(['claude', 'chatgpt']);
  });

  it('stays silent on the first run even when grants exist', async () => {
    const next = { ...baseSnapshot('claude', NOW), grants: [grantFor(1)] };
    const deps = makeDeps({ settings: settingsFor(['claude']), fetch: () => Promise.resolve(next) });
    await runProviders(['claude'], deps);
    expect(deps.events).toEqual([]);
    expect(deps.presents[0].events).toEqual([]);
  });

  it('appends detected events and resets failures on success', async () => {
    const previous = { ...baseSnapshot('claude', NOW), grants: [grantFor(1)] };
    const next = { ...baseSnapshot('claude', NOW), grants: [grantFor(2)] };
    const deps = makeDeps({
      settings: settingsFor(['claude']),
      snapshots: { claude: previous },
      state: { claude: { nextDueAt: null, failures: 2 } },
      fetch: () => Promise.resolve(next),
    });
    await runProviders(['claude'], deps, { force: true });
    expect(deps.events).toEqual([
      { type: 'GRANT_ADDED', provider: 'claude', scope: 'session_5h', at: NOW.toISOString() },
    ]);
    expect(deps.states[0].claude).toEqual({ nextDueAt: FUTURE, failures: 0 });
    expect(deps.presents[0].events).toEqual(deps.events);
  });

  it('honors retryAt for rate-limited snapshots', async () => {
    const retryAt = new Date(NOW.getTime() + 30 * 60_000).toISOString();
    const next: ProviderSnapshot = {
      ...baseSnapshot('claude', NOW),
      status: 'rate_limited',
      error: { code: 'rate_limited', message: '너무 많은 요청', retryAt },
    };
    const deps = makeDeps({
      settings: settingsFor(['claude']),
      state: { claude: { nextDueAt: FUTURE, failures: 2 } },
      fetch: () => Promise.resolve(next),
    });
    await runProviders(['claude'], deps, { force: true });
    expect(deps.states[0].claude).toEqual({ nextDueAt: retryAt, failures: 3 });
  });

  it('schedules reset alarms only for future windows at resetsAt + 15s', async () => {
    const next: ProviderSnapshot = {
      ...baseSnapshot('claude', NOW),
      windows: [
        windowWith('session_5h', new Date(NOW.getTime() + 3_600_000).toISOString(), 60),
        windowWith('weekly_7d', new Date(NOW.getTime() - 60_000).toISOString(), 40),
        windowWith('weekly_model', null, 10),
      ],
    };
    const deps = makeDeps({ settings: settingsFor(['claude']), fetch: () => Promise.resolve(next) });
    await runProviders(['claude'], deps);
    expect(deps.alarms).toEqual([
      {
        name: 'reset:claude:session_5h',
        whenMs: NOW.getTime() + 3_600_000 + 15_000,
      },
    ]);
  });

  it('calls setState once and presents the latest snapshots once', async () => {
    const existing = baseSnapshot('poe', NOW);
    const next = baseSnapshot('claude', NOW);
    const settings = settingsFor(['claude']);
    const deps = makeDeps({
      settings,
      snapshots: { poe: existing },
      state: { poe: { nextDueAt: FUTURE, failures: 0 } },
      fetch: () => Promise.resolve(next),
    });
    await runProviders(['claude'], deps);
    expect(deps.states).toHaveLength(1);
    expect(deps.states[0].poe).toEqual({ nextDueAt: FUTURE, failures: 0 });
    expect(deps.presents).toHaveLength(1);
    expect(deps.presents[0].snapshots.claude).toBe(next);
    expect(deps.presents[0].snapshots.poe).toBe(existing);
    expect(deps.presents[0].settings).toBe(settings);
  });
});
