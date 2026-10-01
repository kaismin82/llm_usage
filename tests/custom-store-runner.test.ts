import { describe, expect, it, vi } from 'vitest';
import { defaultSettings } from '../src/core/settings';
import { createCustomRunner } from '../src/custom/runner';
import { createCustomStore, CUSTOM_PROVIDERS_KEY, customSnapshotKey } from '../src/custom/store';
import type { CustomProviderConfig, CustomSnapshot } from '../src/custom/types';

const NOW = new Date('2026-10-01T12:00:00Z');
const config: CustomProviderConfig = {
  id: 'example', name: 'Example', enabled: true, intervalMin: 10,
  endpoint: 'https://usage.example.com/quota', authMode: 'none',
  apiKey: '', headerName: 'X-API-Key', headers: {}, windows: [],
  balancePath: 'balance', balanceUnit: 'usd',
};
const result: CustomSnapshot = {
  provider: config.id, status: 'ok', windows: [], balance: { amount: 12, unit: 'usd' },
  fetchedAt: NOW.toISOString(), attemptedAt: NOW.toISOString(),
};

function memory(initial: Record<string, unknown> = {}) {
  const data = structuredClone(initial);
  const store = createCustomStore({
    get: async (keys) => Object.fromEntries((typeof keys === 'string' ? [keys] : keys)
      .map((key) => [key, structuredClone(data[key])])),
    set: async (items) => { Object.assign(data, structuredClone(items)); },
    remove: async (keys) => {
      for (const key of typeof keys === 'string' ? [keys] : keys) delete data[key];
    },
  });
  return { data, store };
}

function deferred<T>() {
  let resolve: ((value: T) => void) | undefined;
  const promise = new Promise<T>((complete) => { resolve = complete; });
  if (!resolve) throw new Error('Promise executor did not run');
  return { promise, resolve };
}

describe('custom storage isolation', () => {
  it('adds custom configuration without rewriting built-in settings or snapshots', async () => {
    // Given
    const builtins = { settings: defaultSettings(), snapshots: { claude: { status: 'ok', windows: [25] } } };
    const { data, store } = memory(builtins);
    // When
    await store.saveProvider(config);
    // Then
    expect(data.settings).toEqual(builtins.settings);
    expect(data.snapshots).toEqual(builtins.snapshots);
    expect(await store.getProviders()).toEqual([config]);
  });

  it('removes only the selected custom provider and its cached result', async () => {
    // Given
    const { data, store } = memory({
      [CUSTOM_PROVIDERS_KEY]: [config, { ...config, id: 'other' }],
      [customSnapshotKey(config.id)]: result,
      snapshots: { poe: { balance: 50 } },
    });
    // When
    await store.deleteProvider(config.id);
    // Then
    expect(await store.getProviders()).toEqual([{ ...config, id: 'other' }]);
    expect(data[customSnapshotKey(config.id)]).toBeUndefined();
    expect(data.snapshots).toEqual({ poe: { balance: 50 } });
  });

  it('loads old installations as having no custom providers', async () => {
    // Given / When / Then
    expect(await memory({ settings: defaultSettings() }).store.getProviders()).toEqual([]);
  });
});

describe('custom scheduling', () => {
  it('polls once when due and waits until the configured interval', async () => {
    // Given
    const { store } = memory({ [CUSTOM_PROVIDERS_KEY]: [config] });
    const fetchSnapshot = vi.fn(async () => result);
    const runner = createCustomRunner({ store, now: () => NOW, hasOrigin: async () => true, fetchSnapshot });
    // When
    await runner.run();
    await runner.run();
    // Then
    expect(fetchSnapshot).toHaveBeenCalledTimes(1);
    expect(await store.getSchedule(config.id)).toEqual({
      nextDueAt: '2026-10-01T12:10:00.000Z', failures: 0,
    });
  });

  it('pauses when host access is missing without sending a request', async () => {
    // Given
    const { store } = memory({ [CUSTOM_PROVIDERS_KEY]: [config] });
    const fetchSnapshot = vi.fn(async () => result);
    const runner = createCustomRunner({ store, now: () => NOW, hasOrigin: async () => false, fetchSnapshot });
    // When
    await runner.run();
    // Then
    expect(fetchSnapshot).not.toHaveBeenCalled();
    expect((await store.getSnapshot(config.id))?.status).toBe('permission_missing');
    expect((await store.getSchedule(config.id))?.nextDueAt).toBeNull();
  });

  it('does not poll disabled custom providers', async () => {
    // Given
    const { store } = memory({ [CUSTOM_PROVIDERS_KEY]: [{ ...config, enabled: false }] });
    const fetchSnapshot = vi.fn(async () => result);
    const runner = createCustomRunner({ store, now: () => NOW, hasOrigin: async () => true, fetchSnapshot });
    // When
    await runner.run(config.id, true);
    // Then
    expect(fetchSnapshot).not.toHaveBeenCalled();
  });

  it('serializes concurrent refreshes for the same custom provider', async () => {
    // Given
    const { store } = memory({ [CUSTOM_PROVIDERS_KEY]: [config] });
    const started = deferred<void>();
    const gate = deferred<void>();
    let active = 0;
    let maximum = 0;
    let calls = 0;
    const runner = createCustomRunner({
      store, now: () => NOW, hasOrigin: async () => true,
      fetchSnapshot: async () => {
        active += 1;
        maximum = Math.max(maximum, active);
        calls += 1;
        if (calls === 1) {
          started.resolve();
          await gate.promise;
        }
        active -= 1;
        return result;
      },
    });
    // When
    const first = runner.run(config.id, true);
    await started.promise;
    const second = runner.run(config.id, true);
    gate.resolve();
    await Promise.all([first, second]);
    // Then
    expect(calls).toBe(2);
    expect(maximum).toBe(1);
  });

  it('discards results for a provider deleted during its request', async () => {
    // Given
    const { store } = memory({ [CUSTOM_PROVIDERS_KEY]: [config] });
    const started = deferred<void>();
    const gate = deferred<CustomSnapshot>();
    const runner = createCustomRunner({
      store, now: () => NOW, hasOrigin: async () => true,
      fetchSnapshot: () => { started.resolve(); return gate.promise; },
    });
    // When
    const running = runner.run(config.id, true);
    await started.promise;
    await store.deleteProvider(config.id);
    gate.resolve(result);
    await running;
    // Then
    expect(await store.getSnapshot(config.id)).toBeUndefined();
  });

  it('discards results when mappings change during the request', async () => {
    // Given
    const { store } = memory({ [CUSTOM_PROVIDERS_KEY]: [config] });
    const started = deferred<void>();
    const gate = deferred<CustomSnapshot>();
    const runner = createCustomRunner({
      store, now: () => NOW, hasOrigin: async () => true,
      fetchSnapshot: () => { started.resolve(); return gate.promise; },
    });
    // When
    const running = runner.run(config.id, true);
    await started.promise;
    await store.saveProvider({ ...config, balancePath: 'new.balance' });
    gate.resolve(result);
    await running;
    // Then
    expect(await store.getSnapshot(config.id)).toBeUndefined();
  });
});
