import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSecondaryPoller, extractSecondaryProviders } from '../src/phone-relay/secondary';
import type { PhonePayload } from '../src/phone-relay/payload';

type PhoneProvider = PhonePayload['providers'][number];

function provider(overrides: Partial<PhoneProvider>): PhoneProvider {
  return Object.assign({
    id: 'claude', name: 'Claude', status: 'ok',
    fetchedAt: '2026-10-27T10:00:00Z', attemptedAt: '2026-10-27T10:00:00Z',
    windows: [{ kind: 'session_5h', label: '5시간', unit: 'percent', usedPercent: 42 }],
    grants: [], grantSupport: 'n/a',
  }, overrides);
}

describe('extractSecondaryProviders', () => {
  it('maps relay-labeled entries back into snapshot-shaped values keyed by label', () => {
    const extracted = extractSecondaryProviders([
      provider({ id: 'claude', name: 'Claude' }),
      provider({ id: 'claude#sub2', name: 'Claude · sub2', grants: [{ scope: 'weekly_7d', status: 'available', remaining: 2 }] }),
    ]);

    expect(Object.keys(extracted)).toEqual(['sub2']);
    const snapshot = extracted['sub2'];
    expect(snapshot).toMatchObject({ provider: 'claude', status: 'ok', fetchedAt: '2026-10-27T10:00:00Z' });
    expect(snapshot.windows[0]).toMatchObject({ kind: 'session_5h', usedPercent: 42 });
    expect(snapshot.grants[0]).toMatchObject({ provider: 'claude', scope: 'weekly_7d', remaining: 2 });
    expect(snapshot.grants[0].idHash).toContain('claude#sub2');
  });

  it('keeps main-slot and malformed entries out of the secondary map', () => {
    const extracted = extractSecondaryProviders([
      provider({ id: 'chatgpt' }),
      provider({ id: 'claude#', name: 'broken' }),
      provider({ id: '#sub2', name: 'broken' }),
    ]);
    expect(extracted).toEqual({});
  });

  it('uses the subscription entry, never claude_platform, when a labeled slot carries both', () => {
    const platform = provider({
      id: 'claude_platform#sub2', name: 'Claude Platform (API) · sub2',
      windows: [{ kind: 'month', label: '이번달', unit: 'usd', usedAmount: 18.09, limitAmount: 200 }],
    });
    const subscription = provider({ id: 'claude#sub2', name: 'Claude · sub2' });
    for (const order of [[platform, subscription], [subscription, platform]]) {
      const extracted = extractSecondaryProviders(order);
      expect(Object.keys(extracted)).toEqual(['sub2']);
      expect(extracted['sub2'].windows).toHaveLength(1);
      expect(extracted['sub2'].windows[0]).toMatchObject({ kind: 'session_5h', usedPercent: 42 });
    }
  });

  afterEach(() => vi.unstubAllGlobals());

  it('polls the reader and saves only the secondary Claude subscription from a real-shaped merged response', async () => {
    vi.stubGlobal('chrome', { storage: { local: { get: async () => ({}) } } });
    const at = '2026-10-28T02:09:26.190Z';
    const merged = { receivedAt: at, data: { version: 1, sentAt: at, providers: [
      provider({ id: 'claude', name: 'Claude' }),
      provider({
        id: 'claude#sub2', name: 'Claude · sub2',
        windows: [
          { kind: 'session_5h', label: '5시간', unit: 'percent', usedPercent: 89 },
          { kind: 'weekly_7d', label: '7일', unit: 'percent', usedPercent: 65 },
          { kind: 'month', label: 'Extra usage', unit: 'usd', usedPercent: 100, usedAmount: 115.05, limitAmount: 115 },
        ],
      }),
      provider({
        id: 'openrouter#sub2', name: 'OpenRouter · sub2',
        windows: [{ kind: 'month', label: '이번달', unit: 'usd', usedAmount: 6.865505865, periodTz: 'UTC' }],
        balance: { amount: 34.07, unit: 'usd', limit: 1420, label: '남은 크레딧' },
      }),
    ] } };
    const saved: Array<Record<string, { windows: Array<{ kind: string }> }>> = [];
    const poller = createSecondaryPoller({
      getConfig: async () => ({ enabled: true, readToken: 'r'.repeat(40) }),
      hasPermission: async () => true,
      fetchImpl: async () => new Response(JSON.stringify(merged), { status: 200 }),
      save: async (snapshots) => { saved.push(snapshots as never); },
      now: () => new Date(at),
    });

    await poller.poll();

    expect(saved).toHaveLength(1);
    expect(Object.keys(saved[0])).toEqual(['sub2']);
    expect(saved[0]['sub2'].windows.map((window) => window.kind)).toEqual(['session_5h', 'weekly_7d', 'month']);
  });
});
