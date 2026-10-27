import { describe, expect, it } from 'vitest';
import { claudePlatformAdapter } from '../src/providers/claude-platform';
import { makeCtx } from './helpers';

const COST = 'https://api.anthropic.com/v1/organizations/cost_report';

function page(amounts: string[], opts: { hasMore?: boolean; nextPage?: string } = {}) {
  return {
    data: [{
      starting_at: '2026-10-01T00:00:00Z',
      ending_at: '2026-10-02T00:00:00Z',
      results: amounts.map((amount) => ({ amount, currency: 'USD' })),
    }],
    has_more: opts.hasMore ?? false,
    next_page: opts.nextPage ?? null,
  };
}

describe('claudePlatformAdapter', () => {
  it('requires an admin key before any request', async () => {
    const ctx = makeCtx({ provider: 'claude_platform', routes: [] });
    const snapshot = await claudePlatformAdapter.fetchSnapshot(ctx);
    expect(snapshot).toMatchObject({ status: 'not_configured' });
    expect(ctx.calls).toHaveLength(0);
  });

  it('sums the UTC month in cents against the configured limit', async () => {
    const ctx = makeCtx({
      provider: 'claude_platform',
      providerSettings: { apiKey: 'sk-ant-admin01-test', monthlyLimitUsd: 200 },
      routes: [{ match: COST, reply: { json: page(['10000', '5000']) } }],
    });

    const snapshot = await claudePlatformAdapter.fetchSnapshot(ctx);

    expect(ctx.calls[0].url).toContain('starting_at=2026-10-01T00:00:00.000Z');
    expect(ctx.calls[0].url).toContain('ending_at=2026-11-01T00:00:00.000Z');
    expect(ctx.calls[0].init?.headers).toMatchObject({ 'x-api-key': 'sk-ant-admin01-test', 'anthropic-version': '2023-06-01' });
    expect(ctx.calls[0].init?.credentials).toBe('omit');
    expect(snapshot.status).toBe('ok');
    const month = snapshot.windows[0];
    expect(month).toMatchObject({ kind: 'month', unit: 'usd', usedAmount: 150, limitAmount: 200, usedPercent: 75, resetsAt: '2026-11-01T00:00:00.000Z', periodTz: 'UTC' });
    expect(snapshot.balance).toMatchObject({ amount: 50, unit: 'usd', limit: 200, resetsAt: '2026-11-01T00:00:00.000Z' });
  });

  it('follows pagination and stops at the last page', async () => {
    const ctx = makeCtx({
      provider: 'claude_platform',
      providerSettings: { apiKey: 'k' },
      routes: [
        { match: /page=pg2/, reply: { json: page(['250'], {}) } },
        { match: COST, reply: { json: page(['1000'], { hasMore: true, nextPage: 'pg2' }) } },
      ],
    });

    const snapshot = await claudePlatformAdapter.fetchSnapshot(ctx);

    expect(ctx.calls).toHaveLength(2);
    expect(ctx.calls[1].url).toContain('page=pg2');
    expect(snapshot.windows[0]?.usedAmount).toBe(12.5);
  });

  it('keeps usage visible without a limit when monthlyLimitUsd is 0', async () => {
    const ctx = makeCtx({
      provider: 'claude_platform',
      providerSettings: { apiKey: 'k', monthlyLimitUsd: 0 },
      routes: [{ match: COST, reply: { json: page(['1000']) } }],
    });

    const snapshot = await claudePlatformAdapter.fetchSnapshot(ctx);

    expect(snapshot.windows[0]?.usedAmount).toBe(10);
    expect(snapshot.windows[0]?.limitAmount).toBeUndefined();
    expect(snapshot.windows[0]?.usedPercent).toBeUndefined();
    expect(snapshot.balance).toBeUndefined();
  });

  it('maps auth failures, rate limits and schema changes without inventing usage', async () => {
    const authCtx = makeCtx({
      provider: 'claude_platform',
      providerSettings: { apiKey: 'k' },
      routes: [{ match: COST, reply: { status: 401, json: { error: { type: 'authentication_error' } } } }],
    });
    expect(await claudePlatformAdapter.fetchSnapshot(authCtx)).toMatchObject({ status: 'auth_required', windows: [] });

    const limitCtx = makeCtx({
      provider: 'claude_platform',
      providerSettings: { apiKey: 'k' },
      routes: [{ match: COST, reply: { status: 429, headers: { 'retry-after': '30' } } }],
    });
    const limited = await claudePlatformAdapter.fetchSnapshot(limitCtx);
    expect(limited.status).toBe('rate_limited');
    expect(limited.error?.retryAt).toBeDefined();

    const schemaCtx = makeCtx({
      provider: 'claude_platform',
      providerSettings: { apiKey: 'k' },
      routes: [{ match: COST, reply: { json: { data: [{ results: [{ amount: '1', currency: 'EUR' }] }] } } }],
    });
    expect(await claudePlatformAdapter.fetchSnapshot(schemaCtx)).toMatchObject({ status: 'schema_changed' });
  });
});
