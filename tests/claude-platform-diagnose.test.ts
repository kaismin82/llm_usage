import { describe, expect, it } from 'vitest';
import { DIAGNOSE_MAX_PAGES, diagnoseClaudePlatform } from '../src/providers/claude-platform-diagnose';
import { makeCtx } from './helpers';

const KEY = 'sk-ant-admin01-FAKE';
const NOW = new Date('2026-10-15T08:00:00Z');
const item = (amount: string, extra: Record<string, unknown> = {}) => ({ amount, currency: 'USD', ...extra });
const bucket = (day: string, results: unknown[]) => ({ starting_at: day + 'T00:00:00Z', ending_at: day.slice(0, 8) + String(Number(day.slice(8)) + 1).padStart(2, '0') + 'T00:00:00Z', results });

function ctxWith(reply: (url: string) => { status?: number; json?: unknown }) {
  return makeCtx({ provider: 'claude_platform', routes: [{ match: /cost_report/, reply: (url) => reply(url) }] });
}

describe('diagnoseClaudePlatform', () => {
  it('requests the UTC month grouped by description and workspace, follows pages and totals the cost', async () => {
    const ctx = ctxWith((url) => url.includes('page=pg2')
      ? { json: { data: [bucket('2026-10-03', [item('235', { cost_type: 'web_search', workspace_id: 'wrkspc_a' })])], has_more: false, next_page: null } }
      : { json: { data: [bucket('2026-10-01', [item('1000', { cost_type: 'tokens', model: 'claude-opus-5-5', workspace_id: 'wrkspc_a' })]), bucket('2026-10-02', [])], has_more: true, next_page: 'pg2' } });

    const result = await diagnoseClaudePlatform({ apiKey: KEY, now: NOW, get: ctx.get });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.pages).toBe(2);
    expect(result.hasMore).toBe(false);
    expect(result.params).toEqual({
      startingAt: '2026-10-01T00:00:00.000Z', endingAt: '2026-11-01T00:00:00.000Z', bucketWidth: '1d', limit: 31,
      groupBy: ['description', 'workspace_id'],
    });
    expect(result.summary.totalUsd).toBeCloseTo(12.35, 6);
    expect(result.summary.buckets).toBe(3);
    expect(result.summary.lastCostBucket?.startingAt).toBe('2026-10-03T00:00:00Z');
    const first = ctx.calls[0];
    expect(first.url).toContain('starting_at=2026-10-01T00:00:00.000Z');
    expect(first.url).toContain('ending_at=2026-11-01T00:00:00.000Z');
    expect(first.url).toContain('bucket_width=1d');
    expect(first.url).toContain('limit=31');
    expect(first.url).toContain('group_by[]=description');
    expect(first.url).toContain('group_by[]=workspace_id');
    expect(first.init?.credentials).toBe('omit');
    expect(JSON.stringify(result)).not.toContain(KEY);
  });

  it('reports when the page limit cut the report short', async () => {
    const ctx = ctxWith(() => ({ json: { data: [bucket('2026-10-01', [item('100')])], has_more: true, next_page: 'again' } }));
    const result = await diagnoseClaudePlatform({ apiKey: KEY, now: NOW, get: ctx.get });
    expect(result).toMatchObject({ ok: true, pages: DIAGNOSE_MAX_PAGES, hasMore: true });
  });

  it('turns auth, other HTTP, shape and transport failures into messages without the key', async () => {
    const rejected = await diagnoseClaudePlatform({ apiKey: KEY, now: NOW, get: ctxWith(() => ({ status: 401, json: {} })).get });
    expect(rejected).toMatchObject({ ok: false });
    expect(rejected.ok ? '' : rejected.message).toContain('HTTP 401');

    const missing = await diagnoseClaudePlatform({ apiKey: KEY, now: NOW, get: makeCtx({ provider: 'claude_platform', routes: [] }).get });
    expect(missing).toEqual({ ok: false, message: '조회 실패 (HTTP 404)' });

    const shape = await diagnoseClaudePlatform({ apiKey: KEY, now: NOW, get: ctxWith(() => ({ json: {} })).get });
    expect(shape.ok ? '' : shape.message).toContain('응답 형식');

    const network = await diagnoseClaudePlatform({
      apiKey: KEY, now: NOW,
      get: async () => { throw Object.assign(new Error('NetworkError'), { name: 'NetworkError' }); },
    });
    expect(network.ok ? '' : network.message).toContain('연결 실패');

    const euros = await diagnoseClaudePlatform({
      apiKey: KEY, now: NOW,
      get: ctxWith(() => ({ json: { data: [{ starting_at: '2026-10-01T00:00:00Z', results: [{ amount: '5', currency: 'EUR' }] }] } })).get,
    });
    expect(euros.ok ? '' : euros.message).toContain('합계를 표시하지 않습니다');
    for (const result of [rejected, missing, shape, network, euros]) expect(JSON.stringify(result)).not.toContain(KEY);
  });
});
