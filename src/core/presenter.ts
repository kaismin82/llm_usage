import type {
  AppSettings,
  ProviderId,
  ProviderSnapshot,
  ResetEvent,
  SnapshotStatus,
} from '../providers/types';
import { PROVIDER_IDS } from '../providers/types';
import { availableGrantCount } from './reset-detector';
import type { SchedulerDeps } from './scheduler';
import type { SnapshotMap } from './store';

const SUBSCRIPTION_IDS: ProviderId[] = ['claude', 'chatgpt', 'zai'];

const PROVIDER_NAMES: Record<ProviderId, string> = {
  claude: 'Claude',
  chatgpt: 'ChatGPT',
  zai: 'Z.ai',
  poe: 'Poe',
  litellm: 'LiteLLM',
  openrouter: 'OpenRouter',
};

const GRANT_COLOR = '#7e3af2';
const OK_COLOR = '#16a34a';
const WARN_COLOR = '#f59e0b';
const CRITICAL_COLOR = '#dc2626';
const ALERT_STATUSES: SnapshotStatus[] = ['auth_required', 'challenge', 'schema_changed', 'error'];
const NOTIFYING_TYPES = new Set<ResetEvent['type']>([
  'GRANT_ADDED',
  'GRANT_EXPIRING',
  'WINDOW_RESET_EARLY',
]);
const ICON_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

function percentBadge(percent: number, settings: AppSettings): { text: string; color: string } {
  const rounded = Math.round(percent);
  const color =
    rounded < settings.warnPercent ? OK_COLOR : rounded < settings.criticalPercent ? WARN_COLOR : CRITICAL_COLOR;
  return { text: String(rounded), color };
}

export function computeBadge(snapshots: SnapshotMap, settings: AppSettings): { text: string; color: string } {
  if (settings.badgeMode === 'off') return { text: '', color: '' };

  if (settings.badgeMode === 'grants') {
    const grants = SUBSCRIPTION_IDS.reduce((total, id) => {
      const snapshot = snapshots[id];
      return snapshot === undefined ? total : total + availableGrantCount(snapshot);
    }, 0);
    if (grants > 0) return { text: `R${grants}`, color: GRANT_COLOR };
  }

  let maxPercent: number | undefined;
  for (const id of SUBSCRIPTION_IDS) {
    if (!settings.providers[id]?.enabled) continue;
    const snapshot = snapshots[id];
    if (snapshot === undefined) continue;
    const window =
      snapshot.windows.find((entry) => entry.kind === 'session_5h') ??
      snapshot.windows.find((entry) => entry.kind === 'weekly_7d');
    if (window?.usedPercent !== undefined) {
      maxPercent = maxPercent === undefined ? window.usedPercent : Math.max(maxPercent, window.usedPercent);
    }
  }
  if (maxPercent !== undefined) return percentBadge(maxPercent, settings);

  const alerting = PROVIDER_IDS.some((id) => {
    if (!settings.providers[id]?.enabled) return false;
    const snapshot: ProviderSnapshot | undefined = snapshots[id];
    return snapshot !== undefined && ALERT_STATUSES.includes(snapshot.status);
  });
  return alerting ? { text: '!', color: CRITICAL_COLOR } : { text: '', color: '' };
}

export function notificationFor(event: ResetEvent): { title: string; message: string } {
  const name = PROVIDER_NAMES[event.provider];
  switch (event.type) {
    case 'GRANT_ADDED':
      return { title: `${name} reset 권 추가`, message: '새로운 reset 권이 추가되었습니다.' };
    case 'GRANT_EXPIRING':
      return { title: `${name} reset 권 만료 임박`, message: 'reset 권이 곧 만료됩니다.' };
    case 'GRANT_EXPIRED':
      return { title: `${name} reset 권 만료`, message: 'reset 권이 만료되었습니다.' };
    case 'GRANT_USED':
      return { title: `${name} reset 권 사용`, message: 'reset 권이 사용되었습니다.' };
    case 'WINDOW_RESET_EARLY':
      return { title: `${name} 조기 리셋 감지`, message: '예정보다 일찍 창이 초기화되었습니다.' };
  }
}

export function createPresenter(): SchedulerDeps['present'] {
  return async (snapshots, settings, events) => {
    const badge = computeBadge(snapshots, settings);
    await chrome.action.setBadgeText({ text: badge.text });
    if (badge.text !== '') {
      await chrome.action.setBadgeBackgroundColor({ color: badge.color });
    }
    if (!settings.notifications) return;
    if (!(await chrome.permissions.contains({ permissions: ['notifications'] }))) return;
    for (const event of events) {
      if (!NOTIFYING_TYPES.has(event.type)) continue;
      const { title, message } = notificationFor(event);
      await chrome.notifications.create({ type: 'basic', iconUrl: ICON_URL, title, message });
    }
  };
}
