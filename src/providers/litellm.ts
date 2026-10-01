import type { HttpResult, ProviderAdapter, ProviderContext, ProviderSnapshot, UsageWindow } from './types';
import {
  baseSnapshot,
  errorSnapshot,
  errorToSnapshot,
  hashId,
  isRecord,
  num,
  retryAtFromHeaders,
  statusFromHttp,
} from './util';

interface DailyResult {
  date: string;
  spend: number;
}

function dateString(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function utcDate(date: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const parsed = new Date(`${date}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function dailyResults(value: unknown): DailyResult[] | null {
  if (!isRecord(value) || !Array.isArray(value.results)) return null;
  const parsed: DailyResult[] = [];
  for (const entry of value.results) {
    if (!isRecord(entry) || typeof entry.date !== 'string' || !isRecord(entry.metrics)) return null;
    const spend = num(entry.metrics.spend);
    if (spend === undefined || utcDate(entry.date) === null) return null;
    parsed.push({ date: entry.date, spend });
  }
  return parsed;
}

function windowsForDaily(results: DailyResult[], now: Date): UsageWindow[] {
  const today = dateString(now);
  const dayStart = new Date(`${today}T00:00:00.000Z`);
  const weekStart = new Date(dayStart);
  weekStart.setUTCDate(dayStart.getUTCDate() - ((dayStart.getUTCDay() + 6) % 7));
  const monthStart = new Date(Date.UTC(dayStart.getUTCFullYear(), dayStart.getUTCMonth(), 1));
  const sum = (start: Date): number => results.reduce((total, result) => {
    const date = utcDate(result.date);
    return date !== null && date >= start && date <= dayStart ? total + result.spend : total;
  }, 0);
  return [
    { kind: 'day', label: '오늘', unit: 'usd', usedAmount: sum(dayStart), periodTz: 'UTC' },
    { kind: 'week', label: '이번주', unit: 'usd', usedAmount: sum(weekStart), periodTz: 'UTC' },
    { kind: 'month', label: '이번달', unit: 'usd', usedAmount: sum(monthStart), periodTz: 'UTC' },
  ];
}

function responseError(ctx: ProviderContext, now: Date, response: HttpResult): ProviderSnapshot | null {
  const status = statusFromHttp(response);
  return status === null
    ? null
    : errorSnapshot('litellm', now, status, `LiteLLM request failed (${response.status})`, ctx.previous, retryAtFromHeaders(response, now));
}

function partialSnapshot(snapshot: ProviderSnapshot): ProviderSnapshot {
  return {
    ...snapshot,
    error: { code: 'partial', message: 'daily spend unavailable for this key' },
  };
}

interface BudgetCandidate {
  remaining: number;
  limit: number;
  resetsAt: string | null;
}

async function userBudget(
  ctx: ProviderContext,
  baseUrl: string,
  init: { headers: Record<string, string>; credentials: 'omit' },
): Promise<BudgetCandidate | undefined> {
  const res = await ctx.get(`${baseUrl}/user/info`, init);
  if (statusFromHttp(res) !== null || !isRecord(res.json) || !isRecord(res.json.user_info)) return undefined;
  const info = res.json.user_info;
  const max = num(info.max_budget);
  const spend = num(info.spend);
  if (max === undefined || spend === undefined) return undefined;
  return { remaining: max - spend, limit: max, resetsAt: typeof info.budget_reset_at === 'string' ? info.budget_reset_at : null };
}

async function cachedDaily(ctx: ProviderContext, key: string): Promise<DailyResult[] | null> {
  const cached = await ctx.cache.get(key);
  if (!cached) return null;
  try {
    const value: unknown = JSON.parse(cached);
    if (!Array.isArray(value)) return null;
    const results: DailyResult[] = [];
    for (const entry of value) {
      if (!isRecord(entry) || typeof entry.date !== 'string' || num(entry.spend) === undefined || utcDate(entry.date) === null) return null;
      results.push({ date: entry.date, spend: num(entry.spend) ?? 0 });
    }
    return results;
  } catch {
    return null;
  }
}

async function getDaily(
  ctx: ProviderContext,
  baseUrl: string,
  init: { headers: Record<string, string>; credentials: 'omit' },
  params: URLSearchParams,
  now: Date,
  keyVerified: boolean,
): Promise<{ results?: DailyResult[]; snapshot?: ProviderSnapshot; partial?: true }> {
  const aggregated = await ctx.get(`${baseUrl}/user/daily/activity/aggregated?${params.toString()}`, init);
  if (aggregated.status === 500) {
    return { snapshot: errorSnapshot('litellm', now, 'unsupported', 'LiteLLM proxy has no spend database', ctx.previous) };
  }
  const aggregatedDenied = !aggregated.challenge && (aggregated.status === 401 || aggregated.status === 403);
  if (!aggregatedDenied && aggregated.status !== 404 && aggregated.status !== 405) {
    const failure = responseError(ctx, now, aggregated);
    if (failure) return { snapshot: failure };
    const results = dailyResults(aggregated.json);
    return results === null
      ? { snapshot: errorSnapshot('litellm', now, 'schema_changed', 'LiteLLM daily activity schema changed', ctx.previous) }
      : { results };
  }

  const all: DailyResult[] = [];
  for (let page = 1; page <= 10; page += 1) {
    const pageParams = new URLSearchParams(params);
    pageParams.set('page', String(page));
    pageParams.set('page_size', '1000');
    const response = await ctx.get(`${baseUrl}/user/daily/activity?${pageParams.toString()}`, init);
    const denied = !response.challenge && (response.status === 403 || (response.status === 401 && keyVerified));
    const missing = aggregatedDenied && (response.status === 404 || response.status === 405);
    if (denied || missing) return { partial: true };
    if (response.status === 500) {
      return { snapshot: errorSnapshot('litellm', now, 'unsupported', 'LiteLLM proxy has no spend database', ctx.previous) };
    }
    const failure = responseError(ctx, now, response);
    if (failure) return { snapshot: failure };
    const results = dailyResults(response.json);
    if (results === null) {
      return { snapshot: errorSnapshot('litellm', now, 'schema_changed', 'LiteLLM daily activity schema changed', ctx.previous) };
    }
    all.push(...results);
    const metadata = isRecord(response.json) && isRecord(response.json.metadata) ? response.json.metadata : undefined;
    if (metadata?.has_more !== true) return { results: all };
  }
  return { results: all };
}

export const litellmAdapter: ProviderAdapter = {
  id: 'litellm',
  async fetchSnapshot(ctx): Promise<ProviderSnapshot> {
    const now = ctx.now();
    try {
      const rawBaseUrl = ctx.providerSettings.baseUrl?.trim();
      const apiKey = ctx.providerSettings.apiKey?.trim();
      if (!rawBaseUrl || !apiKey) {
        return errorSnapshot('litellm', now, 'not_configured', 'LiteLLM base URL and API key are required', ctx.previous);
      }
      const baseUrl = rawBaseUrl.replace(/\/+$/, '').replace(/\/v1$/, '');
      const headerName = ctx.providerSettings.headerName?.trim() || 'Authorization';
      const init = { headers: { Accept: 'application/json', [headerName]: `Bearer ${apiKey}` }, credentials: 'omit' as const };
      const mode = ctx.providerSettings.mode === 'admin' ? 'admin' : 'user';
      const snapshot = baseSnapshot('litellm', now);
      let userId: string | undefined;

      if (mode === 'user') {
        const keyInfo = await ctx.get(`${baseUrl}/key/info`, init);
        const failure = responseError(ctx, now, keyInfo);
        if (failure) return failure;
        if (!isRecord(keyInfo.json) || !isRecord(keyInfo.json.info)) {
          return errorSnapshot('litellm', now, 'schema_changed', 'LiteLLM key info schema changed', ctx.previous);
        }
        const info = keyInfo.json.info;
        const spend = num(info.spend);
        const maxBudget = num(info.max_budget);
        const resetAt = typeof info.budget_reset_at === 'string' ? info.budget_reset_at : null;
        if (maxBudget !== undefined || resetAt !== null) {
          if (spend === undefined) {
            return errorSnapshot('litellm', now, 'schema_changed', 'LiteLLM key info schema changed', ctx.previous);
          }
          snapshot.windows.push({
            kind: 'budget',
            label: '예산',
            unit: 'usd',
            usedAmount: spend,
            limitAmount: maxBudget,
            ...(maxBudget !== undefined && maxBudget > 0 && spend !== undefined ? { usedPercent: (spend / maxBudget) * 100 } : {}),
            resetsAt: resetAt,
            periodTz: 'UTC',
          });
        }
        if (typeof info.key_alias === 'string') snapshot.account = info.key_alias;
        if (typeof info.user_id === 'string' && info.user_id !== '') userId = info.user_id;
        const candidates: BudgetCandidate[] = [];
        if (maxBudget !== undefined && spend !== undefined) candidates.push({ remaining: maxBudget - spend, limit: maxBudget, resetsAt: resetAt });
        if (userId) {
          const fromUser = await userBudget(ctx, baseUrl, init);
          if (fromUser) candidates.push(fromUser);
        }
        const tightest = candidates.sort((a, b) => a.remaining - b.remaining)[0];
        if (tightest) {
          snapshot.balance = { amount: Math.max(tightest.remaining, 0), unit: 'usd', limit: tightest.limit, label: '남은 예산', resetsAt: tightest.resetsAt };
        }
        if (!userId) return partialSnapshot(snapshot);
      }

      const today = dateString(now);
      const start = new Date(`${today}T00:00:00.000Z`);
      start.setUTCDate(start.getUTCDate() - 31);
      const params = new URLSearchParams({
        start_date: dateString(start),
        end_date: today,
        include_current_utc_day: 'true',
      });
      if (userId) params.set('user_id', userId);
      const cacheKey = `litellm:daily:${await hashId('litellm', `${baseUrl}:${mode}:${userId ?? 'all'}:${today}`)}`;
      const cached = await cachedDaily(ctx, cacheKey);
      const daily = cached === null ? await getDaily(ctx, baseUrl, init, params, now, mode === 'user') : { results: cached };
      if (daily.snapshot) return daily.snapshot;
      if (daily.partial) return partialSnapshot(snapshot);
      const results = daily.results ?? [];
      if (cached === null) await ctx.cache.set(cacheKey, JSON.stringify(results), 60_000);
      snapshot.windows.push(...windowsForDaily(results, now));
      return snapshot;
    } catch (error) {
      return errorToSnapshot('litellm', now, error, ctx.previous);
    }
  },
};
