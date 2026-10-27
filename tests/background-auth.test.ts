import { afterEach, describe, expect, it, vi } from 'vitest';
import { defaultSettings } from '../src/core/settings';
import { baseSnapshot } from '../src/providers/util';

const NOW = new Date('2026-10-01T12:00:00.000Z');

function installWorker(status: 'ok' | 'auth_required') {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  const settings = defaultSettings();
  settings.providers.claude = {
    ...settings.providers.claude, enabled: true, orgId: '00000000-0000-0000-0000-000000000001',
  };
  const data: Record<string, unknown> = {
    settings,
    snapshots: { claude: { ...baseSnapshot('claude', NOW), status } },
    schedule: { claude: { nextDueAt: null, failures: 1 } },
  };
  const completions = new Set<() => void>();
  const tabHandlers: ((id: number, change: { status?: string }, tab: { url?: string }) => void)[] = [];
  const alarmHandlers: ((alarm: { name: string }) => void)[] = [];
  const event = () => ({ addListener: vi.fn() });
  const wire = vi.fn<typeof fetch>().mockImplementation(async () =>
    new Response(JSON.stringify({ five_hour: { utilization: 12, resets_at: null } })),
  );
  vi.stubGlobal('fetch', wire);
  vi.stubGlobal('chrome', {
    storage: {
      onChanged: event(),
      local: {
        get: async (key: string) => ({ [key]: structuredClone(data[key]) }),
        set: async (items: Record<string, unknown>) => {
          Object.assign(data, structuredClone(items));
        },
      },
      session: { get: async () => ({}), set: vi.fn(async () => undefined) },
    },
    runtime: { onMessage: event(), onInstalled: event(), onStartup: event() },
    alarms: { onAlarm: { addListener: (handler: typeof alarmHandlers[number]) => alarmHandlers.push(handler) }, create: vi.fn() },
    tabs: {
      onUpdated: { addListener: (handler: typeof tabHandlers[number]) => tabHandlers.push(handler) },
      query: async () => [{ id: 42 }],
    },
    scripting: {
      executeScript: async (injection: { func: (...args: never[]) => unknown; args: unknown[] }) => [
        { result: await injection.func(...(injection.args as never[])) },
      ],
    },
    idle: { queryState: async () => 'active', setDetectionInterval: vi.fn(), onStateChanged: event() },
    permissions: { contains: async () => true, onAdded: event() },
    action: {
      setBadgeText: vi.fn(),
      setBadgeBackgroundColor: vi.fn(() => completions.forEach((listener) => listener())),
    },
  });
  const nextPresentation = () => new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      completions.delete(listener);
      reject(new Error('No auth recovery snapshot was saved'));
    }, 1000);
    const listener = () => {
      clearTimeout(timeout);
      completions.delete(listener);
      resolve();
    };
    completions.add(listener);
  });
  return { data, wire, nextPresentation, tabHandlers, alarmHandlers };
}

describe('session authentication recovery in the worker', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); vi.restoreAllMocks(); vi.resetModules(); });

  it('recovers a legacy paused Claude auth state on the next tick', async () => {
    // Given
    const env = installWorker('auth_required');
    await import('../src/background/index');
    const saved = env.nextPresentation();

    // When
    env.alarmHandlers.forEach((handler) => handler({ name: 'tick' }));
    await saved;

    // Then
    expect(env.data.snapshots).toMatchObject({ claude: { status: 'ok', windows: [{ usedPercent: 12 }] } });
    expect(env.wire).toHaveBeenCalledOnce();
  });

  it('does not let a healthy tab completion suppress a later login recovery', async () => {
    // Given
    const env = installWorker('ok');
    await import('../src/background/index');
    env.tabHandlers.forEach((handler) => handler(42, { status: 'complete' }, { url: 'https://claude.ai/new' }));
    env.data.snapshots = { claude: { ...baseSnapshot('claude', NOW), status: 'auth_required' } };
    const saved = env.nextPresentation();

    // When
    env.tabHandlers.forEach((handler) => handler(42, { status: 'complete' }, { url: 'https://claude.ai/new' }));
    await saved;

    // Then
    expect(env.data.snapshots).toMatchObject({ claude: { status: 'ok' } });
    expect(env.wire).toHaveBeenCalledOnce();
  });
});
