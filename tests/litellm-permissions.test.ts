import { describe, expect, it } from 'vitest';
import { litellmAdapter } from '../src/providers/litellm';
import { makeCtx } from './helpers';

const BASE = 'https://proxy.example.com:65000';
const keyInfo = {
  key: 'hashed',
  info: { spend: 12.5, max_budget: 100, budget_duration: '30d', budget_reset_at: '2026-10-20T00:00:00Z', user_id: 'u1', key_alias: 'team-key' },
};
const adminOnly = {
  error: { message: 'Authentication Error, Only proxy admin can be used. Route=/user/daily/activity/aggregated. Your role=internal_user', type: 'auth_error', code: '401' },
};
const paginated = {
  results: [
    { date: '2026-10-01', metrics: { spend: 1 }, breakdown: {} },
    { date: '2026-09-30', metrics: { spend: 2 }, breakdown: {} },
    { date: '2026-09-28', metrics: { spend: 3 }, breakdown: {} },
  ],
  metadata: { page: 1, total_pages: 1, has_more: false },
};

function ctxFor(routes: Parameters<typeof makeCtx>[0]['routes'], mode: 'user' | 'admin' = 'user') {
  return makeCtx({ provider: 'litellm', providerSettings: { baseUrl: BASE + '/v1', apiKey: 'sk-test', mode }, routes });
}

describe('litellm internal_user permissions (real-server behaviour)', () => {
  it('falls back to the paginated endpoint when the aggregated route answers 401', async () => {
    const ctx = ctxFor([
      { match: '/key/info', reply: { json: keyInfo } },
      { match: '/user/daily/activity/aggregated', reply: { status: 401, json: adminOnly } },
      { match: '/user/daily/activity?', reply: { json: paginated } },
    ]);
    const snapshot = await litellmAdapter.fetchSnapshot(ctx);
    expect(snapshot.status).toBe('ok');
    expect(snapshot.error).toBeUndefined();
    const by = Object.fromEntries(snapshot.windows.map((w) => [w.kind, w.usedAmount]));
    expect(by).toMatchObject({ day: 1, week: 6, month: 1, budget: 12.5 });
    expect(ctx.calls.some((c) => c.url.includes('/user/daily/activity?') && c.url.includes('page_size=1000'))).toBe(true);
  });

  it('keeps the budget window as a partial result when both daily routes are denied for a verified key', async () => {
    const ctx = ctxFor([
      { match: '/key/info', reply: { json: keyInfo } },
      { match: '/user/daily/activity', reply: { status: 401, json: adminOnly } },
    ]);
    const snapshot = await litellmAdapter.fetchSnapshot(ctx);
    expect(snapshot.status).toBe('ok');
    expect(snapshot.error?.code).toBe('partial');
    expect(snapshot.windows.map((w) => w.kind)).toEqual(['budget']);
  });

  it('keeps the budget window when the aggregated route is denied and the paginated route is missing', async () => {
    const ctx = ctxFor([
      { match: '/key/info', reply: { json: keyInfo } },
      { match: '/user/daily/activity/aggregated', reply: { status: 403, json: adminOnly } },
    ]);
    const snapshot = await litellmAdapter.fetchSnapshot(ctx);
    expect(snapshot.status).toBe('ok');
    expect(snapshot.error?.code).toBe('partial');
    expect(snapshot.windows.map((w) => w.kind)).toEqual(['budget']);
  });

  it('still reports auth_required when /key/info itself is rejected', async () => {
    const ctx = ctxFor([{ match: '/key/info', reply: { status: 401, json: { error: { message: 'bad key' } } } }]);
    const snapshot = await litellmAdapter.fetchSnapshot(ctx);
    expect(snapshot.status).toBe('auth_required');
  });

  it('treats a 401 on both daily routes as an auth failure in admin mode', async () => {
    const ctx = ctxFor([{ match: '/user/daily/activity', reply: { status: 401, json: adminOnly } }], 'admin');
    const snapshot = await litellmAdapter.fetchSnapshot(ctx);
    expect(snapshot.status).toBe('auth_required');
  });
});
