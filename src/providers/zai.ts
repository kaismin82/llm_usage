import type { ProviderAdapter, ProviderSnapshot, ResetGrant, UsageWindow } from './types';
import { baseSnapshot, epochMsToIso, errorSnapshot, errorToSnapshot, hashId, isRecord, num, retryAtFromHeaders, statusFromHttp } from './util';

function utc8ToIso(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const match = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(value);
  if (!match) return undefined;
  return new Date(`${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}+08:00`).toISOString();
}

function bodyError(body: Record<string, unknown>, now: Date, previous?: ProviderSnapshot): ProviderSnapshot | undefined {
  if (body.success === true) return undefined;
  const code = num(body.code);
  const status = code === 1001 || code === 401 ? 'auth_required' : 'error';
  return errorSnapshot('zai', now, status, typeof body.msg === 'string' ? body.msg : 'Z.ai request failed', previous);
}

export const zaiAdapter: ProviderAdapter = {
  id: 'zai',
  async fetchSnapshot(ctx) {
    try {
      const now = ctx.now();
      const apiKey = ctx.providerSettings.apiKey;
      if (!apiKey) return errorSnapshot('zai', now, 'not_configured', 'API key is required', ctx.previous);
      const host = ctx.providerSettings.region === 'china' ? 'https://open.bigmodel.cn' : 'https://api.z.ai';
      const init = { headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' }, credentials: 'omit' as const };
      const quota = await ctx.get(`${host}/api/monitor/usage/quota/limit`, init);
      const httpStatus = statusFromHttp(quota);
      if (httpStatus) return errorSnapshot('zai', now, httpStatus, `HTTP ${quota.status}`, ctx.previous, retryAtFromHeaders(quota, now));
      if (!isRecord(quota.json)) return errorSnapshot('zai', now, 'schema_changed', 'Invalid quota response', ctx.previous);
      const failure = bodyError(quota.json, now, ctx.previous);
      if (failure) return failure;
      const data = isRecord(quota.json.data) ? quota.json.data : {};
      const rawLimits = data.limits ?? quota.json.limits;
      if (!Array.isArray(rawLimits)) return errorSnapshot('zai', now, 'schema_changed', 'Quota limits missing', ctx.previous);
      const windows: UsageWindow[] = [];
      for (const entry of rawLimits) {
        if (!isRecord(entry)) continue;
        const type = entry.type;
        const unit = num(entry.unit);
        const percentage = num(entry.percentage);
        const reset = num(entry.nextResetTime);
        const resetsAt = reset === undefined ? null : epochMsToIso(reset);
        if ((type === 'TOKENS_LIMIT' || type === 'CREDIT_LIMIT') && unit === 3) {
          windows.push({ kind: 'session_5h', label: '5시간', unit: 'percent', usedPercent: percentage, resetsAt, windowSeconds: 18000 });
        } else if ((type === 'TOKENS_LIMIT' || type === 'CREDIT_LIMIT') && unit === 6) {
          windows.push({ kind: 'weekly_7d', label: '7일', unit: 'percent', usedPercent: percentage, resetsAt, windowSeconds: 604800 });
        } else if (type === 'TIME_LIMIT' && unit === 5) {
          const currentValue = num(entry.currentValue);
          const usage = num(entry.usage);
          const usedPercent = percentage ?? (currentValue !== undefined && usage ? currentValue / usage * 100 : undefined);
          windows.push({ kind: 'monthly_tool', label: 'MCP 월간', unit: 'calls', usedAmount: currentValue, limitAmount: usage, usedPercent, resetsAt });
        }
      }
      if (windows.length === 0) return errorSnapshot('zai', now, 'schema_changed', 'No recognized quota windows', ctx.previous);
      const snapshot = baseSnapshot('zai', now);
      snapshot.plan = typeof data.level === 'string' ? data.level : undefined;
      snapshot.windows = windows;
      snapshot.grantSupport = 'unsupported';
      try {
        const result = await ctx.get(`${host}/api/biz/customer-package-reset/list?targetType=PERSONAL`, init);
        if (statusFromHttp(result) || !isRecord(result.json) || result.json.success !== true) return snapshot;
        const resetData = isRecord(result.json.data) ? result.json.data : {};
        const grants: ResetGrant[] = [];
        for (const [field, scope] of [['fiveHourResets', 'session_5h'], ['weekResets', 'weekly_7d']] as const) {
          const records = resetData[field];
          if (!Array.isArray(records)) continue;
          for (const record of records) {
            if (!isRecord(record) || record.recordId === undefined || typeof record.available !== 'boolean') continue;
            const expiresAt = utc8ToIso(record.expireTime);
            grants.push({ provider: 'zai', idHash: await hashId('zai', `${scope}:${String(record.recordId)}`), scope, remaining: record.available ? 1 : 0, expiresAt: expiresAt ?? null, title: null, status: !record.available ? 'used' : expiresAt && Date.parse(expiresAt) <= now.getTime() ? 'expired' : 'available' });
          }
        }
        snapshot.grants = grants;
        snapshot.grantSupport = 'supported';
      } catch {
        snapshot.grantSupport = 'unsupported';
        snapshot.grants = [];
      }
      return snapshot;
    } catch (error) {
      return errorToSnapshot('zai', ctx.now(), error, ctx.previous);
    }
  },
};
