import type { HttpRequestInit, ProviderAdapter, ProviderContext, ProviderSnapshot, UsageWindow } from './types';
import { baseSnapshot, errorSnapshot, errorToSnapshot, isRecord, num, retryAtFromHeaders, statusFromHttp } from './util';

const ENDPOINT = 'https://openrouter.ai/api/v1';

function amount(value: unknown): number | undefined {
  return num(value);
}

function makeWindows(daily: number, weekly: number, monthly: number): UsageWindow[] {
  return [
    { kind: 'day', label: '오늘', usedAmount: daily, unit: 'usd', periodTz: 'UTC' },
    { kind: 'week', label: '이번주', usedAmount: weekly, unit: 'usd', periodTz: 'UTC' },
    { kind: 'month', label: '이번달', usedAmount: monthly, unit: 'usd', periodTz: 'UTC' },
  ];
}

async function fetchCredits(ctx: ProviderContext, init: HttpRequestInit): Promise<ProviderSnapshot['balance']> {
  const res = await ctx.get(`${ENDPOINT}/credits`, init);
  if (statusFromHttp(res) !== null || !isRecord(res.json) || !isRecord(res.json.data)) return undefined;
  const total = amount(res.json.data.total_credits);
  const used = amount(res.json.data.total_usage);
  if (total === undefined || used === undefined) return undefined;
  return { amount: Math.max(total - used, 0), unit: 'usd', limit: total, label: '남은 크레딧' };
}

function httpError(ctx: ProviderContext, res: Awaited<ReturnType<ProviderContext['get']>>, management: boolean): ProviderSnapshot | undefined {
  const status = statusFromHttp(res);
  if (!status) return undefined;
  const message = management && res.status === 403
    ? 'management key required'
    : status === 'auth_required' ? 'authentication required' : status;
  return errorSnapshot('openrouter', ctx.now(), status, message, ctx.previous, retryAtFromHeaders(res, ctx.now()));
}

export const openrouterAdapter: ProviderAdapter = {
  id: 'openrouter',
  async fetchSnapshot(ctx) {
    try {
      const now = ctx.now();
      const apiKey = ctx.providerSettings.apiKey;
      if (!apiKey) return errorSnapshot('openrouter', now, 'not_configured', 'API key required', ctx.previous);
      const init = { headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' }, credentials: 'omit' as const };
      const management = ctx.providerSettings.mode === 'management';
      if (management) {
        let daily = 0;
        let weekly = 0;
        let monthly = 0;
        let count = 0;
        let offset = 0;
        for (let page = 0; page < 20; page += 1) {
          const res = await ctx.get(`${ENDPOINT}/keys?include_disabled=true&offset=${offset}`, init);
          const failure = httpError(ctx, res, true);
          if (failure) return failure;
          if (!isRecord(res.json) || !Array.isArray(res.json.data)) return errorSnapshot('openrouter', now, 'schema_changed', 'invalid keys response', ctx.previous);
          const keys = res.json.data;
          if (keys.length === 0) break;
          for (const item of keys) {
            if (!isRecord(item)) return errorSnapshot('openrouter', now, 'schema_changed', 'invalid key entry', ctx.previous);
            const d = amount(item.usage_daily);
            const w = amount(item.usage_weekly);
            const m = amount(item.usage_monthly);
            if (d === undefined || w === undefined || m === undefined) return errorSnapshot('openrouter', now, 'schema_changed', 'missing usage fields', ctx.previous);
            daily += d; weekly += w; monthly += m;
          }
          count += keys.length;
          offset += keys.length;
        }
        return { ...baseSnapshot('openrouter', now), account: `${count} keys`, windows: makeWindows(daily, weekly, monthly), balance: await fetchCredits(ctx, init) };
      }
      const res = await ctx.get(`${ENDPOINT}/key`, init);
      const failure = httpError(ctx, res, false);
      if (failure) return failure;
      if (!isRecord(res.json) || !isRecord(res.json.data)) return errorSnapshot('openrouter', now, 'schema_changed', 'missing key data', ctx.previous);
      const data = res.json.data;
      const daily = amount(data.usage_daily);
      const weekly = amount(data.usage_weekly);
      const monthly = amount(data.usage_monthly);
      if (daily === undefined || weekly === undefined || monthly === undefined) return errorSnapshot('openrouter', now, 'schema_changed', 'missing usage fields', ctx.previous);
      const windows = makeWindows(daily, weekly, monthly);
      const limit = amount(data.limit);
      const remaining = amount(data.limit_remaining);
      if (limit !== undefined && remaining !== undefined) {
        windows.push({ kind: 'budget', label: `키 한도 (${typeof data.limit_reset === 'string' ? data.limit_reset : '리셋 없음'})`, usedAmount: limit - remaining, limitAmount: limit, usedPercent: limit === 0 ? 0 : ((limit - remaining) / limit) * 100, unit: 'usd', periodTz: 'UTC' });
      }
      return { ...baseSnapshot('openrouter', now), account: typeof data.label === 'string' ? data.label : undefined, windows, balance: await fetchCredits(ctx, init) };
    } catch (error) {
      return errorToSnapshot('openrouter', ctx.now(), error, ctx.previous);
    }
  },
};
