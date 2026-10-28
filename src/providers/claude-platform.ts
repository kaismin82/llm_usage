import type { HttpResult, ProviderAdapter, ProviderContext, ProviderSnapshot, UsageWindow } from './types';
import {
  baseSnapshot,
  errorSnapshot,
  errorToSnapshot,
  isRecord,
  retryAtFromHeaders,
  statusFromHttp,
} from './util';
import { estimateUsageCost } from './claude-platform-usage';
import { fetchUsage } from './claude-platform-usage-diagnose';

// Usage & Cost Admin API: https://platform.claude.com/docs/en/manage-claude/usage-cost-api
// GET-only. Requires an Admin API key (sk-ant-admin01-...) passed via x-api-key.
const COST_URL = 'https://api.anthropic.com/v1/organizations/cost_report';
const ANTHROPIC_VERSION = '2023-06-01';
const MAX_PAGES = 4;
const DEFAULT_LIMIT_USD = 200;
const MAX_HOURLY_BUCKETS = 168;

interface MonthBounds {
  start: Date;
  next: Date;
}

function utcMonthBounds(now: Date): MonthBounds {
  return {
    start: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)),
    next: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)),
  };
}

function sumCostCents(res: HttpResult): number | undefined {
  if (!isRecord(res.json) || !Array.isArray(res.json.data)) return undefined;
  let total = 0;
  for (const bucket of res.json.data) {
    if (!isRecord(bucket) || !Array.isArray(bucket.results)) return undefined;
    for (const item of bucket.results) {
      if (!isRecord(item)) return undefined;
      if (item.currency !== 'USD') return undefined;
      const amount = typeof item.amount === 'string' ? Number(item.amount) : Number.NaN;
      if (!Number.isFinite(amount) || amount < 0) return undefined;
      total += amount;
    }
  }
  return total;
}

const isLater = (candidate: string, current: string | undefined): boolean =>
  current === undefined || Date.parse(candidate) > Date.parse(current);

/** Latest bucket end (RFC 3339) in a cost report page; buckets are daily and include empty days. */
function latestBucketEnd(res: HttpResult): string | undefined {
  if (!isRecord(res.json) || !Array.isArray(res.json.data)) return undefined;
  let latest: string | undefined;
  for (const bucket of res.json.data) {
    if (isRecord(bucket) && typeof bucket.ending_at === 'string' && isLater(bucket.ending_at, latest)) latest = bucket.ending_at;
  }
  return latest;
}

type GapEstimate =
  | { kind: 'none' }
  | { kind: 'unavailable' }
  | { kind: 'estimated'; usd: number; excluded: number; hasTokens: boolean };

/**
 * The cost report is confirmed spend but can lag the current day. Tokens from the usage report for the span the
 * cost report does not cover yet (its last bucket end up to now) are priced at published standard prices.
 * Buckets before that end are dropped, so a day the cost report already contains is never counted twice.
 */
async function estimateUncovered(get: ProviderContext['get'], apiKey: string, coveredUntil: string, now: Date, next: Date): Promise<GapEstimate> {
  const coveredMs = Date.parse(coveredUntil);
  if (!(coveredMs < now.getTime())) return { kind: 'none' };
  const gapHours = Math.ceil((now.getTime() - coveredMs) / 3_600_000);
  const hourly = gapHours < MAX_HOURLY_BUCKETS;
  const section = await fetchUsage(get, apiKey, hourly
    ? { startingAt: coveredUntil, width: '1h', limit: gapHours + 1 }
    : { startingAt: coveredUntil, endingAt: next.toISOString(), width: '1d', limit: 31 });
  if (!section.ok) return { kind: 'unavailable' };
  const buckets = section.buckets.filter((bucket) => Date.parse(bucket.startingAt) >= coveredMs && Date.parse(bucket.startingAt) < next.getTime());
  const estimate = estimateUsageCost(buckets);
  const excluded = estimate.lines.filter((line) => line.kind !== 'estimated').length + (estimate.webSearchRequests > 0 ? 1 : 0);
  return { kind: 'estimated', usd: estimate.totalUsd, excluded, hasTokens: buckets.some((bucket) => bucket.rows.length > 0) };
}

const usdText = (value: number): string => '$' + value.toFixed(2);

