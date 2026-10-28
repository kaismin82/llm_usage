// @vitest-environment jsdom
import { render } from 'preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/popup/App';
import { defaultSettings } from '../src/core/settings';
import { STORAGE_KEYS } from '../src/core/store';
import type { PhonePayload } from '../src/phone-relay/payload';
import { extractSecondaryProviders } from '../src/phone-relay/secondary';
import { SECONDARY_SNAPSHOTS_KEY, saveSecondarySnapshots } from '../src/phone-relay/store';
import type { ProviderSnapshot } from '../src/providers/types';
import { onDom } from './custom-ui-helpers';

type Listener = (changes: Record<string, unknown>, area: string) => void;
type PhoneProvider = PhonePayload['providers'][number];

const NOW = '2026-10-28T02:09:26.190Z';

// Anonymized shapes of the relay's merged snapshot: the sub2 slot's Claude subscription
// plus entries from the same slot that must never become the secondary card.
const sub2Claude: PhoneProvider = {
  id: 'claude#sub2', name: 'Claude · sub2', status: 'ok', fetchedAt: NOW, attemptedAt: NOW,
  windows: [
    { kind: 'session_5h', label: '5시간', unit: 'percent', usedPercent: 89 },
    { kind: 'weekly_7d', label: '7일', unit: 'percent', usedPercent: 65 },
    { kind: 'month', label: 'Extra usage', unit: 'usd', usedPercent: 100, usedAmount: 115.05, limitAmount: 115 },
  ],
  grants: [], extraCredits: { unit: 'usd', isEnabled: true },
};
const sub2OpenRouter: PhoneProvider = {
  id: 'openrouter#sub2', name: 'OpenRouter · sub2', status: 'ok', fetchedAt: NOW, attemptedAt: NOW,
  windows: [
    { kind: 'day', label: '오늘', unit: 'usd', usedAmount: 0.00000768, periodTz: 'UTC' },
    { kind: 'week', label: '이번주', unit: 'usd', usedAmount: 0.000707156, periodTz: 'UTC' },
    { kind: 'month', label: '이번달', unit: 'usd', usedAmount: 6.865505865, periodTz: 'UTC' },
  ],
  grants: [], balance: { amount: 34.07, unit: 'usd', limit: 1420, label: '남은 크레딧' },
};

function mainClaude(): ProviderSnapshot {
  return {
    provider: 'claude', status: 'ok', windows: [{ kind: 'session_5h', label: '5시간', unit: 'percent', usedPercent: 10 }],
    grants: [], grantSupport: 'n/a', fetchedAt: new Date().toISOString(), attemptedAt: new Date().toISOString(),
  };
}

function installChrome() {
  const settings = defaultSettings();
  settings.providers.claude.enabled = true;
  const data: Record<string, unknown> = {
    [STORAGE_KEYS.settings]: settings,
    [STORAGE_KEYS.snapshots]: { claude: mainClaude() },
  };
  const listeners = new Set<Listener>();
  Object.assign(globalThis, {
    chrome: {
      storage: {
        local: {
          get: async (key: string) => ({ [key]: structuredClone(data[key]) }),
          set: async (items: Record<string, unknown>) => {
            Object.assign(data, structuredClone(items));
            listeners.forEach((listener) => listener({}, 'local'));
          },
        },
        onChanged: {
          addListener: (listener: Listener) => listeners.add(listener),
          removeListener: (listener: Listener) => listeners.delete(listener),
        },
      },
      runtime: { sendMessage: vi.fn(async () => ({ ok: true })), openOptionsPage: vi.fn() },
    },
  });
  return { data };
}

describe('popup secondary Claude card', () => {
  let root: HTMLElement;
  beforeEach(() => {
    root = document.createElement('div');
    document.body.appendChild(root);
  });
  afterEach(() => {
    render(null, root);
    root.remove();
    vi.unstubAllGlobals();
  });

  const cardNames = () => [...root.querySelectorAll('.card .name')].map((node) => node.textContent);

  it('shows the 5-hour and 7-day bars of the secondary subscription, not other providers in the slot', async () => {
    installChrome();
    // Order matches the relay's merged output: the Claude entry is followed by other providers of the same slot.
    await saveSecondarySnapshots(extractSecondaryProviders([sub2Claude, sub2OpenRouter]));
    const ready = onDom(root, () => cardNames().includes('Claude · sub2'));
    render(<App />, root);
    await ready;

    const card = [...root.querySelectorAll('.card')].find((node) => node.querySelector('.name')?.textContent === 'Claude · sub2')!;
    expect([...card.querySelectorAll('.win-label')].map((node) => node.textContent)).toEqual(['5시간', '7일']);
    expect(card.querySelectorAll('[role="progressbar"]').length).toBeGreaterThanOrEqual(2);
    expect(card.textContent).toContain('$115.05');
    expect(card.textContent).not.toContain('6.87');
  });

  it('ignores a secondary snapshot stored by an older version instead of rendering it', async () => {
    const env = installChrome();
    // Pre-v0.2.6 storage format: a bare label -> snapshot record produced by the old "last entry wins" mapping.
    env.data[SECONDARY_SNAPSHOTS_KEY] = {
      sub2: {
        provider: 'claude', status: 'ok', fetchedAt: NOW, attemptedAt: NOW, grants: [], grantSupport: 'n/a',
        windows: sub2OpenRouter.windows, balance: sub2OpenRouter.balance,
      },
    };
    const ready = onDom(root, () => cardNames().includes('Claude'));
    render(<App />, root);
    await ready;

    expect(cardNames()).not.toContain('Claude · sub2');
    expect(root.textContent).not.toContain('6.87');
  });
});
