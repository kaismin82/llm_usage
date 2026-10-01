import { describe, expect, it } from 'vitest';
import type {
  AppSettings,
  ProviderId,
  ProviderSnapshot,
  ResetEvent,
  UsageWindow,
} from '../src/providers/types';
import { baseSnapshot } from '../src/providers/util';
import { defaultSettings } from '../src/core/settings';
import { computeBadge, notificationFor } from '../src/core/presenter';
import type { SnapshotMap } from '../src/core/store';

const NOW = new Date('2026-10-01T12:00:00.000Z');

function settingsWith(overrides: Partial<AppSettings> = {}, enabled: ProviderId[] = ['claude', 'chatgpt', 'zai']): AppSettings {
  const settings = defaultSettings();
  for (const id of enabled) {
    settings.providers[id] = { ...settings.providers[id], enabled: true };
  }
  return { ...settings, ...overrides };
}

function snapshotFor(provider: ProviderId, overrides: Partial<ProviderSnapshot> = {}): ProviderSnapshot {
  return { ...baseSnapshot(provider, NOW), ...overrides };
}

function percentWindow(kind: 'session_5h' | 'weekly_7d', usedPercent: number): UsageWindow {
  return { kind, label: kind, unit: 'percent', usedPercent };
}

function grantFor(remaining: number, status: 'available' | 'used' = 'available'): ProviderSnapshot['grants'][number] {
  return { provider: 'claude', idHash: `hash-${remaining}-${status}`, scope: 'session_5h', remaining, status };
}

function eventFor(type: ResetEvent['type'], provider: ProviderId = 'claude'): ResetEvent {
  return { type, provider, at: NOW.toISOString() };
}

describe('computeBadge', () => {
  it('shows nothing when badges are off', () => {
    const snapshots: SnapshotMap = { claude: snapshotFor('claude', { grants: [grantFor(1)] }) };
    expect(computeBadge(snapshots, settingsWith({ badgeMode: 'off' }))).toEqual({ text: '', color: '' });
  });

  it('counts available grants across claude, chatgpt and zai in grants mode', () => {
    const snapshots: SnapshotMap = {
      claude: snapshotFor('claude', { grants: [grantFor(1), grantFor(1)] }),
      chatgpt: snapshotFor('chatgpt', { grants: [grantFor(3, 'used')] }),
      zai: snapshotFor('zai', { grants: [grantFor(2)] }),
      poe: snapshotFor('poe'),
    };
    expect(computeBadge(snapshots, settingsWith({ badgeMode: 'grants' }))).toEqual({
      text: 'R4',
      color: '#7e3af2',
    });
  });

  it('falls through to percent mode when no grant is available', () => {
    const snapshots: SnapshotMap = {
      claude: snapshotFor('claude', { grants: [grantFor(1, 'used')], windows: [percentWindow('session_5h', 68)] }),
    };
    expect(computeBadge(snapshots, settingsWith({ badgeMode: 'grants' }))).toEqual({
      text: '68',
      color: '#16a34a',
    });
  });

  it('colors the max subscription percent by the warn and critical thresholds', () => {
    const cases: Array<[number, string, string]> = [
      [69, '#16a34a', '69'],
      [70, '#f59e0b', '70'],
      [89, '#f59e0b', '89'],
      [90, '#dc2626', '90'],
    ];
    for (const [percent, color, text] of cases) {
      const snapshots: SnapshotMap = { claude: snapshotFor('claude', { windows: [percentWindow('session_5h', percent)] }) };
      expect(computeBadge(snapshots, settingsWith())).toEqual({ text, color });
    }
  });

  it('rounds the percent before comparing thresholds', () => {
    const snapshots: SnapshotMap = { claude: snapshotFor('claude', { windows: [percentWindow('session_5h', 89.6)] }) };
    expect(computeBadge(snapshots, settingsWith())).toEqual({ text: '90', color: '#dc2626' });
  });

  it('takes the maximum over enabled subscription providers', () => {
    const snapshots: SnapshotMap = {
      claude: snapshotFor('claude', { windows: [percentWindow('session_5h', 40)] }),
      chatgpt: snapshotFor('chatgpt', { windows: [percentWindow('session_5h', 85)] }),
      zai: snapshotFor('zai', { windows: [percentWindow('session_5h', 10)] }),
    };
    expect(computeBadge(snapshots, settingsWith())).toEqual({ text: '85', color: '#f59e0b' });
  });

  it('prefers the 5h window and falls back to the weekly window', () => {
    const both: SnapshotMap = { claude: snapshotFor('claude', { windows: [percentWindow('weekly_7d', 80), percentWindow('session_5h', 30)] }) };
    expect(computeBadge(both, settingsWith({}, ['claude']))).toEqual({ text: '30', color: '#16a34a' });

    const weeklyOnly: SnapshotMap = { zai: snapshotFor('zai', { windows: [percentWindow('weekly_7d', 60)] }) };
    expect(computeBadge(weeklyOnly, settingsWith({}, ['zai']))).toEqual({ text: '60', color: '#16a34a' });
  });

  it('ignores disabled providers', () => {
    const snapshots: SnapshotMap = {
      claude: snapshotFor('claude', { windows: [percentWindow('session_5h', 95)] }),
      chatgpt: snapshotFor('chatgpt', { windows: [percentWindow('session_5h', 99)] }),
    };
    expect(computeBadge(snapshots, settingsWith({}, ['claude']))).toEqual({ text: '95', color: '#dc2626' });
  });

  it.each(['auth_required', 'challenge', 'schema_changed', 'error'] as const)(
    'shows an alert badge for %s snapshots without a percent',
    (status) => {
      const snapshots: SnapshotMap = { claude: snapshotFor('claude', { status }) };
      expect(computeBadge(snapshots, settingsWith())).toEqual({ text: '!', color: '#dc2626' });
    },
  );

  it('shows no alert badge for non-error statuses', () => {
    for (const status of ['ok', 'rate_limited', 'not_configured'] as const) {
      const snapshots: SnapshotMap = { claude: snapshotFor('claude', { status }) };
      expect(computeBadge(snapshots, settingsWith())).toEqual({ text: '', color: '' });
    }
    expect(computeBadge({}, settingsWith())).toEqual({ text: '', color: '' });
  });
});

describe('notificationFor', () => {
  it('returns Korean copy for every event type', () => {
    expect(notificationFor(eventFor('GRANT_ADDED'))).toEqual({
      title: 'Claude reset 권 추가',
      message: '새로운 reset 권이 추가되었습니다.',
    });
    expect(notificationFor(eventFor('GRANT_EXPIRING'))).toEqual({
      title: 'Claude reset 권 만료 임박',
      message: 'reset 권이 곧 만료됩니다.',
    });
    expect(notificationFor(eventFor('GRANT_EXPIRED'))).toEqual({
      title: 'Claude reset 권 만료',
      message: 'reset 권이 만료되었습니다.',
    });
    expect(notificationFor(eventFor('GRANT_USED'))).toEqual({
      title: 'Claude reset 권 사용',
      message: 'reset 권이 사용되었습니다.',
    });
    expect(notificationFor(eventFor('WINDOW_RESET_EARLY'))).toEqual({
      title: 'Claude 조기 리셋 감지',
      message: '예정보다 일찍 창이 초기화되었습니다.',
    });
  });

  it('names the provider that emitted the event', () => {
    expect(notificationFor(eventFor('GRANT_ADDED', 'chatgpt')).title).toContain('ChatGPT');
    expect(notificationFor(eventFor('GRANT_EXPIRING', 'zai')).title).toContain('Z.ai');
  });
});
