import type {
  AppSettings,
  ProviderAdapter,
  ProviderContext,
  ProviderId,
  ProviderSettings,
  ProviderSnapshot,
  ResetEvent,
} from '../providers/types';
import { PROVIDER_IDS } from '../providers/types';
import { errorSnapshot } from '../providers/util';
import { nextAttemptAt } from './backoff';
import { originsFor } from './permissions';
import { detectResetEvents } from './reset-detector';
import type { SnapshotMap } from './store';

const RESET_ALARM_DELAY_MS = 15_000;
const DEFAULT_TIMEOUT_MS = 25_000;

export type ScheduleState = Partial<Record<ProviderId, { nextDueAt: string | null; failures: number }>>;

export interface SchedulerDeps {
  now(): Date;
  getSettings(): Promise<AppSettings>;
  getSnapshots(): Promise<SnapshotMap>;
  saveSnapshot(s: ProviderSnapshot): Promise<void>;
  appendEvents(e: ResetEvent[]): Promise<void>;
  getState(): Promise<ScheduleState>;
  setState(s: ScheduleState): Promise<void>;
  adapters: Record<ProviderId, ProviderAdapter>;
  makeContext(settings: AppSettings, provider: ProviderId, previous?: ProviderSnapshot): ProviderContext;
  hasOrigins(origins: string[]): Promise<boolean>;
  scheduleAlarm(name: string, whenMs: number): Promise<void>;
  present(snapshots: SnapshotMap, settings: AppSettings, events: ResetEvent[]): Promise<void>;
  timeoutMs?: number;
}

export function dueProviders(settings: AppSettings, state: ScheduleState, now: Date): ProviderId[] {
  const time = now.getTime();
  return PROVIDER_IDS.filter((id) => {
    if (!settings.providers[id]?.enabled) return false;
    const entry = state[id];
    if (entry === undefined) return true;
    if (entry.nextDueAt === null) return false;
    return Date.parse(entry.nextDueAt) <= time;
  });
}

export function parseResetAlarm(name: string): ProviderId | null {
  const parts = name.split(':');
  if (parts.length !== 3 || parts[0] !== 'reset') return null;
  const provider = parts[1] as ProviderId;
  return PROVIDER_IDS.includes(provider) ? provider : null;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

export async function runProviders(
  ids: ProviderId[],
  deps: SchedulerDeps,
  opts: { force?: boolean } = {},
): Promise<void> {
  const [settings, snapshots, state] = await Promise.all([
    deps.getSettings(),
    deps.getSnapshots(),
    deps.getState(),
  ]);
  const newState: ScheduleState = { ...state };
  const latest: SnapshotMap = { ...snapshots };
  const allEvents: ResetEvent[] = [];
  const due = new Set(dueProviders(settings, state, deps.now()));

  const settle = async (
    id: ProviderId,
    providerSettings: ProviderSettings,
    previous: ProviderSnapshot | undefined,
    snapshot: ProviderSnapshot,
  ): Promise<void> => {
    const now = deps.now();
    await deps.saveSnapshot(snapshot);
    latest[id] = snapshot;
    const events = detectResetEvents(previous, snapshot, now, { firstRun: previous === undefined });
    if (events.length > 0) {
      allEvents.push(...events);
      await deps.appendEvents(events);
    }
    const failures = snapshot.status === 'ok' ? 0 : (state[id]?.failures ?? 0) + 1;
    const next = nextAttemptAt(now, providerSettings.intervalMin, snapshot.status, failures, snapshot.error?.retryAt);
    newState[id] = { nextDueAt: next === null ? null : next.toISOString(), failures };
    for (const window of snapshot.windows) {
      if (!window.resetsAt) continue;
      const resetsAt = Date.parse(window.resetsAt);
      if (!Number.isFinite(resetsAt) || resetsAt <= now.getTime()) continue;
      await deps.scheduleAlarm(`reset:${id}:${window.kind}`, resetsAt + RESET_ALARM_DELAY_MS);
    }
  };

  const runOne = async (id: ProviderId): Promise<void> => {
    const providerSettings = settings.providers[id];
    if (!providerSettings?.enabled) return;
    if (!opts.force && !due.has(id)) return;
    const previous = snapshots[id];

    const origins = originsFor(id, providerSettings);
    if (origins.length > 0 && !(await deps.hasOrigins(origins))) {
      await settle(
        id,
        providerSettings,
        previous,
        errorSnapshot(id, deps.now(), 'permission_missing', '호스트 권한이 필요합니다', previous),
      );
      return;
    }

    let snapshot: ProviderSnapshot;
    try {
      const context = deps.makeContext(settings, id, previous);
      snapshot = await withTimeout(
        deps.adapters[id].fetchSnapshot(context),
        deps.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'fetch failed';
      snapshot = errorSnapshot(id, deps.now(), 'error', message, previous);
    }
    await settle(id, providerSettings, previous, snapshot);
  };

  await Promise.allSettled(ids.map((id) => runOne(id)));
  await deps.setState(newState);
  await deps.present(latest, settings, allEvents);
}
