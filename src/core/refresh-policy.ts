import type { ProviderSnapshot } from '../providers/types';

export const REFRESH_COOLDOWN_MS = 60_000;
export const TAB_LOAD_RETRY_MS = 300_000;

/**
 * A finished page load of the provider's site is the recovery signal for a provider that is not
 * ok (including a challenge the user just cleared): retry now instead of waiting out its
 * backoff, at most once per TAB_LOAD_RETRY_MS.
 */
export function shouldRetryOnTabLoad(status: ProviderSnapshot['status'], lastPollAt: number | undefined, nowMs: number): boolean {
  if (status !== 'auth_required' && status !== 'challenge' && status !== 'error') return false;
  return nowMs - (lastPollAt ?? 0) >= TAB_LOAD_RETRY_MS;
}

type Attempted = Pick<ProviderSnapshot, 'attemptedAt'>;

export function needsRefreshOnOpen(
  snapshot: ProviderSnapshot | undefined,
  intervalMin: number,
  nowMs: number,
): boolean {
  return !snapshot || nowMs - Date.parse(snapshot.attemptedAt) > intervalMin * 60_000;
}

/**
 * Targets for an explicit refresh message. A single-provider request (연결 테스트,
 * popup open) is a direct user action and must bypass REFRESH_COOLDOWN_MS — the
 * cooldown protects scheduled cadence, and swallowing an explicit test left the
 * options UI waiting until its 20s timeout with no attempt at all.
 * A whole-set refresh keeps the cooldown.
 */
export function selectRefreshTargets(
  message: { provider?: string },
  settings: { providers: Record<string, { enabled: boolean }> },
  snapshots: Record<string, { attemptedAt: string } | undefined>,
  nowMs: number,
): string[] {
  const explicit = message.provider;
  if (explicit !== undefined) return [explicit];
  return Object.entries(settings.providers)
    .filter(([, provider]) => provider.enabled)
    .map(([id]) => id)
    .filter((id) => !withinCooldown(snapshots[id], nowMs));
}

export function withinCooldown(snapshot: Attempted | undefined, nowMs: number): boolean {
  if (!snapshot) return false;
  return nowMs - Date.parse(snapshot.attemptedAt) < REFRESH_COOLDOWN_MS;
}
