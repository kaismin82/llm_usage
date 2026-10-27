import type { HttpResult, ProviderAdapter, ProviderSnapshot, UsageWindow } from './types';
import {
  baseSnapshot,
  errorSnapshot,
  errorToSnapshot,
  isRecord,
  retryAtFromHeaders,
  statusFromHttp,
} from './util';

// Usage & Cost Admin API: https://platform.claude.com/docs/en/manage-claude/usage-cost-api
// GET-only. Requires an Admin API key (sk-ant-admin01-...) passed via x-api-key.
const COST_URL = 'https://api.anthropic.com/v1/organizations/cost_report';
const ANTHROPIC_VERSION = '2023-06-01';
const MAX_PAGES = 4;
const DEFAULT_LIMIT_USD = 200;

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
        const more = isRecord(res.json) && res.json.has_more === true;
        const nextPage = isRecord(res.json) && typeof res.json.next_page === 'string' ? res.json.next_page : undefined;
        if (!more || !nextPage) break;
        page = nextPage;
      }

      const usedUsd = (cents ?? 0) / 100;
      const monthWindow: UsageWindow = {
        kind: 'month',
        label: '이번달 (UTC)',
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
          ? { balance: { amount: Math.max(0, limitUsd - usedUsd), unit: 'usd' as const, label: '남은 한도', limit: limitUsd, resetsAt: next.toISOString() } }
          : {}),
      };
    } catch (error) {
      return errorToSnapshot('claude_platform', ctx.now(), error, ctx.previous);
    }
  },
};
