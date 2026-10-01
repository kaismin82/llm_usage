import { describe, expect, it } from 'vitest';
import { MemoryPoeLedger } from '../src/core/poe-ledger';
import { createPoeAdapter } from '../src/providers/poe';
import { makeCtx } from './helpers';

const now = new Date('2026-10-01T12:00:00Z');

function historyEntry(overrides: Partial<Record<'bot_name' | 'creation_time' | 'query_id' | 'cost_points' | 'usage_type', unknown>> = {}): Record<string, unknown> {
  return {
    bot_name: 'Assistant',
    creation_time: now.getTime() * 1000,
    query_id: 'query-1',
    cost_points: 12,
    usage_type: 'Chat',
    ...overrides,
  };
}

describe('Poe adapter', () => {
  it('fetches the balance, syncs history, and builds local calendar windows', async () => {
    const ledger = new MemoryPoeLedger();
    const ctx = makeCtx({
      provider: 'poe',
      now,
      providerSettings: { apiKey: 'poe-key' },
      routes: [
        { match: '/usage/current_balance', reply: { json: { current_point_balance: 1500 } } },
        { match: '/usage/points_history', reply: { json: { has_more: false, length: 2, data: [
          historyEntry(),
          historyEntry({ query_id: 'query-2', cost_points: 8, usage_type: 'API' }),
        ] } } },
      ],
    });

    const snapshot = await createPoeAdapter(ledger).fetchSnapshot(ctx);

    expect(snapshot.status).toBe('ok');
    expect(snapshot.balance).toEqual({ amount: 1500, unit: 'points', label: '남은 포인트' });
    expect(snapshot.windows).toEqual([
      expect.objectContaining({ kind: 'day', label: '오늘', usedAmount: 20, unit: 'points', periodTz: 'local' }),
      expect.objectContaining({ kind: 'week', label: '이번주', usedAmount: 20, unit: 'points', periodTz: 'local' }),
      expect.objectContaining({ kind: 'month', label: '이번달', usedAmount: 20, unit: 'points', periodTz: 'local' }),
    ]);
    expect(ctx.calls).toEqual([
      expect.objectContaining({
        url: 'https://api.poe.com/usage/current_balance',
        init: { headers: { Authorization: 'Bearer poe-key', Accept: 'application/json' }, credentials: 'omit' },
      }),
      expect.objectContaining({
        url: 'https://api.poe.com/usage/points_history?limit=100',
        init: { headers: { Authorization: 'Bearer poe-key', Accept: 'application/json' }, credentials: 'omit' },
      }),
    ]);
  });

  it('filters ledger windows by usage type and marks incomplete coverage', async () => {
    const ledger = new MemoryPoeLedger();
    await ledger.putMany([
      { queryId: 'chat', time: now.getTime(), points: 4, usageType: 'Chat', bot: 'bot' },
      { queryId: 'canvas', time: now.getTime(), points: 5, usageType: 'Canvas App', bot: 'bot' },
      { queryId: 'api', time: now.getTime(), points: 6, usageType: 'API', bot: 'bot' },
    ]);
    await ledger.setMeta({ coverageStart: now.getTime() });
    const ctx = makeCtx({
      provider: 'poe',
      now,
      providerSettings: { apiKey: 'poe-key', usageTypeFilter: 'chat' },
      routes: [
        { match: '/usage/current_balance', reply: { json: { current_point_balance: 1 } } },
        { match: '/usage/points_history', reply: { status: 500 } },
      ],
    });

    const snapshot = await createPoeAdapter(ledger).fetchSnapshot(ctx);

    expect(snapshot.status).toBe('ok');
    expect(snapshot.windows.map((window) => window.usedAmount)).toEqual([9, 9, 9]);
    expect(snapshot.windows.every((window) => window.partial)).toBe(true);
  });

  it('returns auth_required for a 401 balance response', async () => {
    const ctx = makeCtx({
      provider: 'poe',
      providerSettings: { apiKey: 'poe-key' },
      routes: [{ match: '/usage/current_balance', reply: { status: 401 } }],
    });

    expect((await createPoeAdapter(new MemoryPoeLedger()).fetchSnapshot(ctx)).status).toBe('auth_required');
  });

  it('returns challenge for a Cloudflare challenge response', async () => {
    const ctx = makeCtx({
      provider: 'poe',
      providerSettings: { apiKey: 'poe-key' },
      routes: [{ match: '/usage/current_balance', reply: { status: 403, challenge: true } }],
    });

    expect((await createPoeAdapter(new MemoryPoeLedger()).fetchSnapshot(ctx)).status).toBe('challenge');
  });

  it.each([
    { current_point_balance: null },
    {},
  ])('returns schema_changed for malformed balance bodies', async (body) => {
    const ctx = makeCtx({
      provider: 'poe',
      providerSettings: { apiKey: 'poe-key' },
      routes: [{ match: '/usage/current_balance', reply: { json: body } }],
    });

    expect((await createPoeAdapter(new MemoryPoeLedger()).fetchSnapshot(ctx)).status).toBe('schema_changed');
  });

  it('returns not_configured without an API key', async () => {
    const ctx = makeCtx({ provider: 'poe', routes: [] });

    expect((await createPoeAdapter(new MemoryPoeLedger()).fetchSnapshot(ctx)).status).toBe('not_configured');
    expect(ctx.calls).toEqual([]);
  });
});