function httpError(res: HttpResult, now: Date, previous?: ProviderSnapshot): ProviderSnapshot | null {
  const status = statusFromHttp(res);
  if (!status) return null;
  const message = status === 'auth_required'
    ? '키가 거부되었습니다(401). 워크스페이스에 묶인 키는 사용량 조회 권한이 없습니다. Console → Settings → API Keys의 조직(기본) 스코프 키 또는 Settings → Admin keys의 Admin 키가 필요합니다'
    : status === 'rate_limited' ? '요청 제한' : `사용량 조회 실패 (HTTP ${res.status})`;
  return errorSnapshot('claude_platform', now, status, message, previous, retryAtFromHeaders(res, now));
}

export const claudePlatformAdapter: ProviderAdapter = {
  id: 'claude_platform',
  async fetchSnapshot(ctx) {
    try {
      const now = ctx.now();
      const apiKey = ctx.providerSettings.apiKey;
      if (!apiKey) return errorSnapshot('claude_platform', now, 'not_configured', 'Admin API key required', ctx.previous);
      const limitUsd = ctx.providerSettings.monthlyLimitUsd ?? DEFAULT_LIMIT_USD;
      const hasLimit = limitUsd > 0;
      const { start, next } = utcMonthBounds(now);

      let cents: number | undefined;
      let coveredUntil: string | undefined;
      let page: string | undefined;
      for (let request = 0; request < MAX_PAGES; request += 1) {
        const url = `${COST_URL}?starting_at=${start.toISOString()}&ending_at=${next.toISOString()}&limit=31`
          + (page ? `&page=${encodeURIComponent(page)}` : '');
        const res = await ctx.get(url, {
          headers: { 'x-api-key': apiKey, 'anthropic-version': ANTHROPIC_VERSION, Accept: 'application/json' },
          credentials: 'omit',
        });
        const failure = httpError(res, now, ctx.previous);
        if (failure) return failure;
        const pageCents = sumCostCents(res);
        if (pageCents === undefined) {
          return errorSnapshot('claude_platform', now, 'schema_changed', 'invalid cost report response', ctx.previous);
        }
        cents = (cents ?? 0) + pageCents;
        const pageEnd = latestBucketEnd(res);
        if (pageEnd !== undefined && isLater(pageEnd, coveredUntil)) coveredUntil = pageEnd;
        const more = isRecord(res.json) && res.json.has_more === true;
        const nextPage = isRecord(res.json) && typeof res.json.next_page === 'string' ? res.json.next_page : undefined;
        if (!more || !nextPage) break;
        page = nextPage;
      }

      const confirmedUsd = (cents ?? 0) / 100;
      const covered = coveredUntil ?? start.toISOString();
      const gap = await estimateUncovered(ctx.get, apiKey, covered, now, next);
      const when = covered.slice(0, 10) === now.toISOString().slice(0, 10) ? '오늘' : '미반영 구간';
      const estimatedUsd = gap.kind === 'estimated' ? gap.usd : 0;
      const showEstimate = gap.kind === 'estimated' && (gap.hasTokens || gap.excluded > 0);
      const usedUsd = confirmedUsd + estimatedUsd;
      // The label carries the split so the panel and the phone payload need no new fields.
      const label = showEstimate && gap.kind === 'estimated'
        ? `이번달 (UTC) · 확정 ${usdText(confirmedUsd)} + ${when} 추정 ${usdText(gap.usd)}` + (gap.excluded > 0 ? ` (추정 제외 ${gap.excluded}개)` : '')
        : gap.kind === 'unavailable' ? `이번달 (UTC) · 확정만 (${when} 추정 불가)` : '이번달 (UTC)';
      const monthWindow: UsageWindow = {
        kind: 'month',
        label,
        unit: 'usd',
        usedAmount: usedUsd,
        ...(hasLimit ? { limitAmount: limitUsd, usedPercent: (usedUsd / limitUsd) * 100 } : {}),
        resetsAt: next.toISOString(),
        windowSeconds: (next.getTime() - start.getTime()) / 1000,
        periodTz: 'UTC',
      };
      return {
        ...baseSnapshot('claude_platform', now),
        windows: [monthWindow],
        // 이 값은 Claude Platform(Anthropic API) 조직의 사용액이며, claude.ai 구독 계정의
        // extra usage와는 별개입니다. 합산하지 않습니다.
        ...(hasLimit
          ? { balance: { amount: Math.max(0, limitUsd - usedUsd), unit: 'usd' as const, label: showEstimate ? '남은 한도 (추정 포함)' : '남은 한도', limit: limitUsd, resetsAt: next.toISOString() } }
          : {}),
      };
    } catch (error) {
      return errorToSnapshot('claude_platform', ctx.now(), error, ctx.previous);
    }
  },
};
