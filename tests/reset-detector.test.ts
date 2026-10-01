import { describe, expect, it } from 'vitest';
import { availableGrantCount, detectResetEvents, nextGrantExpiry } from '../src/core/reset-detector';
import type { ProviderSnapshot, ResetGrant, UsageWindow } from '../src/providers/types';

const now = new Date('2026-10-01T12:00:00.000Z');

function grant(overrides: Partial<ResetGrant> = {}): ResetGrant {
  return {
    provider: 'claude',
    idHash: 'grant-1',
    scope: 'all',
    remaining: 1,
    expiresAt: '2026-10-10T12:00:00.000Z',
    status: 'available',
    ...overrides,
  };
}

function snapshot(overrides: Partial<ProviderSnapshot> = {}): ProviderSnapshot {
  return {
    provider: 'claude',
    status: 'ok',
    windows: [],
    grants: [],
    grantSupport: 'supported',
    fetchedAt: '2026-10-01T11:00:00.000Z',
    attemptedAt: '2026-10-01T11:00:00.000Z',
    ...overrides,
  };
}

function window(overrides: Partial<UsageWindow> = {}): UsageWindow {
  return { kind: 'session_5h', label: '5 hour', usedPercent: 80, unit: 'percent', ...overrides };
}

describe('reset detector', () => {
  it('counts available grants and finds their earliest expiry', () => {
    const current = snapshot({
      grants: [
        grant({ remaining: 2, expiresAt: '2026-10-03T12:00:00.000Z' }),
        grant({ idHash: 'used', remaining: 4, status: 'used', expiresAt: '2026-10-02T12:00:00.000Z' }),
        grant({ idHash: 'earliest', expiresAt: '2026-10-02T12:00:00.000Z' }),
      ],
    });
    expect(availableGrantCount(current)).toBe(3);
    expect(nextGrantExpiry(current)).toBe('2026-10-02T12:00:00.000Z');
  });

  it('keeps first-run inventory silent except for expiring grants', () => {
    const events = detectResetEvents(
      undefined,
      snapshot({ grants: [grant({ expiresAt: '2026-10-02T11:00:00.000Z' })] }),
      now,
    );
    expect(events.map((event) => event.type)).toEqual(['GRANT_EXPIRING']);
  });

  it('detects added and used grants', () => {
    const previous = snapshot({ grants: [grant({ remaining: 2 })] });
    const current = snapshot({
      grants: [grant({ remaining: 1 }), grant({ idHash: 'new-grant', scope: 'weekly_7d' })],
    });
    expect(detectResetEvents(previous, current, now).map((event) => event.type)).toEqual([
      'GRANT_ADDED',
      'GRANT_USED',
    ]);
  });

  it('reports an expiring grant only when it crosses the 48-hour threshold', () => {
    const expiringGrant = grant({ expiresAt: '2026-10-02T12:00:00.000Z' });
    const previous = snapshot({ attemptedAt: '2026-09-29T11:00:00.000Z', grants: [expiringGrant] });
    const current = snapshot({ grants: [expiringGrant] });
    expect(detectResetEvents(previous, current, now).map((event) => event.type)).toEqual(['GRANT_EXPIRING']);

    const later = snapshot({ attemptedAt: now.toISOString(), grants: [expiringGrant] });
    expect(detectResetEvents(current, later, new Date('2026-10-01T13:00:00.000Z'))).toEqual([]);
  });

  it('reports previously available grants that have expired', () => {
    const previous = snapshot({ grants: [grant({ expiresAt: '2026-10-01T11:00:00.000Z' })] });
    expect(detectResetEvents(previous, snapshot(), now).map((event) => event.type)).toEqual(['GRANT_EXPIRED']);
  });

  it('detects an early window reset but not a natural rollover', () => {
    const earlyPrevious = snapshot({
      windows: [window({ resetsAt: '2026-10-01T15:00:00.000Z' })],
    });
    const current = snapshot({ windows: [window({ usedPercent: 50 })] });
    expect(detectResetEvents(earlyPrevious, current, now)).toMatchObject([
      { type: 'WINDOW_RESET_EARLY', detail: '조기 리셋 감지(원인 미상)' },
    ]);

    const rolloverPrevious = snapshot({
      windows: [window({ resetsAt: '2026-10-01T12:03:00.000Z' })],
    });
    expect(detectResetEvents(rolloverPrevious, current, now)).toEqual([]);
  });

  it('does not emit events for non-ok snapshots', () => {
    expect(detectResetEvents(snapshot(), snapshot({ status: 'schema_changed' }), now)).toEqual([]);
  });
});
