import type { AppSettings, ProviderId, ProviderSettings } from '../providers/types';
import { PROVIDER_IDS } from '../providers/types';

const DEFAULT_INTERVALS: Record<ProviderId, number> = {
  claude: 3,
  chatgpt: 3,
  zai: 3,
  poe: 10,
  litellm: 15,
  openrouter: 10,
};

const MIN_INTERVALS: Partial<Record<ProviderId, number>> = { litellm: 10 };

export function minIntervalFor(id: ProviderId): number {
  return MIN_INTERVALS[id] ?? 1;
}

function defaultProvider(id: ProviderId): ProviderSettings {
  return { enabled: false, intervalMin: DEFAULT_INTERVALS[id] };
}

export function defaultSettings(): AppSettings {
  const providers = Object.fromEntries(
    PROVIDER_IDS.map((id) => [id, defaultProvider(id)]),
  ) as Record<ProviderId, ProviderSettings>;
  providers.zai.region = 'global';
  providers.poe.usageTypeFilter = 'all';
  providers.chatgpt.showFiveHour = true;
  providers.openrouter.mode = 'key';
  providers.litellm.mode = 'user';
  return {
    providers,
    timezone: 'Asia/Seoul',
    weekStart: 1,
    badgeMode: 'maxPercent',
    notifications: false,
    warnPercent: 70,
    criticalPercent: 90,
  };
}

export function mergeSettings(stored: Partial<AppSettings> | undefined): AppSettings {
  const base = defaultSettings();
  if (!stored) return base;
  const providers = { ...base.providers };
  for (const id of PROVIDER_IDS) {
    const merged = { ...base.providers[id], ...(stored.providers?.[id] ?? {}) };
    providers[id] = { ...merged, intervalMin: Math.max(merged.intervalMin, minIntervalFor(id)) };
  }
  return { ...base, ...stored, providers };
}
