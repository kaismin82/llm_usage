// @vitest-environment jsdom
import { render } from 'preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/options/App';
import { defaultSettings } from '../src/core/settings';
import { STORAGE_KEYS } from '../src/core/store';
import type { ExtensionMessage } from '../src/core/store';
import type { ProviderSnapshot } from '../src/providers/types';

type Listener = (changes: Record<string, unknown>, area: string) => void;

function okSnapshot(attemptedAt: number): ProviderSnapshot {
  const at = new Date(attemptedAt).toISOString();
  return {
    provider: 'claude',
    status: 'ok',
    windows: [{ kind: 'session_5h', label: '5시간', unit: 'percent', usedPercent: 10 }],
    grants: [],
    grantSupport: 'n/a',
    fetchedAt: at,
    attemptedAt: at,
  };
}

function install(onRefresh: (write: () => void) => void) {
  const settings = defaultSettings();
  settings.providers.claude.enabled = true;
  const data: Record<string, unknown> = {
    [STORAGE_KEYS.settings]: settings,
    [STORAGE_KEYS.snapshots]: {},
  };
  const listeners = new Set<Listener>();
  const notify = () => listeners.forEach((l) => l({}, 'local'));
  const write = () => {
    data[STORAGE_KEYS.snapshots] = { claude: okSnapshot(Date.now() + 5) };
    notify();
  };
  Object.assign(globalThis, {
    chrome: {
      storage: {
        local: {
          get: async (key: string) => ({ [key]: structuredClone(data[key]) }),
          set: async (items: Record<string, unknown>) => {
            Object.assign(data, structuredClone(items));
            notify();
          },
          clear: async () => {},
        },
        session: { clear: async () => {} },
        onChanged: {
          addListener: (l: Listener) => listeners.add(l),
          removeListener: (l: Listener) => listeners.delete(l),
        },
      },
      runtime: {
        sendMessage: vi.fn(async (message: ExtensionMessage) => {
          if (message.type === 'refresh') onRefresh(write);
          return { ok: true };
        }),
        openOptionsPage: vi.fn(),
      },
      permissions: { request: async () => true, contains: async () => true },
    },
  });
  return { data, notify };
}

async function waitFor(condition: () => boolean, ms = 4000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('timed out waiting for condition');
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

const button = (text: string) =>
  [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === text) as HTMLButtonElement | undefined;
const intervalInput = () => document.querySelector('input[type="number"]') as HTMLInputElement;
function edit(input: HTMLInputElement, value: string) {
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

describe('options page save and connection test', () => {
  let root: HTMLElement;
  beforeEach(() => {
    root = document.createElement('div');
    document.body.appendChild(root);
  });
  afterEach(() => {
    render(null, root);
    root.remove();
  });

  it('does not overwrite unsaved edits when the store changes', async () => {
    const env = install(() => {});
    render(<App />, root);
    await waitFor(() => intervalInput() !== null && button('저장') !== undefined);
    edit(intervalInput(), '7');
    await waitFor(() => button('저장')?.disabled === false);
    env.notify();
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(intervalInput().value).toBe('7');
  });

  it('reports the result even when the background answers before the page listens', async () => {
    install((write) => write());
    render(<App />, root);
    await waitFor(() => button('연결 테스트')?.disabled === false);
    button('연결 테스트')!.click();
    await waitFor(() => document.body.textContent?.includes('창 1개') === true);
    expect(document.body.textContent).not.toContain('시간 초과');
  });

  it('keeps the save button usable for edits made while a test is running', async () => {
    install((write) => {
      setTimeout(write, 150);
    });
    render(<App />, root);
    await waitFor(() => button('연결 테스트')?.disabled === false);
    button('연결 테스트')!.click();
    await new Promise((resolve) => setTimeout(resolve, 30));
    edit(intervalInput(), '9');
    await waitFor(() => document.body.textContent?.includes('창 1개') === true);
    expect(button('저장')?.disabled).toBe(false);
  });
});
