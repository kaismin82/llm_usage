import { describe, expect, it } from 'vitest';
import { backoffDelayMs, nextAttemptAt } from '../src/core/backoff';

describe('backoffDelayMs', () => {
  it('doubles from the first failure and caps deterministically', () => {
    expect(backoffDelayMs(0)).toBe(0);
    expect(backoffDelayMs(-1)).toBe(0);
    expect(backoffDelayMs(1)).toBe(60_000);
    expect(backoffDelayMs(2)).toBe(120_000);
    expect(backoffDelayMs(8)).toBe(1_800_000);
    expect(backoffDelayMs(3, { baseMs: 100, maxMs: 250 })).toBe(250);
  });
});

describe('nextAttemptAt', () => {
  const now = new Date('2026-10-01T12:00:00.000Z');

  it('schedules successful snapshots by their configured interval', () => {
    expect(nextAttemptAt(now, 3, 'ok', 0)?.toISOString()).toBe('2026-10-01T12:03:00.000Z');
    expect(nextAttemptAt(now, 3, 'stale', 0)?.toISOString()).toBe('2026-10-01T12:03:00.000Z');
  });

  it.each(['auth_required', 'not_configured', 'permission_missing', 'unsupported'] as const)(
    'pauses %s snapshots',
    (status) => {
      expect(nextAttemptAt(now, 3, status, 1)).toBeNull();
    },
  );

  it('uses the later retry time for rate limits and caps its backoff at one hour', () => {
    expect(nextAttemptAt(now, 1, 'rate_limited', 1, '2026-10-01T12:05:00.000Z')?.toISOString()).toBe(
      '2026-10-01T12:05:00.000Z',
    );
    expect(nextAttemptAt(now, 1, 'rate_limited', 20)?.toISOString()).toBe('2026-10-01T12:30:00.000Z');
  });

  it.each(['error', 'challenge', 'schema_changed'] as const)(
    'uses the longer interval or backoff for %s snapshots',
    (status) => {
      expect(nextAttemptAt(now, 3, status, 3)?.toISOString()).toBe('2026-10-01T12:04:00.000Z');
    },
  );
});
