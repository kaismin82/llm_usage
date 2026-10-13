import type { ProviderSnapshot } from '../providers/types';

export const REFRESH_COOLDOWN_MS = 60_000;

export function needsRefreshOnOpen(
  snapshot: ProviderSnapshot | undefined,
  intervalMin: number,
  nowMs: number,
): boolean {
  return !snapshot || nowMs - Date.parse(snapshot.attemptedAt) > intervalMin * 60_000;
}

export function withinCooldown(snapshot: ProviderSnapshot | undefined, nowMs: number): boolean {
  if (!snapshot) return false;
  return nowMs - Date.parse(snapshot.attemptedAt) < REFRESH_COOLDOWN_MS;
}
