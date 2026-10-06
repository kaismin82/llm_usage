export type ProviderId = 'claude' | 'chatgpt' | 'zai' | 'poe' | 'litellm' | 'openrouter';

export const PROVIDER_IDS: ProviderId[] = ['claude', 'chatgpt', 'zai', 'poe', 'litellm', 'openrouter'];

export type WindowKind =
  | 'session_5h'
  | 'weekly_7d'
  | 'weekly_model'
  | 'monthly_tool'
  | 'day'
  | 'week'
  | 'month'
  | 'budget';

export type WindowUnit = 'percent' | 'usd' | 'points' | 'calls' | 'tokens';

export interface UsageWindow {
  kind: WindowKind;
  label: string;
  usedPercent?: number;
  usedAmount?: number;
  limitAmount?: number;
  unit: WindowUnit;
  resetsAt?: string | null;
  windowSeconds?: number;
  periodTz?: 'UTC' | 'local' | 'Asia/Shanghai';
  partial?: boolean;
}

export type GrantScope = 'session_5h' | 'weekly_7d' | 'all' | 'unknown';
export type GrantStatus = 'available' | 'paused' | 'not_yet' | 'used' | 'expired' | 'unknown';

export interface ResetGrant {
  provider: 'claude' | 'chatgpt' | 'zai';
  idHash: string;
  scope: GrantScope;
  remaining: number;
  startsAt?: string | null;
  expiresAt?: string | null;
  title?: string | null;
  status: GrantStatus;
  /** Count-only fallback without a verified individual credit identity. */
  countOnly?: boolean;
}

export type SnapshotStatus =
  | 'ok'
  | 'stale'
  | 'auth_required'
  | 'challenge'
  | 'rate_limited'
  | 'schema_changed'
  | 'permission_missing'
  | 'not_configured'
  | 'unsupported'
  | 'error';

export type GrantSupport = 'supported' | 'not_eligible' | 'unsupported' | 'n/a';

export interface ProviderSnapshot {
  provider: ProviderId;
  status: SnapshotStatus;
  plan?: string;
  account?: string;
  windows: UsageWindow[];
  grants: ResetGrant[];
  grantSupport: GrantSupport;
  balance?: { amount: number; unit: 'usd' | 'points'; limit?: number; label?: string; resetsAt?: string | null };
  fetchedAt: string;
  attemptedAt: string;
  error?: { code: string; message: string; retryAt?: string };
}

export type ResetEventType =
  | 'GRANT_ADDED'
  | 'GRANT_USED'
  | 'GRANT_EXPIRING'
  | 'GRANT_EXPIRED'
  | 'WINDOW_RESET_EARLY';

export interface ResetEvent {
  type: ResetEventType;
  provider: ProviderId;
  scope?: string;
  at: string;
  detail?: string;
}

export interface HttpResult {
  status: number;
  headers: Record<string, string>;
  text: string;
  json: unknown;
  challenge: boolean;
}

export interface HttpRequestInit {
  headers?: Record<string, string>;
  credentials?: 'include' | 'omit';
  timeoutMs?: number;
}

export interface ProviderSettings {
  enabled: boolean;
  intervalMin: number;
  apiKey?: string;
  baseUrl?: string;
  region?: 'global' | 'china';
  mode?: 'key' | 'management' | 'user' | 'admin';
  headerName?: string;
  usageTypeFilter?: 'all' | 'api' | 'chat';
  showFiveHour?: boolean;
  orgId?: string;
  accountId?: string;
}

export interface AppSettings {
  providers: Record<ProviderId, ProviderSettings>;
  timezone: string;
  weekStart: 0 | 1;
  badgeMode: 'maxPercent' | 'grants' | 'off';
  notifications: boolean;
  warnPercent: number;
  criticalPercent: number;
}

export interface ProviderCache {
  get(key: string): Promise<string | undefined>;
  set(key: string, value: string, ttlMs?: number): Promise<void>;
}

export interface ProviderContext {
  now(): Date;
  settings: AppSettings;
  providerSettings: ProviderSettings;
  get(url: string, init?: HttpRequestInit): Promise<HttpResult>;
  cache: ProviderCache;
  previous?: ProviderSnapshot;
}

export interface ProviderAdapter {
  id: ProviderId;
  fetchSnapshot(ctx: ProviderContext): Promise<ProviderSnapshot>;
}
