import type {
  GrantScope,
  GrantStatus,
  ProviderAdapter,
  ProviderContext,
  ResetGrant,
  UsageWindow,
} from './types';
import {
  baseSnapshot,
  epochSecToIso,
  errorSnapshot,
  errorToSnapshot,
  hashId,
  isRecord,
  num,
  retryAtFromHeaders,
  statusFromHttp,
} from './util';

const SESSION_URL = 'https://chatgpt.com/api/auth/session';
const USAGE_URL = 'https://chatgpt.com/backend-api/wham/usage';
const CREDITS_URL = 'https://chatgpt.com/backend-api/wham/rate-limit-reset-credits';
const TOKEN_CACHE_KEY = 'chatgpt:token';
const ACCOUNT_CACHE_KEY = 'chatgpt:account';

class SchemaError extends Error {}

interface Session {
  token: string;
  accountId?: string;
}

function jwtPayload(token: string): Record<string, unknown> | undefined {
  const encoded = token.split('.')[1];
  if (!encoded) return undefined;
  try {
    const base64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=');
    const json = atob(padded);
    const parsed: unknown = JSON.parse(json);
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function accountIdFromSession(body: Record<string, unknown>, payload?: Record<string, unknown>): string | undefined {
  const account = isRecord(body.account) ? body.account : undefined;
  const sessionAccountId = account?.id ?? account?.account_id;
  if (typeof sessionAccountId === 'string') return sessionAccountId;
  const auth = payload?.['https://api.openai.com/auth'];
  if (!isRecord(auth)) return undefined;
  const accountId = auth.chatgpt_account_id;
  return typeof accountId === 'string' ? accountId : undefined;
}

async function clearSessionCache(ctx: ProviderContext): Promise<void> {
  await ctx.cache.set(TOKEN_CACHE_KEY, '');
  await ctx.cache.set(ACCOUNT_CACHE_KEY, '');
}

async function session(ctx: ProviderContext, force = false): Promise<Session | undefined> {
  if (!force) {
    const token = await ctx.cache.get(TOKEN_CACHE_KEY);
    if (token) {
      const cachedAccountId = await ctx.cache.get(ACCOUNT_CACHE_KEY);
      return { token, accountId: cachedAccountId };
    }
  }

  const res = await ctx.get(SESSION_URL, {
    credentials: 'include',
    headers: { Accept: 'application/json' },
  });
  const httpStatus = statusFromHttp(res);
  if (httpStatus) throw new HttpError(httpStatus, 'unable to get chatgpt session', res);
  if (!isRecord(res.json) || typeof res.json.accessToken !== 'string' || !res.json.accessToken) {
    return undefined;
  }

  const token = res.json.accessToken;
  const payload = jwtPayload(token);
  const exp = num(payload?.exp);
  const ttlMs = exp === undefined ? 600_000 : Math.max(0, exp * 1000 - ctx.now().getTime() - 60_000);
  const accountId = accountIdFromSession(res.json, payload);
  await ctx.cache.set(TOKEN_CACHE_KEY, token, ttlMs);
  if (accountId) await ctx.cache.set(ACCOUNT_CACHE_KEY, accountId, ttlMs);
  return { token, accountId };
}

class HttpError extends Error {
  constructor(
    readonly status: ReturnType<typeof statusFromHttp>,
    message: string,
    readonly response: Awaited<ReturnType<ProviderContext['get']>>,
  ) {
    super(message);
  }
}

function usageHeaders(token: string, accountId?: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/json',
    ...(accountId ? { 'ChatGPT-Account-Id': accountId } : {}),
  };
}

function classifyWindow(raw: unknown, now: Date): UsageWindow | undefined {
  if (raw === null || raw === undefined) return undefined;
  if (!isRecord(raw)) throw new SchemaError('invalid usage window');
  const seconds = num(raw.limit_window_seconds);
  if (seconds === undefined) throw new SchemaError('usage window is missing limit_window_seconds');
  if (seconds <= 43_200) return windowFromWithNow(raw, '5시간', 'session_5h', now);
  if (seconds >= 500_000 && seconds <= 700_000) return windowFromWithNow(raw, '7일', 'weekly_7d', now);
  if (seconds >= 1_728_000) return windowFromWithNow(raw, '월간', 'month', now);
  return undefined;
}

function windowFromWithNow(raw: unknown, label: string, kind: UsageWindow['kind'], now: Date): UsageWindow {
  if (!isRecord(raw)) throw new SchemaError('invalid usage window');
  const windowSeconds = num(raw.limit_window_seconds);
  const usedPercent = num(raw.used_percent);
  if (windowSeconds === undefined || usedPercent === undefined) {
    throw new SchemaError('usage window is missing required fields');
  }
  const resetAt = num(raw.reset_at);
  const resetAfter = num(raw.reset_after_seconds);
  return {
    kind,
    label,
    usedPercent,
    unit: 'percent',
    windowSeconds,
    ...(resetAt === undefined
      ? resetAfter === undefined
        ? {}
        : { resetsAt: new Date(now.getTime() + resetAfter * 1000).toISOString() }
      : { resetsAt: epochSecToIso(resetAt) }),
  };
}

function weeklyModelWindows(raw: unknown, now: Date): UsageWindow[] {
  if (!Array.isArray(raw)) return [];
  const windows: UsageWindow[] = [];
  for (const item of raw) {
    if (!isRecord(item) || typeof item.limit_name !== 'string' || !isRecord(item.rate_limit)) continue;
    for (const candidate of [item.rate_limit.primary_window, item.rate_limit.secondary_window]) {
      if (candidate === null || candidate === undefined) continue;
      if (!isRecord(candidate)) throw new SchemaError('invalid model usage window');
      const seconds = num(candidate.limit_window_seconds);
      if (seconds === undefined) throw new SchemaError('model usage window is missing limit_window_seconds');
      if (seconds >= 500_000 && seconds <= 700_000) {
        windows.push(windowFromWithNow(candidate, `7일 · ${item.limit_name}`, 'weekly_model', now));
      }
    }
  }
  return windows;
}

function grantScope(resetType: unknown): GrantScope {
  if (typeof resetType !== 'string') return 'unknown';
  const lower = resetType.toLowerCase();
  if (lower.includes('five') || lower.includes('5h') || lower.includes('session')) return 'session_5h';
  if (lower.includes('week')) return 'weekly_7d';
  return 'unknown';
}

function grantStatus(status: unknown): GrantStatus {
  if (status === 'available') return 'available';
  if (status === 'used' || status === 'consumed' || status === 'redeemed') return 'used';
  if (status === 'expired') return 'expired';
  return 'unknown';
}

async function synthesizeGrants(count: number): Promise<ResetGrant[]> {
  return Promise.all(
    Array.from({ length: count }, async (_, index) => ({
      provider: 'chatgpt',
      idHash: await hashId('chatgpt', `count:${index}`),
      scope: 'unknown',
      remaining: 1,
      status: 'available',
    })),
  );
}

async function credits(
  ctx: ProviderContext,
  availableCount: number,
  headers: Record<string, string>,
): Promise<ResetGrant[]> {
  try {
    const res = await ctx.get(CREDITS_URL, { credentials: 'omit', headers });
    if (statusFromHttp(res) || !isRecord(res.json) || !Array.isArray(res.json.credits)) {
      return synthesizeGrants(availableCount);
    }
    const grants = await Promise.all(
      res.json.credits.flatMap((credit) => {
        if (!isRecord(credit) || (typeof credit.id !== 'string' && typeof credit.id !== 'number')) return [];
        const id = credit.id;
        return [
          (async (): Promise<ResetGrant> => ({
            provider: 'chatgpt',
            idHash: await hashId('chatgpt', id),
            scope: grantScope(credit.reset_type),
            remaining: 1,
            startsAt: typeof credit.granted_at === 'string' ? credit.granted_at : null,
            expiresAt: typeof credit.expires_at === 'string' ? credit.expires_at : null,
            title: typeof credit.title === 'string' ? credit.title : null,
            status: grantStatus(credit.status),
          }))(),
        ];
      }),
    );
    return grants.length > 0 ? grants : synthesizeGrants(availableCount);
  } catch {
    return synthesizeGrants(availableCount);
  }
}

export const chatgptAdapter: ProviderAdapter = {
  id: 'chatgpt',
  async fetchSnapshot(ctx) {
    const now = ctx.now();
    try {
      let currentSession: Session | undefined;
      try {
        currentSession = await session(ctx);
      } catch (error) {
        if (error instanceof HttpError) {
          return errorSnapshot(
            'chatgpt',
            now,
            error.status ?? 'error',
            error.message,
            ctx.previous,
            retryAtFromHeaders(error.response, now),
          );
        }
        throw error;
      }
      if (!currentSession) {
        return errorSnapshot('chatgpt', now, 'auth_required', 'not signed in to chatgpt.com', ctx.previous);
      }

      let accountId = ctx.providerSettings.accountId ?? currentSession.accountId;
      let headers = usageHeaders(currentSession.token, accountId);
      let usage = await ctx.get(USAGE_URL, { credentials: 'omit', headers });
      if (usage.status === 401) {
        await clearSessionCache(ctx);
        try {
          currentSession = await session(ctx, true);
        } catch (error) {
          if (error instanceof HttpError) {
            return errorSnapshot(
              'chatgpt',
              now,
              error.status ?? 'error',
              error.message,
              ctx.previous,
              retryAtFromHeaders(error.response, now),
            );
          }
          throw error;
        }
        if (!currentSession) {
          return errorSnapshot('chatgpt', now, 'auth_required', 'not signed in to chatgpt.com', ctx.previous);
        }
        accountId = ctx.providerSettings.accountId ?? currentSession.accountId;
        headers = usageHeaders(currentSession.token, accountId);
        usage = await ctx.get(USAGE_URL, { credentials: 'omit', headers });
      }

      const httpStatus = statusFromHttp(usage);
      if (httpStatus) {
        return errorSnapshot(
          'chatgpt',
          now,
          httpStatus,
          'unable to get chatgpt usage',
          ctx.previous,
          retryAtFromHeaders(usage, now),
        );
      }
      if (!isRecord(usage.json)) throw new SchemaError('invalid usage response');

      const rateLimit = isRecord(usage.json.rate_limit) ? usage.json.rate_limit : undefined;
      const windows: UsageWindow[] = [];
      if (rateLimit) {
        for (const raw of [rateLimit.primary_window, rateLimit.secondary_window]) {
          const parsed = classifyWindow(raw, now);
          if (parsed && (parsed.kind !== 'session_5h' || ctx.providerSettings.showFiveHour !== false)) {
            windows.push(parsed);
          }
        }
      }
      windows.push(...weeklyModelWindows(usage.json.additional_rate_limits, now));
      if (!rateLimit && windows.length === 0) throw new SchemaError('usage response has no rate limit');

      const snapshot = baseSnapshot('chatgpt', now);
      snapshot.plan = typeof usage.json.plan_type === 'string' ? usage.json.plan_type : undefined;
      snapshot.account = accountId;
      snapshot.windows = windows;

      const resetCredits = usage.json.rate_limit_reset_credits;
      const availableCount = isRecord(resetCredits) && typeof resetCredits.available_count === 'number' && Number.isFinite(resetCredits.available_count)
        ? Math.max(0, Math.floor(resetCredits.available_count))
        : undefined;
      if (availableCount === undefined) {
        snapshot.grantSupport = 'unsupported';
      } else {
        snapshot.grantSupport = 'supported';
        const previousAvailable = ctx.previous?.grants.filter((grant) => grant.status === 'available').length;
        snapshot.grants = availableCount > 0 && (previousAvailable === undefined || previousAvailable !== availableCount)
          ? await credits(ctx, availableCount, headers)
          : ctx.previous?.grants ?? [];
      }
      return snapshot;
    } catch (error) {
      if (error instanceof SchemaError) {
        return errorSnapshot('chatgpt', now, 'schema_changed', error.message, ctx.previous);
      }
      return errorToSnapshot('chatgpt', now, error, ctx.previous);
    }
  },
};
