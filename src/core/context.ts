import type {
  AppSettings,
  ProviderCache,
  ProviderContext,
  ProviderId,
  ProviderSnapshot,
} from '../providers/types';
import { isRecord } from '../providers/util';
import { createSafeFetch } from './safe-fetch';
import { createTabBridge } from './tab-bridge';

interface CacheEntry {
  v: string;
  exp?: number;
}

function cacheKey(key: string): string {
  return `cache:${key}`;
}

function readEntry(stored: unknown): string | undefined {
  if (!isRecord(stored)) return undefined;
  if (typeof stored.v !== 'string' || stored.v === '') return undefined;
  if (typeof stored.exp === 'number' && Date.now() >= stored.exp) return undefined;
  return stored.v;
}

function sessionCache(): ProviderCache {
  return {
    get: async (key) => {
      const stored = await chrome.storage.session.get(cacheKey(key));
      return readEntry(stored[cacheKey(key)]);
    },
    set: async (key, value, ttlMs) => {
      const entry: CacheEntry =
        ttlMs === undefined ? { v: value } : { v: value, exp: Date.now() + ttlMs };
      await chrome.storage.session.set({ [cacheKey(key)]: entry });
    },
  };
}

export function createContextFactory(): (
  settings: AppSettings,
  provider: ProviderId,
  previous?: ProviderSnapshot,
) => ProviderContext {
  let get: ProviderContext['get'] | undefined;
  return (settings, provider, previous) => {
    get ??= createSafeFetch({ tabBridge: createTabBridge() });
    return {
      now: () => new Date(),
      settings,
      providerSettings: settings.providers[provider],
      previous,
      get,
      cache: sessionCache(),
    };
  };
}
