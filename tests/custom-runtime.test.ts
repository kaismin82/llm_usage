import { afterEach, describe, expect, it, vi } from 'vitest';
import { defaultSettings } from '../src/core/settings';
import { CUSTOM_PROVIDERS_KEY, customSnapshotKey } from '../src/custom/store';
import { customConfig } from './custom-ui-helpers';

function installWorker() {
  const data: Record<string, unknown> = {
    settings: defaultSettings(), snapshots: { claude: { marker: 'unchanged' } },
    [CUSTOM_PROVIDERS_KEY]: [customConfig],
  };
  const reads: string[] = [];
  const handlers: Parameters<typeof chrome.runtime.onMessage.addListener>[0][] = [];
  const wire = vi.fn(async () => new Response(JSON.stringify({ usage: { used: 12, limit: 100 }, credits: 4 })));
  const event = () => ({ addListener: vi.fn() });
  vi.stubGlobal('fetch', wire);
  vi.stubGlobal('chrome', {
    storage: { local: {
      get: async (key: string) => { reads.push(key); return { [key]: structuredClone(data[key]) }; },
      set: async (items: Record<string, unknown>) => { Object.assign(data, structuredClone(items)); },
      remove: async (key: string) => { delete data[key]; },
    } },
    runtime: {
      onMessage: { addListener: (handler: Parameters<typeof chrome.runtime.onMessage.addListener>[0]) => handlers.push(handler) },
      onInstalled: event(), onStartup: event(),
    },
    alarms: { onAlarm: event() },
    tabs: { onUpdated: event() },
    permissions: { contains: async () => true, onAdded: event() },
    action: { setBadgeText: vi.fn(async () => undefined) },
  });
  const dispatch = (message: unknown) => new Promise<unknown>((resolve) => {
    for (const handler of handlers) handler(message, {}, resolve);
  });
  return { data, reads, wire, dispatch };
}

describe('custom background message isolation', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

  it('handles custom refresh without invoking the built-in settings-change path', async () => {
    // Given
    const env = installWorker();
    const original = structuredClone({ settings: env.data.settings, snapshots: env.data.snapshots });
    await import('../src/background/index');
    // When
    const reply = await env.dispatch({ type: 'custom-refresh', id: customConfig.id });
    // Then
    expect(reply).toEqual({ ok: true });
    expect(env.wire).toHaveBeenCalledTimes(1);
    expect(env.reads).not.toContain('settings');
    expect(env.data.settings).toEqual(original.settings);
    expect(env.data.snapshots).toEqual(original.snapshots);
    expect(env.data[customSnapshotKey(customConfig.id)]).toMatchObject({ status: 'ok', balance: { amount: 4 } });
  });

  it('does not add custom requests to the existing built-in refresh message', async () => {
    // Given
    const env = installWorker();
    await import('../src/background/index');
    // When
    const reply = await env.dispatch({ type: 'refresh' });
    // Then
    expect(reply).toEqual({ ok: true });
    expect(env.wire).not.toHaveBeenCalled();
    expect(env.data[customSnapshotKey(customConfig.id)]).toBeUndefined();
  });
});
