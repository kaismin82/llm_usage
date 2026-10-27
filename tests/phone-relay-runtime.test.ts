import { afterEach, describe, expect, it, vi } from 'vitest';
import { defaultSettings } from '../src/core/settings';
import { baseSnapshot } from '../src/providers/util';
import { registerPhoneRelay } from '../src/phone-relay/runtime';
import { RELAY_ALARM, RELAY_CONFIG_KEY, RELAY_STATUS_KEY } from '../src/phone-relay/store';

type Changes = Record<string, chrome.storage.StorageChange>;
const NOW = new Date('2026-10-25T12:00:00Z');

function install() {
  const settings = defaultSettings();
  settings.providers.chatgpt.enabled = true;
  const data: Record<string, unknown> = {
    settings, snapshots: { chatgpt: baseSnapshot('chatgpt', NOW) },
    schedule: { chatgpt: { nextDueAt: null, failures: 2 } },
  };
  const changes: ((changes: Changes, area: string) => void)[] = [];
  const alarms: ((alarm: { name: string }) => void)[] = [];
  const messages: Parameters<typeof chrome.runtime.onMessage.addListener>[0][] = [];
  const statusListeners = new Set<() => void>();
  const clears = new Set<() => void>();
  const event = () => ({ addListener: vi.fn() });
  const wire = vi.fn<typeof fetch>(async () => new Response(null, { status: 204 }));
  const storage = {
    get: async (key: string) => ({ [key]: structuredClone(data[key]) }),
    set: async (items: Record<string, unknown>) => {
      const update = Object.fromEntries(Object.entries(items).map(([key, newValue]) => [key, { oldValue: data[key], newValue }]));
      Object.assign(data, structuredClone(items));
      changes.forEach((listener) => listener(update, 'local'));
      if (RELAY_STATUS_KEY in items) statusListeners.forEach((listener) => listener());
    },
  };
  const create = vi.fn(async () => undefined);
  const getAlarm = vi.fn<(name: string) => Promise<chrome.alarms.Alarm | undefined>>(async () => undefined);
  const clear = vi.fn(async () => { clears.forEach((listener) => listener()); return true; });
  vi.stubGlobal('fetch', wire);
  vi.stubGlobal('chrome', {
    storage: { local: storage, onChanged: { addListener: (listener: typeof changes[number]) => changes.push(listener) } },
    alarms: { get: getAlarm, create, clear, onAlarm: { addListener: (listener: typeof alarms[number]) => alarms.push(listener) } },
    runtime: {
      onMessage: { addListener: (listener: typeof messages[number]) => messages.push(listener) },
      onInstalled: event(), onStartup: event(),
    },
    permissions: { contains: async () => true },
  });
  const nextEvent = (listeners: Set<() => void>) => new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => { listeners.delete(done); reject(new Error('Missing relay event')); }, 1000);
    const done = () => { clearTimeout(timeout); listeners.delete(done); resolve(); };
    listeners.add(done);
  });
  return {
    data, settings, wire, storage, getAlarm, create, clear, alarms, messages,
    nextStatus: () => nextEvent(statusListeners), nextClear: () => nextEvent(clears),
    dispatch: (message: unknown) => new Promise<unknown>((resolve) => {
      messages.forEach((handler) => handler(message, {}, resolve));
    }),
  };
}

describe('phone relay runtime isolation', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('observes only snapshot/config changes and a separate heartbeat without touching collection state', async () => {
    const env = install();
    const original = structuredClone({ settings: env.settings, schedule: env.data.schedule });
    const cleared = env.nextClear();
    registerPhoneRelay();
    await cleared;
    await env.dispatch({ type: 'phone-relay-send' });
    expect(env.wire).not.toHaveBeenCalled();
    expect(env.create).not.toHaveBeenCalled();

    let status = env.nextStatus();
    await env.storage.set({ [RELAY_CONFIG_KEY]: { enabled: true, writeToken: 'dedicated-token' } });
    await status;
    expect(env.create).toHaveBeenCalledWith(RELAY_ALARM, { periodInMinutes: 1 });
    expect(env.wire).toHaveBeenCalledTimes(1);
    expect(JSON.parse(env.wire.mock.calls[0][1]!.body as string).providers).toHaveLength(1);

    status = env.nextStatus();
    env.alarms.forEach((listener) => listener({ name: RELAY_ALARM }));
    await status;
    expect(env.wire).toHaveBeenCalledTimes(2);

    status = env.nextStatus();
    const updated = structuredClone(original.settings);
    updated.providers.chatgpt.enabled = false;
    await env.storage.set({ settings: updated });
    await status;
    expect(JSON.parse(env.wire.mock.calls[2][1]!.body as string).providers).toEqual([]);
    expect(env.data.schedule).toEqual(original.schedule);
    expect(env.data.settings).toEqual(updated);

    const disabled = env.nextClear();
    await env.storage.set({ [RELAY_CONFIG_KEY]: { enabled: false, writeToken: 'dedicated-token' } });
    await disabled;
    await env.dispatch({ type: 'phone-relay-send' });
    expect(env.wire).toHaveBeenCalledTimes(3);
    expect(env.data.snapshots).toEqual({ chatgpt: baseSnapshot('chatgpt', NOW) });
  });

  it('sends an already enabled configuration on worker activation without invoking provider requests', async () => {
    const env = install();
    env.data[RELAY_CONFIG_KEY] = { enabled: true, writeToken: 'dedicated-token' };
    env.getAlarm.mockResolvedValue({ name: RELAY_ALARM, scheduledTime: NOW.getTime() + 60000, periodInMinutes: 1 });
    const status = env.nextStatus();
    registerPhoneRelay();
    await status;
    expect(env.wire).toHaveBeenCalledOnce();
    expect(env.wire.mock.calls[0][0]).toBe('http://127.0.0.1:8770/api/ingest');
    expect(env.create).not.toHaveBeenCalled();
  });
});
