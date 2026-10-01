import { describe, expect, it } from 'vitest';
import { formatShortAbsolute, formatShortDate } from '../src/popup/format';

describe('short date helpers', () => {
  const now = new Date(2026, 9, 1, 8, 30);

  it('formats a date without the year or weekday', () => {
    expect(formatShortDate(new Date(2026, 9, 22, 16, 0).toISOString())).toBe('10/22');
    expect(formatShortDate(new Date(2026, 0, 5, 1, 0).toISOString())).toBe('1/5');
  });

  it('shows only the time for the same day', () => {
    expect(formatShortAbsolute(new Date(2026, 9, 1, 10, 5).toISOString(), now)).toBe('10:05');
  });

  it('shows month/day and time for other days', () => {
    expect(formatShortAbsolute(new Date(2026, 9, 5, 11, 6).toISOString(), now)).toBe('10/5 11:06');
  });
});
