import { describe, it, expect } from 'vitest';
import {
  formatRelative,
  formatAbsolute,
  percentTone,
  formatPoints,
  formatUsd,
  formatAgo,
  availableGrantCount,
  nextGrantExpiry,
} from '../src/popup/format';
import type { ProviderSnapshot, ResetGrant } from '../src/providers/types';

const now = new Date('2026-10-01T14:00:00+09:00');

function snap(grants: Partial<ResetGrant>[]): ProviderSnapshot {
  return {
    provider: 'claude',
    status: 'ok',
    windows: [],
    grants: grants.map((g) => ({
      provider: 'claude',
      idHash: 'h',
      scope: 'all',
      remaining: 1,
      status: 'available',
      ...g,
    })),
    grantSupport: 'supported',
    fetchedAt: now.toISOString(),
    attemptedAt: now.toISOString(),
  };
}

describe('formatRelative', () => {
  it('returns 곧 for less than a minute', () => {
    const target = new Date(now.getTime() + 30_000).toISOString();
    expect(formatRelative(target, now)).toBe('곧');
  });

  it('returns minutes', () => {
    const target = new Date(now.getTime() + 5 * 60_000).toISOString();
    expect(formatRelative(target, now)).toBe('5분 뒤');
  });

  it('returns hours and minutes', () => {
    const target = new Date(now.getTime() + (2 * 60 + 13) * 60_000).toISOString();
    expect(formatRelative(target, now)).toBe('2시간 13분 뒤');
  });

  it('returns hours only when no remainder', () => {
    const target = new Date(now.getTime() + 3 * 60 * 60_000).toISOString();
    expect(formatRelative(target, now)).toBe('3시간 뒤');
  });

  it('returns days and hours', () => {
    const target = new Date(now.getTime() + (3 * 24 + 4) * 60 * 60_000).toISOString();
    expect(formatRelative(target, now)).toBe('3일 4시간 뒤');
  });

  it('returns days only when no remainder hours', () => {
    const target = new Date(now.getTime() + 2 * 24 * 60 * 60_000).toISOString();
    expect(formatRelative(target, now)).toBe('2일 뒤');
  });

  it('returns 지남 for past times', () => {
    const target = new Date(now.getTime() - 60_000).toISOString();
    expect(formatRelative(target, now)).toBe('지남');
  });

  it('returns empty string for invalid iso', () => {
    expect(formatRelative('not-a-date', now)).toBe('');
  });
});

describe('formatAbsolute', () => {
  it('returns HH:mm for same day', () => {
    const d = new Date(now);
    d.setHours(16, 15, 0, 0);
    expect(formatAbsolute(d.toISOString(), now)).toBe('16:15');
  });

  it('returns M/DD(요일) HH:mm for different day', () => {
    const d = new Date('2026-10-06T09:00:00+09:00');
    const result = formatAbsolute(d.toISOString(), now);
    expect(result).toMatch(/10\/06\(.+\) 09:00/);
  });

  it('returns empty string for invalid iso', () => {
    expect(formatAbsolute('bad', now)).toBe('');
  });
});

describe('percentTone', () => {
  it('returns ok below warn', () => {
    expect(percentTone(50, 70, 90)).toBe('ok');
  });

  it('returns warn at warn boundary', () => {
    expect(percentTone(70, 70, 90)).toBe('warn');
  });

  it('returns warn between warn and crit', () => {
    expect(percentTone(85, 70, 90)).toBe('warn');
  });

  it('returns crit at crit boundary', () => {
    expect(percentTone(90, 70, 90)).toBe('crit');
  });

  it('returns crit between crit and 100', () => {
    expect(percentTone(95, 70, 90)).toBe('crit');
  });

  it('returns full at 100', () => {
    expect(percentTone(100, 70, 90)).toBe('full');
  });

  it('returns full above 100', () => {
    expect(percentTone(110, 70, 90)).toBe('full');
  });
});

describe('formatPoints', () => {
  it('shows plain number below 1000', () => {
    expect(formatPoints(950)).toBe('950');
  });

  it('shows k with decimal for 1000-9999', () => {
    expect(formatPoints(1200)).toBe('1.2k');
  });

  it('drops trailing .0 in k range', () => {
    expect(formatPoints(2000)).toBe('2k');
  });

  it('shows whole k for 10000+', () => {
    expect(formatPoints(31000)).toBe('31k');
  });

  it('shows M for millions', () => {
    expect(formatPoints(1_500_000)).toBe('1.5M');
  });

  it('handles zero', () => {
    expect(formatPoints(0)).toBe('0');
  });

  it('handles negative', () => {
    expect(formatPoints(-1200)).toBe('-1.2k');
  });
});

describe('formatUsd', () => {
  it('shows two decimals normally', () => {
    expect(formatUsd(1.23)).toBe('$1.23');
  });

  it('shows four decimals below $0.01', () => {
    expect(formatUsd(0.0045)).toBe('$0.0045');
  });

  it('handles zero', () => {
    expect(formatUsd(0)).toBe('$0.00');
  });

  it('handles negative', () => {
    expect(formatUsd(-5.5)).toBe('-$5.50');
  });

  it('shows $0.00 for non-finite', () => {
    expect(formatUsd(NaN)).toBe('$0.00');
  });
});

describe('formatAgo', () => {
  it('returns 방금 for very recent', () => {
    const t = new Date(now.getTime() - 10_000).toISOString();
    expect(formatAgo(t, now)).toBe('방금');
  });

  it('returns minutes', () => {
    const t = new Date(now.getTime() - 5 * 60_000).toISOString();
    expect(formatAgo(t, now)).toBe('5분 전');
  });

  it('returns hours', () => {
    const t = new Date(now.getTime() - 2 * 60 * 60_000).toISOString();
    expect(formatAgo(t, now)).toBe('2시간 전');
  });

  it('returns days', () => {
    const t = new Date(now.getTime() - 3 * 24 * 60 * 60_000).toISOString();
    expect(formatAgo(t, now)).toBe('3일 전');
  });

  it('returns 방금 for future times', () => {
    const t = new Date(now.getTime() + 60_000).toISOString();
    expect(formatAgo(t, now)).toBe('방금');
  });

  it('returns empty string for invalid iso', () => {
    expect(formatAgo('nope', now)).toBe('');
  });
});

describe('availableGrantCount', () => {
  it('sums remaining of available grants', () => {
    expect(availableGrantCount(snap([
      { remaining: 2, status: 'available' },
      { remaining: 1, status: 'available' },
      { remaining: 3, status: 'used' },
    ]))).toBe(3);
  });

  it('returns 0 when no available grants', () => {
    expect(availableGrantCount(snap([{ status: 'expired' }]))).toBe(0);
  });
});

describe('nextGrantExpiry', () => {
  it('returns soonest expiry of available grants', () => {
    const s = snap([
      { status: 'available', expiresAt: '2026-10-20T00:00:00Z' },
      { status: 'available', expiresAt: '2026-10-10T00:00:00Z' },
      { status: 'used', expiresAt: '2026-10-05T00:00:00Z' },
    ]);
    expect(nextGrantExpiry(s)).toBe('2026-10-10T00:00:00Z');
  });

  it('returns null when no available grants with expiry', () => {
    expect(nextGrantExpiry(snap([{ status: 'available', expiresAt: null }]))).toBeNull();
  });

  it('returns null for empty grants', () => {
    expect(nextGrantExpiry(snap([]))).toBeNull();
  });
});
