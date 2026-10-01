import type { ExtensionMessage } from '../src/core/store';
import { STORAGE_KEYS } from '../src/core/store';
import type { ProviderSnapshot } from '../src/providers/types';
import { buildSettings, buildSnapshots, parseScenario } from './fixtures';

type Changes = Record<string, { oldValue?: unknown; newValue?: unknown }>;
type ChangeListener = (changes: Changes, area: string) => void;

const scenario = parseScenario(window.location.search);
const listeners = new Set<ChangeListener>();

function createArea(name: 'local' | 'session', initial: Record<string, unknown>) {
  const data = new Map<string, unknown>(Object.entries(initial));
  return {
    async get(keys?: string | string[] | null): Promise<Record<string, unknown>> {
      const names = keys == null ? [...data.keys()] : Array.isArray(keys) ? keys : [keys];
      const out: Record<string, unknown> = {};
      for (const key of names) if (data.has(key)) out[key] = structuredClone(data.get(key));
      return out;
    },
    async set(items: Record<string, unknown>): Promise<void> {
      const changes: Changes = {};
      for (const [key, value] of Object.entries(items)) {
        changes[key] = { oldValue: data.get(key), newValue: value };
        data.set(key, structuredClone(value));
      }
      listeners.forEach((listener) => listener(changes, name));
    },
    async clear(): Promise<void> {
      data.clear();
      listeners.forEach((listener) => listener({}, name));
    },
  };
}

const now = new Date();
const local = createArea('local', {
  [STORAGE_KEYS.settings]: buildSettings(scenario),
  [STORAGE_KEYS.snapshots]: buildSnapshots(scenario, now),
});
const session = createArea('session', {});

async function simulateRefresh(provider?: string): Promise<void> {
  const stored = await local.get(STORAGE_KEYS.snapshots);
  const snapshots = (stored[STORAGE_KEYS.snapshots] ?? {}) as Record<string, ProviderSnapshot>;
  const at = new Date().toISOString();
  for (const [id, snapshot] of Object.entries(snapshots)) {
    if (provider && provider !== id) continue;
    snapshots[id] = snapshot.status === 'ok' ? { ...snapshot, fetchedAt: at, attemptedAt: at } : { ...snapshot, attemptedAt: at };
  }
  await local.set({ [STORAGE_KEYS.snapshots]: snapshots });
}

const mock = {
  storage: {
    local,
    session,
    onChanged: {
      addListener: (listener: ChangeListener) => listeners.add(listener),
      removeListener: (listener: ChangeListener) => listeners.delete(listener),
    },
  },
  runtime: {
    async sendMessage(message: ExtensionMessage): Promise<{ ok: boolean }> {
      if (message.type === 'refresh') window.setTimeout(() => void simulateRefresh(message.provider), 400);
      return { ok: true };
    },
    openOptionsPage(): void {
      window.open(`/dev/options.html${window.location.search}`, '_blank');
    },
  },
  permissions: {
    async request(): Promise<boolean> {
      return true;
    },
    async contains(): Promise<boolean> {
      return true;
    },
  },
};

Object.assign(globalThis, { chrome: mock });
document.documentElement.dataset.devScenario = scenario;
