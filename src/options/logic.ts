import type { ProviderId, ProviderSettings, SnapshotStatus } from '../providers/types';

export function clampInterval(n: number): number {
  const v = Math.round(n);
  if (!Number.isFinite(v) || v < 1) return 1;
  if (v > 60) return 60;
  return v;
}

export function maskKey(k: string | undefined): string {
  if (!k) return '';
  if (k.length <= 8) return '•'.repeat(k.length);
  return k.slice(0, 4) + '•'.repeat(Math.min(k.length - 8, 20)) + k.slice(-4);
}

export function validateProviderSettings(
  id: ProviderId,
  s: ProviderSettings,
): string | null {
  if (id === 'zai' && s.enabled && !s.apiKey) {
    return 'API 키를 입력해주세요.';
  }
  if (id === 'poe' && s.enabled && !s.apiKey) {
    return 'API 키를 입력해주세요.';
  }
  if (id === 'openrouter' && s.enabled && !s.apiKey) {
    return 'API 키를 입력해주세요.';
  }
  if (id === 'litellm') {
    if (s.enabled && !s.baseUrl) {
      return 'Base URL을 입력해주세요.';
    }
    if (s.enabled && s.baseUrl) {
      try {
        const u = new URL(s.baseUrl);
        if (u.protocol !== 'http:' && u.protocol !== 'https:') {
          return '유효한 HTTP(S) URL을 입력해주세요.';
        }
      } catch {
        return '유효한 URL을 입력해주세요.';
      }
    }
    if (s.enabled && !s.apiKey) {
      return 'API 키를 입력해주세요.';
    }
  }
  return null;
}

export function isValidTimezone(tz: string): boolean {
  try {
    Intl.DateTimeFormat(undefined, { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export function statusLabel(status: SnapshotStatus): string {
  const map: Record<SnapshotStatus, string> = {
    ok: '정상',
    stale: '오래됨',
    auth_required: '로그인 필요',
    challenge: '보안 확인 필요',
    rate_limited: '속도 제한',
    schema_changed: 'API 변경 감지',
    permission_missing: '권한 필요',
    not_configured: '미설정',
    unsupported: '미지원',
    error: '오류',
  };
  return map[status] ?? status;
}

export function maskErrorMessage(msg: string | undefined): string {
  if (!msg) return '';
  return msg
    .replace(/Bearer\s+\S+/gi, 'Bearer •••')
    .replace(/sk-[a-zA-Z0-9_-]{4,}/g, 'sk-••••')
    .replace(/key[=:]\s*\S+/gi, 'key=•••');
}

export function formatLastSuccess(iso: string | undefined): string {
  if (!iso) return '없음';
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '없음';
    return d.toLocaleString('ko-KR', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '없음';
  }
}

export const COMMON_TIMEZONES = [
  'Asia/Seoul',
  'Asia/Tokyo',
  'Asia/Shanghai',
  'Asia/Kolkata',
  'Europe/London',
  'Europe/Berlin',
  'Europe/Paris',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'Pacific/Auckland',
  'UTC',
];

export const PROVIDER_DISPLAY: Record<ProviderId, string> = {
  claude: 'Claude',
  chatgpt: 'ChatGPT',
  zai: 'Z.ai',
  poe: 'Poe',
  litellm: 'LiteLLM',
  openrouter: 'OpenRouter',
};

export const PROVIDER_ORDER: ProviderId[] = [
  'claude', 'chatgpt', 'zai', 'poe', 'litellm', 'openrouter',
];

export function needsSessionLogin(id: ProviderId): boolean {
  return id === 'claude' || id === 'chatgpt';
}

export function needsApiKey(id: ProviderId): boolean {
  return id === 'zai' || id === 'poe' || id === 'litellm' || id === 'openrouter';
}
