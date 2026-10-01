import type {
  HttpResult,
  ProviderId,
  ProviderSnapshot,
  SnapshotStatus,
} from './types';

export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function num(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  return undefined;
}

export function epochSecToIso(seconds: number): string {
  return new Date(seconds * 1000).toISOString();
}

export function epochMsToIso(ms: number): string {
  return new Date(ms).toISOString();
}

export async function hashId(provider: ProviderId, raw: string | number): Promise<string> {
  const data = new TextEncoder().encode(`${provider}:${String(raw)}`);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export function baseSnapshot(provider: ProviderId, now: Date): ProviderSnapshot {
  const iso = now.toISOString();
  return {
    provider,
    status: 'ok',
    windows: [],
    grants: [],
    grantSupport: 'n/a',
    fetchedAt: iso,
    attemptedAt: iso,
  };
}

export function errorSnapshot(
  provider: ProviderId,
  now: Date,
  status: SnapshotStatus,
  message: string,
  previous?: ProviderSnapshot,
  retryAt?: string,
): ProviderSnapshot {
  return {
    provider,
    status,
    plan: previous?.plan,
    account: previous?.account,
    windows: previous?.windows ?? [],
    grants: previous?.grants ?? [],
    grantSupport: previous?.grantSupport ?? 'n/a',
    balance: previous?.balance,
    fetchedAt: previous?.fetchedAt ?? now.toISOString(),
    attemptedAt: now.toISOString(),
    error: { code: status, message, ...(retryAt ? { retryAt } : {}) },
  };
}

export function statusFromHttp(res: HttpResult): SnapshotStatus | null {
  if (res.challenge) return 'challenge';
  if (res.status === 401 || res.status === 403) return 'auth_required';
  if (res.status === 429) return 'rate_limited';
  if (res.status >= 500) return 'error';
  if (res.status < 200 || res.status >= 300) return 'error';
  return null;
}

export function retryAtFromHeaders(res: HttpResult, now: Date): string | undefined {
  const raw = res.headers['retry-after'];
  const seconds = raw === undefined ? undefined : num(raw);
  return seconds === undefined ? undefined : new Date(now.getTime() + seconds * 1000).toISOString();
}

export function errorToSnapshot(
  provider: ProviderId,
  now: Date,
  e: unknown,
  previous?: ProviderSnapshot,
): ProviderSnapshot {
  const message = e instanceof Error ? e.message : String(e);
  return errorSnapshot(provider, now, 'error', message, previous);
}
