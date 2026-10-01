import type { AppSettings, ProviderId, ProviderSnapshot, ResetEvent } from '../providers/types';
import { mergeSettings } from './settings';

export const STORAGE_KEYS = {
  settings: 'settings',
  snapshots: 'snapshots',
  events: 'resetEvents',
  grantHashes: 'grantHashes',
} as const;

export type SnapshotMap = Partial<Record<ProviderId, ProviderSnapshot>>;

export type ExtensionMessage = { type: 'refresh'; provider?: ProviderId } | { type: 'settings-changed' };

export async function getSettings(): Promise<AppSettings> {
  const r = await chrome.storage.local.get(STORAGE_KEYS.settings);
  return mergeSettings(r[STORAGE_KEYS.settings] as Partial<AppSettings> | undefined);
}

export async function saveSettings(settings: AppSettings): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEYS.settings]: settings });
}

export async function getSnapshots(): Promise<SnapshotMap> {
  const r = await chrome.storage.local.get(STORAGE_KEYS.snapshots);
  return (r[STORAGE_KEYS.snapshots] as SnapshotMap | undefined) ?? {};
}

export async function saveSnapshot(snapshot: ProviderSnapshot): Promise<void> {
  const all = await getSnapshots();
  all[snapshot.provider] = snapshot;
  await chrome.storage.local.set({ [STORAGE_KEYS.snapshots]: all });
}

export async function getEvents(): Promise<ResetEvent[]> {
  const r = await chrome.storage.local.get(STORAGE_KEYS.events);
  return (r[STORAGE_KEYS.events] as ResetEvent[] | undefined) ?? [];
}

export async function appendEvents(events: ResetEvent[], keep = 200): Promise<void> {
  if (events.length === 0) return;
  const existing = await getEvents();
  await chrome.storage.local.set({ [STORAGE_KEYS.events]: [...existing, ...events].slice(-keep) });
}

export function onStoreChange(cb: () => void): () => void {
  const listener = (_changes: unknown, area: string) => {
    if (area === 'local') cb();
  };
  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}

export async function requestRefresh(provider?: ProviderId): Promise<void> {
  const message: ExtensionMessage = { type: 'refresh', provider };
  await chrome.runtime.sendMessage(message);
}

export async function notifySettingsChanged(): Promise<void> {
  const message: ExtensionMessage = { type: 'settings-changed' };
  await chrome.runtime.sendMessage(message);
}
