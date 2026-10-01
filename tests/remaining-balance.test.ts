import { describe, expect, it } from 'vitest';
import { litellmAdapter } from '../src/providers/litellm';
import { openrouterAdapter } from '../src/providers/openrouter';
import { createPoeAdapter } from '../src/providers/poe';
import { MemoryPoeLedger } from '../src/core/poe-ledger';
import { makeCtx } from './helpers';

const orKey = { data: { usage_daily: 1, usage_weekly: 2, usage_monthly: 3, limit: null, limit_remaining: null } };

describe('remaining balance: openrouter', () => {
  it('reports remaining credits from /credits', async () => {
    const ctx = makeCtx({
      provider: 'openrouter',
      providerSettings: { apiKey: 'sk-or-test' },
      routes: [
        { match: '/api/v1/credits', reply: { json: { data: { total_credits: 1420, total_usage: 1379.05 } } } },
        { match: '/api/v1/key', reply: { json: orKey } },
      ],
    });
    const snapshot = await openrouterAdapter.fetchSnapshot(ctx);
    expect(snapshot.status).toBe('ok');
    expect(snapshot.balance?.unit).toBe('usd');
    expect(snapshot.balance?.amount).toBeCloseTo(40.95, 2);
    expect(snapshot.balance?.limit).toBe(1420);
    expect(snapshot.balance?.label).toBe('남은 크레딧');
  });

  it('keeps the usage windows when /credits is not allowed for the key', async () => {
    const ctx = makeCtx({
      provider: 'openrouter',
      providerSettings: { apiKey: 'sk-or-test' },
      routes: [
        { match: '/api/v1/credits', reply: { status: 403, json: { error: { message: 'forbidden' } } } },
        { match: '/api/v1/key', reply: { json: orKey } },
      ],
    });
    const snapshot = await openrouterAdapter.fetchSnapshot(ctx);
    expect(snapshot.status).toBe('ok');
    expect(snapshot.balance).toBeUndefined();
    expect(snapshot.windows.map((w) => w.kind)).toEqual(['day', 'week', 'month']);
  });

  it('never reports a negative remaining amount', async () => {
    const ctx = makeCtx({
      provider: 'openrouter',
      providerSettings: { apiKey: 'sk-or-test' },
      routes: [
        { match: '/api/v1/credits', reply: { json: { data: { total_credits: 10, total_usage: 12 } } } },
        { match: '/api/v1/key', reply: { json: orKey } },
      ],
    });
    expect((await openrouterAdapter.fetchSnapshot(ctx)).balance?.amount).toBe(0);
  });
});

const daily = { results: [{ date: '2026-10-01', metrics: { spend: 1 }, breakdown: {} }], metadata: { has_more: false } };
function litellmCtx(keyInfo: Record<string, unknown>, userReply: { status?: number; json?: unknown }) {
  return makeCtx({
    provider: 'litellm',
    providerSettings: { baseUrl: 'https://proxy.example.com', apiKey: 'sk-test', mode: 'user' },
    routes: [
      { match: '/key/info', reply: { json: { info: { user_id: 'u1', ...keyInfo } } } },
      { match: '/user/info', reply: userReply },
      { match: '/user/daily/activity/aggregated', reply: { json: daily } },
    ],
  });
}
const userInfo = (max: number, spend: number) => ({ json: { user_info: { max_budget: max, spend, budget_reset_at: '2026-10-01T00:00:00Z' } } });

describe('remaining balance: litellm', () => {
  it('uses the user budget when the key has none', async () => {
    const snapshot = await litellmAdapter.fetchSnapshot(litellmCtx({ spend: 25.69 }, userInfo(50, 12.29)));
    expect(snapshot.status).toBe('ok');
    expect(snapshot.balance?.amount).toBeCloseTo(37.71, 2);
    expect(snapshot.balance?.limit).toBe(50);
    expect(snapshot.balance?.resetsAt).toBe('2026-10-01T00:00:00Z');
    expect(snapshot.balance?.label).toBe('남은 예산');
  });

  it('picks the tighter of the key budget and the user budget', async () => {
    const snapshot = await litellmAdapter.fetchSnapshot(litellmCtx({ spend: 5, max_budget: 30 }, userInfo(50, 12.29)));
    expect(snapshot.balance?.amount).toBeCloseTo(25, 2);
    expect(snapshot.balance?.limit).toBe(30);
  });

  it('falls back to the key budget when /user/info is denied', async () => {
    const snapshot = await litellmAdapter.fetchSnapshot(litellmCtx({ spend: 5, max_budget: 30 }, { status: 401, json: { error: 'no' } }));
    expect(snapshot.balance?.amount).toBeCloseTo(25, 2);
  });

  it('reports no balance when neither the key nor the user has a budget', async () => {
    const snapshot = await litellmAdapter.fetchSnapshot(litellmCtx({ spend: 5 }, { json: { user_info: { max_budget: null, spend: 1 } } }));
    expect(snapshot.status).toBe('ok');
    expect(snapshot.balance).toBeUndefined();
  });
});

describe('remaining balance: poe', () => {
  it('labels the point balance as remaining points', async () => {
    const adapter = createPoeAdapter(new MemoryPoeLedger());
    const ctx = makeCtx({
      provider: 'poe',
      providerSettings: { apiKey: 'poe-key' },
      routes: [
        { match: '/usage/current_balance', reply: { json: { current_point_balance: 104018 } } },
        { match: '/usage/points_history', reply: { json: { has_more: false, length: 0, data: [] } } },
      ],
    });
    const snapshot = await adapter.fetchSnapshot(ctx);
    expect(snapshot.balance).toEqual({ amount: 104018, unit: 'points', label: '남은 포인트' });
  });
});
