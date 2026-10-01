import { defaultSettings } from '../src/core/settings';
import type { AppSettings, ProviderId, ProviderSnapshot, UsageWindow } from '../src/providers/types';
import { PROVIDER_IDS } from '../src/providers/types';
import type { SnapshotMap } from '../src/core/store';

export type Scenario = 'all' | 'errors' | 'empty';

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

function iso(now: Date, offsetMs: number): string {
  return new Date(now.getTime() + offsetMs).toISOString();
}

function percentWindow(
  now: Date,
  kind: UsageWindow['kind'],
  label: string,
  usedPercent: number,
  resetInMs: number,
  windowSeconds: number,
): UsageWindow {
  return { kind, label, usedPercent, unit: 'percent', resetsAt: iso(now, resetInMs), windowSeconds };
}

function costWindows(
  now: Date,
  unit: 'usd' | 'points',
  values: [number, number, number],
  periodTz: 'UTC' | 'local',
  partialMonth = false,
): UsageWindow[] {
  const labels: Array<[UsageWindow['kind'], string]> = [
    ['day', '오늘'],
    ['week', '이번주'],
    ['month', '이번달'],
  ];
  return labels.map(([kind, label], index) => ({
    kind,
    label,
    unit,
    usedAmount: values[index],
    periodTz,
    resetsAt: null,
    ...(partialMonth && kind === 'month' ? { partial: true } : {}),
  }));
}

function base(provider: ProviderId, now: Date): ProviderSnapshot {
  const at = now.toISOString();
  return { provider, status: 'ok', windows: [], grants: [], grantSupport: 'n/a', fetchedAt: at, attemptedAt: at };
}

function healthy(now: Date): Record<ProviderId, ProviderSnapshot> {
  const claude: ProviderSnapshot = {
    ...base('claude', now),
    plan: 'Max 20x',
    grantSupport: 'supported',
    windows: [
      percentWindow(now, 'session_5h', '5시간', 68, 2 * HOUR + 13 * MIN, 18000),
      percentWindow(now, 'weekly_7d', '7일', 31, 4 * DAY + 3 * HOUR, 604800),
      percentWindow(now, 'weekly_model', '7일 · Opus', 12, 4 * DAY + 3 * HOUR, 604800),
      percentWindow(now, 'weekly_model', '7일 · Sonnet', 40, 4 * DAY + 3 * HOUR, 604800),
      { kind: 'month', label: 'Extra usage', unit: 'usd', usedAmount: 12.5, limitAmount: 100, usedPercent: 12.5, resetsAt: null },
    ],
    grants: [
      {
        provider: 'claude',
        idHash: 'dev-claude-grant-1',
        scope: 'all',
        remaining: 1,
        startsAt: iso(now, -9 * DAY),
        expiresAt: iso(now, 21 * DAY),
        title: 'Opus launch reset',
        status: 'available',
      },
    ],
  };
  const chatgpt: ProviderSnapshot = {
    ...base('chatgpt', now),
    plan: 'plus',
    grantSupport: 'supported',
    windows: [
      percentWindow(now, 'weekly_7d', '7일', 52, 3 * DAY + 9 * HOUR, 604800),
      percentWindow(now, 'session_5h', '5시간', 10, 3 * HOUR + 40 * MIN, 18000),
    ],
    grants: [
      {
        provider: 'chatgpt',
        idHash: 'dev-chatgpt-grant-1',
        scope: 'unknown',
        remaining: 1,
        expiresAt: iso(now, 12 * DAY),
        title: 'Usage limits reset',
        status: 'available',
      },
    ],
  };
  const zai: ProviderSnapshot = {
    ...base('zai', now),
    plan: 'PRO',
    grantSupport: 'supported',
    windows: [
      percentWindow(now, 'session_5h', '5시간', 47, HOUR + 5 * MIN, 18000),
      percentWindow(now, 'weekly_7d', '7일', 18, 4 * DAY, 604800),
      { kind: 'monthly_tool', label: 'MCP 월간', unit: 'calls', usedAmount: 38, limitAmount: 100, usedPercent: 38, resetsAt: iso(now, 20 * DAY) },
    ],
    grants: [
      {
        provider: 'zai',
        idHash: 'dev-zai-grant-1',
        scope: 'session_5h',
        remaining: 1,
        expiresAt: iso(now, 37 * DAY),
        title: null,
        status: 'available',
      },
    ],
  };
  const openrouter: ProviderSnapshot = {
    ...base('openrouter', now),
    account: 'dev key',
    windows: costWindows(now, 'usd', [1.23, 4.56, 12.34], 'UTC'),
    balance: { amount: 40.95, unit: 'usd', limit: 1420, label: '남은 크레딧' },
  };
  const litellm: ProviderSnapshot = {
    ...base('litellm', now),
    account: 'team-key',
    windows: [
      ...costWindows(now, 'usd', [0.8, 3.1, 9.9], 'UTC'),
    ],
    balance: { amount: 37.71, unit: 'usd', limit: 50, label: '남은 예산', resetsAt: iso(now, 12 * DAY) },
  };
  const poe: ProviderSnapshot = {
    ...base('poe', now),
    windows: costWindows(now, 'points', [1200, 8400, 31000], 'local', true),
    balance: { amount: 104018, unit: 'points', label: '남은 포인트' },
  };
  return { claude, chatgpt, zai, poe, litellm, openrouter };
}

function failing(now: Date): Record<ProviderId, ProviderSnapshot> {
  const ok = healthy(now);
  const staleAt = iso(now, -47 * MIN);
  const errorOf = (snapshot: ProviderSnapshot, status: ProviderSnapshot['status'], message: string): ProviderSnapshot => ({
    ...snapshot,
    status,
    fetchedAt: staleAt,
    error: { code: status, message },
  });
  return {
    claude: errorOf(ok.claude, 'auth_required', 'not signed in to claude.ai'),
    chatgpt: errorOf(ok.chatgpt, 'challenge', 'Cloudflare challenge'),
    zai: errorOf(ok.zai, 'schema_changed', 'no recognizable windows'),
    poe: ok.poe,
    litellm: errorOf(ok.litellm, 'rate_limited', 'HTTP 429'),
    openrouter: { ...base('openrouter', now), status: 'not_configured', error: { code: 'not_configured', message: 'API key required' } },
  };
}

export function buildSnapshots(scenario: Scenario, now: Date): SnapshotMap {
  if (scenario === 'empty') return {};
  return scenario === 'errors' ? failing(now) : healthy(now);
}

export function buildSettings(scenario: Scenario): AppSettings {
  const settings = defaultSettings();
  if (scenario === 'empty') return settings;
  for (const id of PROVIDER_IDS) settings.providers[id] = { ...settings.providers[id], enabled: true };
  settings.providers.litellm.baseUrl = 'https://litellm.example.com';
  return settings;
}

export function parseScenario(search: string): Scenario {
  const value = new URLSearchParams(search).get('scenario');
  return value === 'errors' || value === 'empty' ? value : 'all';
}
