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

  describe('confirmed cost plus an estimate for the span the cost report has not reached', () => {
    const NOW = new Date('2026-10-28T04:37:54Z');
    const USAGE = 'https://api.anthropic.com/v1/organizations/usage_report/messages';
    const costThrough = (endingAt: string, amount = '2362') => ({
      data: [{ starting_at: '2026-10-27T00:00:00Z', ending_at: endingAt, results: [{ amount, currency: 'USD' }] }],
      has_more: false, next_page: null,
    });
    const row = (extra: Record<string, unknown> = {}) => ({
      model: 'claude-sonnet-5-5', service_tier: 'standard', speed: 'standard', inference_geo: 'global',
      uncached_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 0,
      cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 0 }, server_tool_use: { web_search_requests: 0 }, ...extra,
    });
    const usage = (buckets: Array<{ start: string; rows: unknown[] }>) => ({
      data: buckets.map((bucket) => ({ starting_at: bucket.start, ending_at: bucket.start, results: bucket.rows })), has_more: false, next_page: null,
    });
    const ctxFor = (cost: unknown, usageReply: { status?: number; json?: unknown }, limit = 200) => makeCtx({
      provider: 'claude_platform', now: NOW, providerSettings: { apiKey: 'sk-ant-admin01-test', monthlyLimitUsd: limit },
      routes: [{ match: USAGE, reply: usageReply }, { match: COST, reply: { json: cost } }],
    });

    it('adds the estimate to the confirmed total, splits it in the label and ignores buckets the cost report already covers', async () => {
      const ctx = ctxFor(costThrough('2026-10-28T00:00:00Z'), { json: usage([
        { start: '2026-10-27T23:00:00Z', rows: [row({ output_tokens: 1_000_000 })] },
        { start: '2026-10-28T01:00:00Z', rows: [row({ output_tokens: 1_000_000 })] },
      ]) });
      const snapshot = await claudePlatformAdapter.fetchSnapshot(ctx);
      const month = snapshot.windows[0];
      expect(snapshot.status).toBe('ok');
      expect(month?.usedAmount).toBeCloseTo(33.62, 6);
      expect(month?.usedPercent).toBeCloseTo(16.81, 6);
      expect(month?.label).toBe('이번달 (UTC) · 확정 $23.62 + 오늘 추정 $10.00');
      expect(snapshot.balance).toMatchObject({ label: '남은 한도 (추정 포함)' });
      expect(snapshot.balance?.amount).toBeCloseTo(166.38, 6);
      const usageCall = ctx.calls[1];
      expect(usageCall?.url).toContain('starting_at=2026-10-28T00:00:00Z');
      expect(usageCall?.url).toContain('bucket_width=1h');
      expect(usageCall?.url).toContain('group_by[]=service_tier');
      expect(usageCall?.init?.credentials).toBe('omit');
    });

    it('does not ask for or add an estimate once the cost report covers the present', async () => {
      const ctx = ctxFor(costThrough('2026-10-29T00:00:00Z'), { json: usage([{ start: '2026-10-28T01:00:00Z', rows: [row({ output_tokens: 1_000_000 })] }]) });
      const snapshot = await claudePlatformAdapter.fetchSnapshot(ctx);
      expect(ctx.calls).toHaveLength(1);
      expect(snapshot.windows[0]).toMatchObject({ label: '이번달 (UTC)', usedAmount: 23.62 });
      expect(snapshot.balance?.label).toBe('남은 한도');
    });

    it('shows only the confirmed value and says so when the usage report cannot be read', async () => {
      const snapshot = await claudePlatformAdapter.fetchSnapshot(ctxFor(costThrough('2026-10-28T00:00:00Z'), { status: 401, json: {} }));
      expect(snapshot.status).toBe('ok');
      expect(snapshot.windows[0]?.usedAmount).toBeCloseTo(23.62, 6);
      expect(snapshot.windows[0]?.label).toBe('이번달 (UTC) · 확정만 (오늘 추정 불가)');
    });

    it('counts non-standard rows, unknown models and web searches as excluded instead of pricing them', async () => {
      const snapshot = await claudePlatformAdapter.fetchSnapshot(ctxFor(costThrough('2026-10-28T00:00:00Z'), { json: usage([{ start: '2026-10-28T01:00:00Z', rows: [
        row({ output_tokens: 1_000_000, server_tool_use: { web_search_requests: 2 } }),
        row({ output_tokens: 5000, service_tier: 'priority' }),
        row({ model: 'claude-future-9', output_tokens: 5000 }),
      ] }]) }));
      expect(snapshot.windows[0]?.usedAmount).toBeCloseTo(33.62, 6);
      expect(snapshot.windows[0]?.label).toBe('이번달 (UTC) · 확정 $23.62 + 오늘 추정 $10.00 (추정 제외 3개)');
    });

    it('uses daily buckets and a different label when the cost report is more than a week behind', async () => {
      const ctx = ctxFor(costThrough('2026-10-10T00:00:00Z'), { json: usage([{ start: '2026-10-12T00:00:00Z', rows: [row({ output_tokens: 1_000_000 })] }]) });
      const snapshot = await claudePlatformAdapter.fetchSnapshot(ctx);
      expect(ctx.calls[1]?.url).toContain('bucket_width=1d');
      expect(ctx.calls[1]?.url).toContain('ending_at=2026-11-01T00:00:00.000Z');
      expect(snapshot.windows[0]?.label).toBe('이번달 (UTC) · 확정 $23.62 + 미반영 구간 추정 $10.00');
    });
  });
});
