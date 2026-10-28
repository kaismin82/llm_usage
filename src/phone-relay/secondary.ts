import type { PhonePayload } from './payload';
import type { ProviderSnapshot, ResetGrant, UsageWindow } from '../providers/types';
import { RELAY_READER_URL, getSecondaryConfig, getSecondarySnapshots, saveSecondarySnapshots } from './store';

export const SECONDARY_TIMEOUT_MS = 5000;

type MergedSnapshot = { receivedAt: string | null; data: PhonePayload | null };

/**
 * The relay's merged reader output marks entries from labeled (non-main) slots
 * as `<id>#<label>`. Map them back into ProviderSnapshot-shaped values keyed by label.
 */
export function extractSecondaryProviders(
  providers: PhonePayload['providers'] | undefined,
): Record<string, ProviderSnapshot> {
  const result: Record<string, ProviderSnapshot> = {};
  for (const provider of providers ?? []) {
    const separator = provider.id.indexOf('#');
    if (separator <= 0) continue;
    const base = provider.id.slice(0, separator);
    // Only the Claude subscription becomes a secondary card. Labeled slots may also
    // carry claude_platform (shared admin key); showing that here would replace the
    // subscription windows with the platform's monthly USD window.
    if (base !== 'claude') continue;
    const label = provider.id.slice(separator + 1);
    if (!label || result[label]) continue;
    result[label] = {
      provider: 'claude',
      status: provider.status as ProviderSnapshot['status'],
      windows: provider.windows.map((window) => ({ ...window, kind: window.kind as UsageWindow['kind'], unit: window.unit as UsageWindow['unit'], periodTz: window.periodTz as UsageWindow['periodTz'] })),
      grants: provider.grants.map((grant, index) => ({
        ...grant,
        provider: 'claude' as const,
        idHash: `${provider.id}:${index}`,
        scope: grant.scope as ResetGrant['scope'],
        status: grant.status as ResetGrant['status'],
      })),
      grantSupport: provider.grantSupport as ProviderSnapshot['grantSupport'],
      extraCredits: provider.extraCredits,
      balance: provider.balance,
      fetchedAt: provider.fetchedAt || provider.attemptedAt,
      attemptedAt: provider.attemptedAt,
    };
  }
  return result;
}

export function createSecondaryPoller(deps: {
  getConfig(): Promise<{ enabled: boolean; readToken: string }>;
  hasPermission(): Promise<boolean>;
  fetchImpl: typeof fetch;
  save(snapshots: Record<string, ProviderSnapshot>): Promise<void>;
  now(): Date;
}) {
  let running = false;
  const poll = async (): Promise<void> => {
    if (running) return;
    running = true;
    try {
      const config = await deps.getConfig();
      if (!config.enabled || !config.readToken.trim()) {
        const existing = await getSecondarySnapshots();
        if (Object.keys(existing).length > 0) await deps.save({});
        return;
      }
      if (!(await deps.hasPermission())) return;
      const response = await deps.fetchImpl(RELAY_READER_URL, {
        method: 'GET',
        headers: { Authorization: `Bearer ${config.readToken.trim()}`, Accept: 'application/json' },
        credentials: 'omit',
        cache: 'no-store',
        redirect: 'error',
        signal: AbortSignal.timeout(SECONDARY_TIMEOUT_MS),
      });
      if (!response.ok) return; // Keep the last stored secondary values on failure.
      const merged = (await response.json()) as MergedSnapshot;
      const extracted = extractSecondaryProviders(merged.data?.providers);
      const current = await getSecondarySnapshots();
      if (JSON.stringify(current) !== JSON.stringify(extracted)) await deps.save(extracted);
    } catch {
      // Network/relay unavailable: keep the last stored values; never invent zero usage.
    } finally {
      running = false;
    }
  };
  return { poll };
}

export const secondaryPoller = createSecondaryPoller({
  getConfig: getSecondaryConfig,
  hasPermission: () => chrome.permissions.contains({ origins: ['http://127.0.0.1/*'] }),
  fetchImpl: (input, init) => fetch(input, init),
  save: saveSecondarySnapshots,
  now: () => new Date(),
});
