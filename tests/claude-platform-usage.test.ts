import { describe, expect, it } from 'vitest';
import { estimateUsageCost, judgeToday, parseUsageBuckets, sumTokens } from '../src/providers/claude-platform-usage';
import { diagnoseUsageExtras } from '../src/providers/claude-platform-usage-diagnose';
import { makeCtx } from './helpers';

const KEY = 'sk-ant-admin01-FAKE';
const NOW = new Date('2026-10-28T04:37:54Z');
const item = (model: string, extra: Record<string, unknown> = {}) => ({
  model, service_tier: 'standard', speed: 'standard', inference_geo: 'global',
  uncached_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 0,
  cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 0 }, server_tool_use: { web_search_requests: 0 }, ...extra,
});
const hour = (h: number, results: unknown[]) => ({
  starting_at: '2026-10-28T' + String(h).padStart(2, '0') + ':00:00Z', ending_at: '2026-10-28T' + String(h + 1).padStart(2, '0') + ':00:00Z', results,
});

describe('parseUsageBuckets', () => {
  it('reads token fields per row and sums them', () => {
    const parsed = parseUsageBuckets([hour(1, [item('claude-sonnet-5-5', { uncached_input_tokens: 10, cache_read_input_tokens: 20, output_tokens: 5, cache_creation: { ephemeral_5m_input_tokens: 3, ephemeral_1h_input_tokens: 2 } })]), hour(2, [])]);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.buckets).toHaveLength(2);
    expect(parsed.buckets[0]?.rows[0]).toMatchObject({ model: 'claude-sonnet-5-5', uncached: 10, cacheRead: 20, cache5m: 3, cache1h: 2, output: 5 });
    expect(sumTokens(parsed.buckets)).toBe(40);
  });

  it('fails with field names, never guessing, when a field is missing or not numeric', () => {
    const missing = parseUsageBuckets([{ starting_at: '2026-10-28T00:00:00Z', results: [{ model: 'm', output_tokens: 1 }] }]);
    expect(missing.ok).toBe(false);
    expect(missing.ok ? '' : missing.message).toContain('output_tokens');
    expect(parseUsageBuckets([hour(0, [item('m', { output_tokens: '5' })])]).ok).toBe(false);
    expect(parseUsageBuckets({}).ok).toBe(false);
  });
});

describe('estimateUsageCost', () => {
  it('prices a known model from the published table and shows the formula', () => {
    const parsed = parseUsageBuckets([hour(1, [item('claude-sonnet-5-5', {
      uncached_input_tokens: 1_000_000, cache_read_input_tokens: 2_000_000, output_tokens: 500_000,
      cache_creation: { ephemeral_5m_input_tokens: 400_000, ephemeral_1h_input_tokens: 0 }, server_tool_use: { web_search_requests: 3 },
    })])]);
    if (!parsed.ok) throw new Error('fixture');
    const estimate = estimateUsageCost(parsed.buckets);
    // 1M*2 + 2M*0.10 + 0.4M*2.50 + 0.5M*10; web searches are counted but not priced
    expect(estimate.totalUsd).toBeCloseTo(8.2, 6);
    expect(estimate.webSearchRequests).toBe(3);
    const line = estimate.lines[0];
    expect(line?.kind).toBe('estimated');
    expect(line?.kind === 'estimated' ? line.formula : '').toContain('× $2/MTok');
  });

  it('does not price unknown models, tiered Haiku 5.5 or non-standard rows', () => {
    const parsed = parseUsageBuckets([hour(1, [
      item('claude-future-9', { output_tokens: 1000 }),
      item('claude-haiku-5-5', { output_tokens: 1000 }),
      item('claude-sonnet-5-5', { output_tokens: 1000, service_tier: 'priority' }),
    ])]);
    if (!parsed.ok) throw new Error('fixture');
    const estimate = estimateUsageCost(parsed.buckets);
    expect(estimate.totalUsd).toBe(0);
    expect(estimate.lines.map((line) => line.kind).sort()).toEqual(['excluded', 'unknown', 'unknown']);
    expect(estimate.lines.find((line) => line.model === 'claude-future-9')?.kind === 'unknown').toBe(true);
  });

  it('matches a dated model id to its price', () => {
    const parsed = parseUsageBuckets([hour(1, [item('claude-opus-4-1-20250805', { output_tokens: 1_000_000 })])]);
    if (!parsed.ok) throw new Error('fixture');
    expect(estimateUsageCost(parsed.buckets).totalUsd).toBeCloseTo(75, 6);
  });
});

