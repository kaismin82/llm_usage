import { describe, expect, it } from 'vitest';
import { extractSecondaryProviders } from '../src/phone-relay/secondary';
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
});
