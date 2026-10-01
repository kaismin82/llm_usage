export interface PeriodBounds {
  start: Date;
  end: Date;
}

export interface CalendarBounds {
  day: PeriodBounds;
  week: PeriodBounds;
  month: PeriodBounds;
}

type CalendarDate = { year: number; month: number; day: number };

const dateFormatters = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  let value = dateFormatters.get(timeZone);
  if (!value) {
    value = new Intl.DateTimeFormat('en-US', {
      timeZone,
      calendar: 'gregory',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
    });
    dateFormatters.set(timeZone, value);
  }
  return value;
}

function calendarDate(at: Date, timeZone: string): CalendarDate {
  const parts = formatter(timeZone).formatToParts(at);
  const values: Partial<Record<'year' | 'month' | 'day', number>> = {};
  for (const part of parts) {
    if (part.type === 'year' || part.type === 'month' || part.type === 'day') {
      values[part.type] = Number(part.value);
    }
  }
  if (values.year === undefined || values.month === undefined || values.day === undefined) {
    throw new Error(`Could not determine calendar date for ${timeZone}`);
  }
  return { year: values.year, month: values.month, day: values.day };
}

function compareDate(left: CalendarDate, right: CalendarDate): number {
  if (left.year !== right.year) return left.year - right.year;
  if (left.month !== right.month) return left.month - right.month;
  return left.day - right.day;
}

function addDays(date: CalendarDate, days: number): CalendarDate {
  const value = new Date(Date.UTC(date.year, date.month - 1, date.day + days));
  return {
    year: value.getUTCFullYear(),
    month: value.getUTCMonth() + 1,
    day: value.getUTCDate(),
  };
}

function startOfDate(date: CalendarDate, timeZone: string): Date {
  const center = Date.UTC(date.year, date.month - 1, date.day);
  let low = center - 36 * 60 * 60 * 1000;
  let high = center + 36 * 60 * 60 * 1000;
  while (low < high) {
    const middle = low + Math.floor((high - low) / 2);
    if (compareDate(calendarDate(new Date(middle), timeZone), date) < 0) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }
  return new Date(low);
}

function boundsFor(startDate: CalendarDate, endDate: CalendarDate, timeZone: string): PeriodBounds {
  return { start: startOfDate(startDate, timeZone), end: startOfDate(endDate, timeZone) };
}

export function periodBounds(now: Date, timeZone: string, weekStart: 0 | 1): CalendarBounds {
  const today = calendarDate(now, timeZone);
  const localWeekday = new Date(Date.UTC(today.year, today.month - 1, today.day)).getUTCDay();
  const weekOffset = (localWeekday - weekStart + 7) % 7;
  const monthStart = { year: today.year, month: today.month, day: 1 };
  const nextMonth = today.month === 12
    ? { year: today.year + 1, month: 1, day: 1 }
    : { year: today.year, month: today.month + 1, day: 1 };

  return {
    day: boundsFor(today, addDays(today, 1), timeZone),
    week: boundsFor(addDays(today, -weekOffset), addDays(today, 7 - weekOffset), timeZone),
    month: boundsFor(monthStart, nextMonth, timeZone),
  };
}

export function sumInBounds(
  entries: { time: number; points: number }[],
  bounds: PeriodBounds,
): number {
  const start = bounds.start.getTime();
  const end = bounds.end.getTime();
  return entries.reduce(
    (sum, entry) => sum + (entry.time >= start && entry.time < end ? entry.points : 0),
    0,
  );
}
