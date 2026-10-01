import type { ResetGrant, ProviderSnapshot } from '../providers/types';

const DAYS_KO = ['일', '월', '화', '수', '목', '금', '토'] as const;

export function formatRelative(iso: string, now: Date): string {
  const target = Date.parse(iso);
  if (!Number.isFinite(target)) return '';
  const diffMs = target - now.getTime();
  if (diffMs < 0) return '지남';
  const totalMin = Math.floor(diffMs / 60_000);
  if (totalMin < 1) return '곧';
  if (totalMin < 60) return `${totalMin}분 뒤`;
  const hours = Math.floor(totalMin / 60);
  const mins = totalMin % 60;
  if (hours < 24) {
    return mins > 0 ? `${hours}시간 ${mins}분 뒤` : `${hours}시간 뒤`;
  }
  const days = Math.floor(hours / 24);
  const remHours = hours % 24;
  return remHours > 0 ? `${days}일 ${remHours}시간 뒤` : `${days}일 뒤`;
}

export function formatAbsolute(iso: string, now: Date): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  const hhmm = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  if (sameDay) return hhmm;
  const dayName = DAYS_KO[d.getDay()];
  return `${d.getMonth() + 1}/${pad(d.getDate())}(${dayName}) ${hhmm}`;
}

export function percentTone(
  p: number,
  warn: number,
  crit: number,
): 'ok' | 'warn' | 'crit' | 'full' {
  if (p >= 100) return 'full';
  if (p >= crit) return 'crit';
  if (p >= warn) return 'warn';
  return 'ok';
}

export function formatPoints(n: number): string {
  if (!Number.isFinite(n)) return '0';
  const abs = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  if (abs < 1_000) return `${sign}${Math.round(abs)}`;
  if (abs < 10_000) {
    const v = abs / 1_000;
    return `${sign}${v.toFixed(1).replace(/\.0$/, '')}k`;
  }
  if (abs < 1_000_000) return `${sign}${Math.round(abs / 1_000)}k`;
  const v = abs / 1_000_000;
  return `${sign}${v.toFixed(1).replace(/\.0$/, '')}M`;
}

export function formatUsd(n: number): string {
  if (!Number.isFinite(n)) return '$0.00';
  const abs = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  if (abs < 0.01 && abs > 0) return `${sign}$${abs.toFixed(4)}`;
  return `${sign}$${abs.toFixed(2)}`;
}

export function formatAgo(iso: string, now: Date): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  const diffMs = now.getTime() - t;
  if (diffMs < 0) return '방금';
  const totalMin = Math.floor(diffMs / 60_000);
  if (totalMin < 1) return '방금';
  if (totalMin < 60) return `${totalMin}분 전`;
  const hours = Math.floor(totalMin / 60);
  if (hours < 24) return `${hours}시간 전`;
  const days = Math.floor(hours / 24);
  return `${days}일 전`;
}

export function availableGrantCount(snapshot: ProviderSnapshot): number {
  return snapshot.grants
    .filter((g) => g.status === 'available')
    .reduce((sum, g) => sum + g.remaining, 0);
}

export function nextGrantExpiry(snapshot: ProviderSnapshot): string | null {
  const expiries = snapshot.grants
    .filter((g) => g.status === 'available' && g.expiresAt != null && Number.isFinite(Date.parse(g.expiresAt)))
    .map((g) => g.expiresAt as string);
  return expiries.sort((a, b) => Date.parse(a) - Date.parse(b))[0] ?? null;
}

export const STATUS_LABELS: Record<string, string> = {
  auth_required: '로그인 필요',
  challenge: 'Cloudflare 확인 필요',
  rate_limited: '요청 제한',
  schema_changed: 'API 변경 감지',
  permission_missing: '권한 필요',
  not_configured: '설정 필요',
  unsupported: '미지원',
  error: '오류',
};

export const PROVIDER_LABELS: Record<string, string> = {
  claude: 'Claude',
  chatgpt: 'ChatGPT',
  zai: 'Z.ai',
  poe: 'Poe',
  litellm: 'LiteLLM',
  openrouter: 'OpenRouter',
};

export function formatShortDate(iso: string): string {
  const date = new Date(iso);
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

export function formatShortAbsolute(iso: string, now: Date): string {
  const date = new Date(iso);
  const time = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();
  return sameDay ? time : `${date.getMonth() + 1}/${date.getDate()} ${time}`;
}
