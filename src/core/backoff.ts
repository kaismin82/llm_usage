import type { SnapshotStatus } from '../providers/types';

export interface BackoffOptions {
  baseMs?: number;
  maxMs?: number;
}

export function backoffDelayMs(failures: number, opts: BackoffOptions = {}): number {
  if (failures <= 0) return 0;
  const baseMs = opts.baseMs ?? 60_000;
  const maxMs = opts.maxMs ?? 1_800_000;
  return Math.min(baseMs * 2 ** (failures - 1), maxMs);
}

export function nextAttemptAt(
  now: Date,
  intervalMin: number,
  status: SnapshotStatus,
  failures: number,
  retryAtIso?: string,
): Date | null {
  const intervalMs = intervalMin * 60_000;
  switch (status) {
    case 'ok':
    case 'stale':
      return new Date(now.getTime() + intervalMs);
    case 'auth_required':
    case 'not_configured':
    case 'permission_missing':
    case 'unsupported':
      return null;
    case 'rate_limited': {
      const retryAt = retryAtIso ? new Date(retryAtIso).getTime() : Number.NaN;
      const backoffAt = now.getTime() + Math.min(backoffDelayMs(failures), 3_600_000);
      return new Date(Number.isNaN(retryAt) ? backoffAt : Math.max(retryAt, backoffAt));
    }
    case 'error':
    case 'challenge':
    case 'schema_changed':
      return new Date(now.getTime() + Math.max(intervalMs, backoffDelayMs(failures)));
  }
}
