import { isRecord } from './util';

export interface CostSummary {
  totalUsd: number;
  byDay: Record<string, number>;
  byCostType: Record<string, number>;
  byWorkspace: Record<string, number>;
  byModel: Record<string, number>;
  items: number;
  buckets: number;
  /** Latest bucket (by start) that carries a positive cost; undefined when nothing was billed. */
  lastCostBucket?: { startingAt: string; endingAt?: string };
  /** Every daily bucket in the response, zero-cost days included, in response order. */
  bucketTotals: Array<{ startingAt: string; endingAt?: string; usd: number }>;
}

export function topEntries(values: Record<string, number>, count: number): {
  top: Array<[string, number]>; restCount: number; restUsd: number;
} {
  const sorted = Object.entries(values).sort((a, b) => b[1] - a[1]);
  const rest = sorted.slice(count);
  return { top: sorted.slice(0, count), restCount: rest.length, restUsd: rest.reduce((sum, entry) => sum + entry[1], 0) };
}

function add(map: Record<string, number>, key: string, usd: number): void {
  map[key] = (map[key] ?? 0) + usd;
}

/**
 * Sums Cost API buckets (amounts are decimal strings in cents) into USD totals per day, cost type,
 * workspace and model so a total can be compared with the Claude Console. Returns undefined for any
 * item it cannot read as non-negative USD, rather than guessing a total.
 */
export function summarizeCostBuckets(buckets: unknown): CostSummary | undefined {
  if (!Array.isArray(buckets)) return undefined;
  const summary: CostSummary = { totalUsd: 0, byDay: {}, byCostType: {}, byWorkspace: {}, byModel: {}, items: 0, buckets: 0, bucketTotals: [] };
  for (const bucket of buckets) {
    if (!isRecord(bucket) || typeof bucket.starting_at !== 'string' || !Array.isArray(bucket.results)) return undefined;
    const day = bucket.starting_at.slice(0, 10);
    summary.buckets += 1;
    let bucketUsd = 0;
    for (const item of bucket.results) {
      if (!isRecord(item) || item.currency !== 'USD' || typeof item.amount !== 'string') return undefined;
      const cents = Number(item.amount);
      if (!Number.isFinite(cents) || cents < 0) return undefined;
      const usd = cents / 100;
      summary.totalUsd += usd;
      bucketUsd += usd;
      summary.items += 1;
      add(summary.byDay, day, usd);
      add(summary.byCostType, typeof item.cost_type === 'string' ? item.cost_type : 'unknown', usd);
      add(summary.byWorkspace, typeof item.workspace_id === 'string' ? item.workspace_id : 'default workspace', usd);
      add(summary.byModel, typeof item.model === 'string' ? item.model : '(no model)', usd);
    }
    summary.bucketTotals.push({
      startingAt: bucket.starting_at,
      ...(typeof bucket.ending_at === 'string' ? { endingAt: bucket.ending_at } : {}),
      usd: bucketUsd,
    });
    if (bucketUsd > 0 && (summary.lastCostBucket === undefined || bucket.starting_at > summary.lastCostBucket.startingAt)) {
      summary.lastCostBucket = {
        startingAt: bucket.starting_at,
        ...(typeof bucket.ending_at === 'string' ? { endingAt: bucket.ending_at } : {}),
      };
    }
  }
  return summary;
}
