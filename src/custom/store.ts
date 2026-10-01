import type { SnapshotStatus, UsageWindow } from '../providers/types';
import { isRecord } from '../providers/util';
import { isCustomProvider, validateCustomProvider } from './config';
import { CUSTOM_UNITS, CustomConfigError } from './types';
import type { CustomProviderConfig, CustomSchedule, CustomSnapshot } from './types';

export const CUSTOM_PROVIDERS_KEY = 'customProviders';
export const customSnapshotKey = (id: string): string => `customSnapshot:${id}`;
export const customScheduleKey = (id: string): string => `customSchedule:${id}`;

type CustomStorage = {
  get(keys: string | string[]): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string | string[]): Promise<void>;
};

const STATUSES: readonly SnapshotStatus[] = [
  'ok', 'stale', 'auth_required', 'challenge', 'rate_limited', 'schema_changed',
  'permission_missing', 'not_configured', 'unsupported', 'error',
];

function isWindow(value: unknown): value is UsageWindow {
  return isRecord(value) && value.kind === 'budget' && typeof value.label === 'string'
    && CUSTOM_UNITS.some((unit) => unit === value.unit)
    && ['usedAmount', 'limitAmount', 'usedPercent'].every((key) =>
      value[key] === undefined || (typeof value[key] === 'number' && Number.isFinite(value[key])))
    && (value.resetsAt === undefined || value.resetsAt === null || typeof value.resetsAt === 'string');
}

function isSnapshot(value: unknown): value is CustomSnapshot {
  if (!isRecord(value)) return false;
  const balance = value.balance;
  const error = value.error;
  return typeof value.provider === 'string' && STATUSES.some((status) => status === value.status)
    && typeof value.fetchedAt === 'string' && typeof value.attemptedAt === 'string'
    && Array.isArray(value.windows) && value.windows.every(isWindow)
    && (balance === undefined || (isRecord(balance) && typeof balance.amount === 'number'
      && Number.isFinite(balance.amount) && (balance.unit === 'usd' || balance.unit === 'points')))
    && (error === undefined || (isRecord(error) && typeof error.code === 'string' && typeof error.message === 'string'));
}

export function createCustomStore(storage: CustomStorage = chrome.storage.local) {
  const getProviders = async (): Promise<CustomProviderConfig[]> => {
    const stored = (await storage.get(CUSTOM_PROVIDERS_KEY))[CUSTOM_PROVIDERS_KEY];
    if (stored === undefined) return [];
    if (!Array.isArray(stored) || !stored.every(isCustomProvider)) {
      throw new CustomConfigError('저장된 custom provider 설정 형식을 확인해주세요');
    }
    return stored;
  };
  const getSnapshot = async (id: string): Promise<CustomSnapshot | undefined> => {
    const value = (await storage.get(customSnapshotKey(id)))[customSnapshotKey(id)];
    return isSnapshot(value) ? value : undefined;
  };
  const getSchedule = async (id: string): Promise<CustomSchedule | undefined> => {
    const value = (await storage.get(customScheduleKey(id)))[customScheduleKey(id)];
    if (isRecord(value) && (value.nextDueAt === null || typeof value.nextDueAt === 'string')
      && typeof value.failures === 'number' && Number.isFinite(value.failures)) {
      return { nextDueAt: value.nextDueAt, failures: value.failures };
    }
    return undefined;
  };
  return {
    getProviders, getSnapshot, getSchedule,
    async saveProvider(provider: CustomProviderConfig): Promise<void> {
      const error = validateCustomProvider(provider);
      if (error) throw new CustomConfigError(error);
      const providers = await getProviders();
      const other = providers.filter((p) => p.id !== provider.id);
      await storage.set({ [CUSTOM_PROVIDERS_KEY]: [...other, provider] });
      await storage.remove(customScheduleKey(provider.id));
    },
    async deleteProvider(id: string): Promise<void> {
      const providers = await getProviders();
      await storage.set({ [CUSTOM_PROVIDERS_KEY]: providers.filter((p) => p.id !== id) });
      await storage.remove([customSnapshotKey(id), customScheduleKey(id)]);
    },
    async saveResult(snapshot: CustomSnapshot, schedule: CustomSchedule): Promise<void> {
      await storage.set({
        [customSnapshotKey(snapshot.provider)]: snapshot,
        [customScheduleKey(snapshot.provider)]: schedule,
      });
    },
    async getSnapshots(providers: readonly CustomProviderConfig[]): Promise<Record<string, CustomSnapshot>> {
      const snapshots = await Promise.all(providers.map((p) => getSnapshot(p.id)));
      return Object.fromEntries(snapshots.flatMap((snapshot) => snapshot ? [[snapshot.provider, snapshot]] : []));
    },
  };
}

export type CustomStore = ReturnType<typeof createCustomStore>;

export async function requestCustomRefresh(id?: string): Promise<void> {
  const response: unknown = await chrome.runtime.sendMessage({ type: 'custom-refresh', ...(id ? { id } : {}) });
  if (!isRecord(response) || response.ok !== true) throw new CustomConfigError('Custom provider 백그라운드 응답을 확인해주세요');
}

export async function notifyCustomChanged(id: string): Promise<void> {
  const response: unknown = await chrome.runtime.sendMessage({ type: 'custom-settings-changed', id });
  if (!isRecord(response) || response.ok !== true) throw new CustomConfigError('Custom provider 백그라운드 응답을 확인해주세요');
}
