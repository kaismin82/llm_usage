import { describe, expect, it } from 'vitest';
import { periodBounds, sumInBounds } from '../src/core/periods';

describe('periodBounds', () => {
  it('uses Asia/Seoul calendar boundaries', () => {
    const bounds = periodBounds(new Date('2026-10-01T12:00:00Z'), 'Asia/Seoul', 1);

    expect(bounds.day.start.toISOString()).toBe('2026-09-30T15:00:00.000Z');
    expect(bounds.day.end.toISOString()).toBe('2026-10-01T15:00:00.000Z');
    expect(bounds.week.start.toISOString()).toBe('2026-09-27T15:00:00.000Z');
    expect(bounds.month.start.toISOString()).toBe('2026-09-30T15:00:00.000Z');
  });

  it('uses UTC boundaries at month end', () => {
    const bounds = periodBounds(new Date('2026-01-31T23:59:59Z'), 'UTC', 1);

    expect(bounds.day.start.toISOString()).toBe('2026-01-31T00:00:00.000Z');
    expect(bounds.day.end.toISOString()).toBe('2026-02-01T00:00:00.000Z');
    expect(bounds.month.end.toISOString()).toBe('2026-02-01T00:00:00.000Z');
  });

  it('keeps New York day lengths correct across DST', () => {
    const bounds = periodBounds(new Date('2026-03-08T16:00:00Z'), 'America/New_York', 0);

    expect(bounds.day.start.toISOString()).toBe('2026-03-08T05:00:00.000Z');
    expect(bounds.day.end.toISOString()).toBe('2026-03-09T04:00:00.000Z');
    expect(bounds.day.end.getTime() - bounds.day.start.getTime()).toBe(23 * 60 * 60 * 1000);
    expect(bounds.week.start.toISOString()).toBe('2026-03-08T05:00:00.000Z');
  });

  it('honors Sunday and Monday week starts', () => {
    const now = new Date('2026-10-01T12:00:00Z');

    expect(periodBounds(now, 'UTC', 0).week.start.toISOString()).toBe('2026-09-27T00:00:00.000Z');
    expect(periodBounds(now, 'UTC', 1).week.start.toISOString()).toBe('2026-09-28T00:00:00.000Z');
  });
});

describe('sumInBounds', () => {
  it('sums only entries inside the half-open bounds', () => {
    const start = new Date('2026-10-01T00:00:00Z');
    const end = new Date('2026-10-02T00:00:00Z');

    expect(sumInBounds([
      { time: start.getTime() - 1, points: 10 },
      { time: start.getTime(), points: 2 },
      { time: end.getTime() - 1, points: 3 },
      { time: end.getTime(), points: 20 },
    ], { start, end })).toBe(5);
  });
});
