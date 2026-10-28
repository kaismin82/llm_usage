import { describe, expect, it } from 'vitest';
import { summarizeCostBuckets } from '../src/providers/cost-summary';

const item = (amount: string, extra: Record<string, unknown> = {}) => ({ amount, currency: 'USD', ...extra });

describe('summarizeCostBuckets', () => {
  it('converts cent strings to USD and groups by day, cost type, workspace and model', () => {
    const summary = summarizeCostBuckets([
      { starting_at: '2026-10-01T00:00:00Z', results: [
        item('123.45', { cost_type: 'tokens', model: 'claude-opus-5-5', workspace_id: 'wrkspc_a' }),
        item('50', { cost_type: 'web_search', workspace_id: null }),
      ] },
      { starting_at: '2026-10-02T00:00:00Z', results: [] },
      { starting_at: '2026-10-03T00:00:00Z', results: [item('1000', { cost_type: 'tokens', model: 'claude-opus-5-5', workspace_id: 'wrkspc_a' })] },
    ])!;

    expect(summary.totalUsd).toBeCloseTo(11.7345, 6);
    expect(summary.items).toBe(3);
    expect(summary.byDay['2026-10-01']).toBeCloseTo(1.7345, 6);
    expect(summary.byDay['2026-10-02']).toBeUndefined();
    expect(summary.byCostType['tokens']).toBeCloseTo(11.2345, 6);
    expect(summary.byCostType['web_search']).toBeCloseTo(0.5, 6);
    expect(summary.byWorkspace['wrkspc_a']).toBeCloseTo(11.2345, 6);
    expect(summary.byWorkspace['default workspace']).toBeCloseTo(0.5, 6);
    expect(summary.byModel['(no model)']).toBeCloseTo(0.5, 6);
  });

  it('refuses to total anything it cannot read as non-negative USD', () => {
    expect(summarizeCostBuckets({})).toBeUndefined();
    expect(summarizeCostBuckets([{ starting_at: '2026-10-01T00:00:00Z', results: [{ amount: '5', currency: 'EUR' }] }])).toBeUndefined();
    expect(summarizeCostBuckets([{ starting_at: '2026-10-01T00:00:00Z', results: [item('abc')] }])).toBeUndefined();
    expect(summarizeCostBuckets([{ starting_at: '2026-10-01T00:00:00Z', results: [item('-1')] }])).toBeUndefined();
    expect(summarizeCostBuckets([{ results: [] }])).toBeUndefined();
  });
});
