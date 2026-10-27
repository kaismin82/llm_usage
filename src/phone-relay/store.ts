import { isRecord } from '../providers/util';

export const RELAY_CONFIG_KEY = 'phoneRelayConfig';
export const RELAY_STATUS_KEY = 'phoneRelayStatus';
export const RELAY_ORIGIN = 'http://127.0.0.1/*';
export const RELAY_ENDPOINT = 'http://127.0.0.1:8770/api/ingest';
export const RELAY_ALARM = 'phone-relay-heartbeat';

export type RelayConfig = { enabled: boolean; writeToken: string };
export type RelayStatus = {
  attemptedAt: string;
  lastSuccessAt?: string;
  result: 'ok' | 'unavailable' | 'http_error' | 'permission_missing' | 'not_configured';
  httpStatus?: number;
};

export const defaultRelayConfig = (): RelayConfig => ({ enabled: false, writeToken: '' });

export async function getRelayConfig(): Promise<RelayConfig> {
  const value: unknown = (await chrome.storage.local.get(RELAY_CONFIG_KEY))[RELAY_CONFIG_KEY];
  return isRecord(value) ? {
    enabled: value.enabled === true,
    writeToken: typeof value.writeToken === 'string' ? value.writeToken : '',
  } : defaultRelayConfig();
}

export async function saveRelayConfig(config: RelayConfig): Promise<void> {
  await chrome.storage.local.set({
    [RELAY_CONFIG_KEY]: { enabled: config.enabled, writeToken: config.writeToken.trim() },
  });
}

export async function getRelayStatus(): Promise<RelayStatus | undefined> {
  return (await chrome.storage.local.get(RELAY_STATUS_KEY))[RELAY_STATUS_KEY] as RelayStatus | undefined;
}

export function isPhoneRelayMessage(message: unknown): message is { type: 'phone-relay-send' } {
  return isRecord(message) && message.type === 'phone-relay-send';
}
