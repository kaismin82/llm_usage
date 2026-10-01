import { nextAttemptAt } from '../core/backoff';
import { customOrigin, validateCustomProvider } from './config';
import { customErrorSnapshot, fetchCustomSnapshot } from './fetch';
import type { CustomStore } from './store';
import type { CustomProviderConfig, CustomSnapshot } from './types';

type RunnerDeps = {
  readonly store: CustomStore;
  readonly now: () => Date;
  readonly hasOrigin: (origin: string) => Promise<boolean>;
  readonly fetchSnapshot?: typeof fetchCustomSnapshot;
};

export function createCustomRunner(deps: RunnerDeps) {
  // Queues serialize writes for each custom provider, independently of the built-in queues.
  const inFlight = new Map<string, Promise<void>>();

  const runOne = async (id: string, force: boolean): Promise<void> => {
    const config = (await deps.store.getProviders()).find((p) => p.id === id);
    if (!config?.enabled) return;
    const state = await deps.store.getSchedule(id);
    if (!force && state && (state.nextDueAt === null || Date.parse(state.nextDueAt) > deps.now().getTime())) return;
    const previous = await deps.store.getSnapshot(id);
    const options = { now: deps.now, previous };
    const validation = validateCustomProvider(config);
    let snapshot: CustomSnapshot;
    if (validation) {
      snapshot = customErrorSnapshot(config, options, { status: 'not_configured', message: validation });
    } else if (!(await deps.hasOrigin(customOrigin(config)))) {
      snapshot = customErrorSnapshot(config, options, { status: 'permission_missing', message: '호스트 권한이 필요합니다' });
    } else {
      snapshot = await (deps.fetchSnapshot ?? fetchCustomSnapshot)(config, options);
    }
    const current = (await deps.store.getProviders()).find((p) => p.id === id);
    // An edit or deletion during HTTP must not publish data for the old configuration.
    if (!current || JSON.stringify(current) !== JSON.stringify(config)) return;
    const failures = snapshot.status === 'ok' ? 0 : (state?.failures ?? 0) + 1;
    const next = nextAttemptAt(deps.now(), config.intervalMin, snapshot.status, failures, snapshot.error?.retryAt);
    await deps.store.saveResult(snapshot, { nextDueAt: next?.toISOString() ?? null, failures });
  };

  const queue = (config: CustomProviderConfig, force: boolean): Promise<void> => {
    const previous = inFlight.get(config.id) ?? Promise.resolve();
    const run = previous.then(() => runOne(config.id, force), () => runOne(config.id, force));
    inFlight.set(config.id, run);
    const release = () => {
      if (inFlight.get(config.id) === run) inFlight.delete(config.id);
    };
    void run.then(release, release);
    return run;
  };

  return {
    async run(id?: string, force = false): Promise<void> {
      const providers = await deps.store.getProviders();
      await Promise.all(providers
        .filter((p) => p.enabled && (id === undefined || p.id === id))
        .map((p) => queue(p, force)));
    },
  };
}