describe('price table', () => {
  it('reproduces the confirmed 2026-10-27 cost_report figure from yesterday\'s tokens (within $0.01)', () => {
    const parsed = parseUsageBuckets([{
      starting_at: '2026-10-27T00:00:00Z', ending_at: '2026-10-28T00:00:00Z',
      results: [item('claude-sonnet-5-5', { cache_read_input_tokens: 48_793_460, output_tokens: 95_431, cache_creation: { ephemeral_5m_input_tokens: 7_114_799, ephemeral_1h_input_tokens: 0 } })],
    }]);
    if (!parsed.ok) throw new Error('fixture');
    expect(Math.abs(estimateUsageCost(parsed.buckets).totalUsd - 23.62)).toBeLessThanOrEqual(0.01);
  });
});

describe('judgeToday', () => {
  it('compares today tokens with today cost bucket', () => {
    expect(judgeToday(5000, undefined)).toContain('오늘 토큰 5,000개 있음 / 비용 버킷 없음');
    expect(judgeToday(5000, { usd: 1.5 })).toContain('$1.50');
    expect(judgeToday(5000, { usd: 0 })).toContain('$0');
    expect(judgeToday(0, undefined)).toContain('토큰 0개');
    expect(judgeToday(undefined, undefined)).toContain('판정할 수 없습니다');
  });
});

describe('diagnoseUsageExtras', () => {
  it('requests hourly today, daily month and three cost_report endings, GET-only, without leaking the key', async () => {
    const ctx = makeCtx({ provider: 'claude_platform', routes: [
      { match: 'usage_report/messages', reply: (url) => ({ json: { data: url.includes('bucket_width=1h') ? [hour(1, [item('claude-sonnet-5-5', { output_tokens: 100 })])] : [], has_more: false, next_page: null } }) },
      { match: 'cost_report', reply: () => ({ json: { data: [{ starting_at: '2026-10-27T00:00:00Z', ending_at: '2026-10-28T00:00:00Z', results: [{ amount: '2362', currency: 'USD' }] }], has_more: false, next_page: null } }) },
    ] });
    const extras = await diagnoseUsageExtras({ apiKey: KEY, now: NOW, get: ctx.get });
    expect(extras.today).toBe('2026-10-28');
    expect(extras.usageToday.ok && sumTokens(extras.usageToday.buckets)).toBe(100);
    const urls = ctx.calls.map((call) => call.url);
    expect(urls).toHaveLength(5);
    expect(urls[0]).toContain('starting_at=2026-10-28T00:00:00.000Z');
    expect(urls[0]).toContain('bucket_width=1h');
    expect(urls[0]).toContain('limit=24');
    expect(urls[0]).toContain('group_by[]=model');
    expect(urls[1]).toContain('bucket_width=1d');
    expect(urls[1]).toContain('starting_at=2026-10-01T00:00:00.000Z');
    expect(urls[2]).toContain('ending_at=2026-11-01T00:00:00.000Z');
    expect(urls[3]).toContain('ending_at=2026-10-29T00:00:00.000Z');
    expect(urls[4]).toContain('ending_at=2026-10-28T04:00:00.000Z');
    expect(extras.probes.map((probe) => probe.ok && probe.includesToday)).toEqual([false, false, false]);
    expect(extras.probes[0]).toMatchObject({ ok: true, buckets: 1, lastStartingAt: '2026-10-27T00:00:00Z', totalUsd: 23.62 });
    expect(ctx.calls.every((call) => call.init?.credentials === 'omit')).toBe(true);
    expect(JSON.stringify(extras)).not.toContain(KEY);
  });

  it('keeps going and reports a section failure when the usage report cannot be read', async () => {
    const ctx = makeCtx({ provider: 'claude_platform', routes: [
      { match: 'usage_report/messages', reply: { status: 401, json: {} } },
      { match: 'cost_report', reply: { json: { data: [], has_more: false, next_page: null } } },
    ] });
    const extras = await diagnoseUsageExtras({ apiKey: KEY, now: NOW, get: ctx.get });
    expect(extras.usageToday.ok).toBe(false);
    expect(extras.usageMonth.ok).toBe(false);
    expect(extras.probes).toHaveLength(3);
  });
});
