import { isRecord } from '../providers/util';
import type { ProviderSnapshot } from '../providers/types';

export const RELAY_CONFIG_KEY = 'phoneRelayConfig';
export const RELAY_STATUS_KEY = 'phoneRelayStatus';
export const RELAY_ORIGIN = 'http://127.0.0.1/*';
export const RELAY_ENDPOINT = 'http://127.0.0.1:8770/api/ingest';
export const RELAY_READER_URL = 'http://127.0.0.1:8771/api/snapshot';
export const SECONDARY_CONFIG_KEY = 'claudeSecondaryConfig';
export const SECONDARY_SNAPSHOTS_KEY = 'claudeSecondarySnapshots';
// Bump when the stored secondary shape or its mapping changes. Values written without this marker
// came from older mappings (for example "last entry of the label wins") and are not trusted.
export const SECONDARY_SCHEMA = 2;
export const RELAY_ALARM = 'phone-relay-heartbeat';

export type RelayConfig = { enabled: boolean; writeToken: string; accountLabel: string };
export type SecondaryConfig = { enabled: boolean; readToken: string };
export type SecondarySnapshots = Record<string, ProviderSnapshot>;
export type RelayStatus = {
  attemptedAt: string;
  lastSuccessAt?: string;
  result: 'ok' | 'unavailable' | 'http_error' | 'permission_missing' | 'not_configured';
  httpStatus?: number;
};

export const defaultRelayConfig = (): RelayConfig => ({ enabled: false, writeToken: '', accountLabel: 'main' });
export const defaultSecondaryConfig = (): SecondaryConfig => ({ enabled: false, readToken: '' });

export async function getRelayConfig(): Promise<RelayConfig> {
  const value: unknown = (await chrome.storage.local.get(RELAY_CONFIG_KEY))[RELAY_CONFIG_KEY];
  return isRecord(value) ? {
    enabled: value.enabled === true,
    writeToken: typeof value.writeToken === 'string' ? value.writeToken : '',
    accountLabel: typeof value.accountLabel === 'string' && value.accountLabel ? value.accountLabel : 'main',
  } : defaultRelayConfig();
}

export async function saveRelayConfig(config: RelayConfig): Promise<void> {
  await chrome.storage.local.set({
    [RELAY_CONFIG_KEY]: { enabled: config.enabled, writeToken: config.writeToken.trim(), accountLabel: config.accountLabel.trim() || 'main' },
  });
}

export async function getSecondaryConfig(): Promise<SecondaryConfig> {
  const value: unknown = (await chrome.storage.local.get(SECONDARY_CONFIG_KEY))[SECONDARY_CONFIG_KEY];
  return isRecord(value) ? {
    enabled: value.enabled === true,
    readToken: typeof value.readToken === 'string' ? value.readToken : '',
  } : defaultSecondaryConfig();
}

export async function saveSecondaryConfig(config: SecondaryConfig): Promise<void> {
  await chrome.storage.local.set({
    [SECONDARY_CONFIG_KEY]: { enabled: config.enabled, readToken: config.readToken.trim() },
  });
}

export async function getSecondarySnapshots(): Promise<SecondarySnapshots> {
  const value: unknown = (await chrome.storage.local.get(SECONDARY_SNAPSHOTS_KEY))[SECONDARY_SNAPSHOTS_KEY];
  const result: SecondarySnapshots = {};
  if (!isRecord(value) || value.schema !== SECONDARY_SCHEMA || !isRecord(value.snapshots)) return result;
  for (const [label, snapshot] of Object.entries(value.snapshots)) {
    if (isRecord(snapshot) && snapshot.provider === 'claude' && typeof snapshot.status === 'string' && Array.isArray(snapshot.windows)) {
      result[label] = snapshot as unknown as ProviderSnapshot;
    }
  }
  return result;
}

export async function saveSecondarySnapshots(snapshots: SecondarySnapshots): Promise<void> {
  await chrome.storage.local.set({ [SECONDARY_SNAPSHOTS_KEY]: { schema: SECONDARY_SCHEMA, snapshots } });
}

export async function getRelayStatus(): Promise<RelayStatus | undefined> {
  return (await chrome.storage.local.get(RELAY_STATUS_KEY))[RELAY_STATUS_KEY] as RelayStatus | undefined;
}

export function isPhoneRelayMessage(message: unknown): message is { type: 'phone-relay-send' } {
  return isRecord(message) && message.type === 'phone-relay-send';
}
