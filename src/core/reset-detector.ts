import type { ProviderSnapshot, ResetEvent, ResetGrant, UsageWindow } from '../providers/types';

const SUPPORTED_PROVIDERS = new Set(['claude', 'chatgpt', 'zai']);
const EXPIRING_MS = 48 * 60 * 60 * 1000;
const EARLY_RESET_GRACE_MS = 5 * 60 * 1000;

export function availableGrantCount(snapshot: ProviderSnapshot): number {
  return snapshot.grants
    .filter((grant) => grant.status === 'available')
    .reduce((total, grant) => total + grant.remaining, 0);
}

export function nextGrantExpiry(snapshot: ProviderSnapshot): string | null {
  const expiries = snapshot.grants
    .filter((grant) => grant.status === 'available' && validTime(grant.expiresAt) !== null)
    .map((grant) => grant.expiresAt as string);
  return expiries.sort((a, b) => Date.parse(a) - Date.parse(b))[0] ?? null;
}

export function detectResetEvents(
  prev: ProviderSnapshot | undefined,
  next: ProviderSnapshot,
  now: Date,
  opts?: { firstRun?: boolean },
): ResetEvent[] {
  if (!SUPPORTED_PROVIDERS.has(next.provider) || next.status !== 'ok') return [];

  const at = now.toISOString();
  const firstRun = prev === undefined || opts?.firstRun === true;
  const event = (type: ResetEvent['type'], scope?: string, detail?: string): ResetEvent => ({
    type,
    provider: next.provider,
    ...(scope === undefined ? {} : { scope }),
    at,
    ...(detail === undefined ? {} : { detail }),
  });
  const events: ResetEvent[] = [];
  const previousByHash = new Map(prev?.grants.map((grant) => [grant.idHash, grant]));

  if (!firstRun) {
    for (const grant of next.grants) {
      const previous = previousByHash.get(grant.idHash);
      if (grant.status === 'available' && (previous === undefined || grant.remaining > previous.remaining)) {
        events.push(event('GRANT_ADDED', grant.scope));
      }
    }

    for (const previous of prev.grants) {
      if (previous.status !== 'available') continue;
      const current = next.grants.find((grant) => grant.idHash === previous.idHash);
      const expired = validTime(previous.expiresAt);
      const vanishedBeforeExpiry = current === undefined && (expired === null || expired > now.getTime());
      if (
        (current !== undefined && (current.remaining < previous.remaining || current.status === 'used')) ||
        vanishedBeforeExpiry
      ) {
        events.push(event('GRANT_USED', previous.scope));
      }
      if (expired !== null && expired <= now.getTime()) events.push(event('GRANT_EXPIRED', previous.scope));
    }
  }

  for (const grant of next.grants) {
    if (grant.status !== 'available' || !isWithinExpiryWindow(grant, now.getTime())) continue;
    const previous = previousByHash.get(grant.idHash);
    const previousAttempt = validTime(prev?.attemptedAt);
    const wasExpiring =
      previous?.status === 'available' &&
      previousAttempt !== null &&
      isWithinExpiryWindow(grant, previousAttempt);
    if (!wasExpiring) events.push(event('GRANT_EXPIRING', grant.scope));
  }

  if (!firstRun && !events.some((entry) => entry.type === 'GRANT_USED')) {
    for (const window of matchingWindows(prev.windows, next.windows)) {
      const previousReset = validTime(window.previous.resetsAt);
      if (
        previousReset !== null &&
        now.getTime() < previousReset - EARLY_RESET_GRACE_MS &&
        window.previous.usedPercent !== undefined &&
        window.current.usedPercent !== undefined &&
        window.previous.usedPercent - window.current.usedPercent >= 20
      ) {
        events.push(event('WINDOW_RESET_EARLY', window.current.kind, '조기 리셋 감지(원인 미상)'));
      }
    }
  }

  return events;
}

function validTime(value: string | null | undefined): number | null {
  if (!value) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : null;
}

function isWithinExpiryWindow(grant: ResetGrant, referenceTime: number): boolean {
  const expiry = validTime(grant.expiresAt);
  return expiry !== null && expiry > referenceTime && expiry - referenceTime <= EXPIRING_MS;
}

function matchingWindows(previous: UsageWindow[], current: UsageWindow[]): { previous: UsageWindow; current: UsageWindow }[] {
  return current.flatMap((currentWindow) => {
    const previousWindow = previous.find(
      (candidate) => candidate.kind === currentWindow.kind && candidate.label === currentWindow.label,
    );
    return previousWindow ? [{ previous: previousWindow, current: currentWindow }] : [];
  });
}
