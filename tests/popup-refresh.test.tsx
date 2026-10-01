// @vitest-environment jsdom
import { render } from 'preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/popup/App';
import { defaultSettings } from '../src/core/settings';
import { STORAGE_KEYS } from '../src/core/store';
import type { ProviderSnapshot } from '../src/providers/types';

type Listener = (changes: Record<string, unknown>, area: string) => void;

function snapshot(attemptedAgoMs: number): ProviderSnapshot {
  const now = Date.now();
  return {
    provider: 'claude',
    status: 'auth_required',
    windows: [],
    grants: [],
    grantSupport: 'n/a',
    fetchedAt: new Date(now - 3_600_000).toISOString(),
    attemptedAt: new Date(now - attemptedAgoMs).toISOString(),
    error: { code: 'auth_required', message: 'not signed in' },
  };
}

function installChrome(initial: ProviderSnapshot) {
  const settings = defaultSettings();
  settings.providers.claude.enabled = true;
  const data: Record<string, unknown> = {
    [STORAGE_KEYS.settings]: settings,
    [STORAGE_KEYS.snapshots]: { claude: initial },
  };
  const listeners = new Set<Listener>();
  const sendMessage = vi.fn(async () => ({ ok: true }));
  Object.assign(globalThis, {
    chrome: {
      storage: {
        local: {
          get: async (key: string) => ({ [key]: structuredClone(data[key]) }),
          set: async (items: Record<string, unknown>) => {
            Object.assign(data, items);
            listeners.forEach((l) => l({}, 'local'));
          },
        },
        onChanged: {
          addListener: (l: Listener) => listeners.add(l),
          removeListener: (l: Listener) => listeners.delete(l),
        },
      },
      runtime: { sendMessage, openOptionsPage: vi.fn() },
    },
  });
  return { sendMessage, data, listeners };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 160));

describe('popup refresh-on-open', () => {
  let root: HTMLElement;
  beforeEach(() => {
    root = document.createElement('div');
    document.body.appendChild(root);
  });
  afterEach(() => {
    render(null, root);
    root.remove();
  });

  it('requests one refresh for a provider whose last attempt is old, and does not loop on store changes', async () => {
    const env = installChrome(snapshot(120_000));
    render(<App />, root);
    await flush();
    expect(env.sendMessage).toHaveBeenCalledTimes(1);
    expect(env.sendMessage).toHaveBeenCalledWith({ type: 'refresh', provider: 'claude' });

    for (let i = 0; i < 5; i += 1) {
      env.data[STORAGE_KEYS.snapshots] = { claude: snapshot(0) };
      env.listeners.forEach((l) => l({}, 'local'));
      await flush();
    }
    expect(env.sendMessage).toHaveBeenCalledTimes(1);
  });

  it('does not refresh when the last attempt was recent even though the last success is old', async () => {
    const env = installChrome(snapshot(5_000));
    render(<App />, root);
    await flush();
    expect(env.sendMessage).not.toHaveBeenCalled();
  });
});
