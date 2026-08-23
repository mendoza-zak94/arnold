import { describe, expect, it } from 'vitest';
import { addDays, dateLabel, dayIn, daysAgo, daysBetween, hourIn, isDay, timeIn, weekdayIn } from '../lib/time';

describe('dayIn', () => {
  it('uses the user timezone, not the server one', () => {
    // 23:30 UTC is already the next day in Berlin. Serverless runs in UTC, the
    // user eats in Berlin, and the entry belongs to the user's calendar.
    const late = new Date('2026-03-10T23:30:00Z');
    expect(dayIn('UTC', late)).toBe('2026-03-10');
    expect(dayIn('Europe/Berlin', late)).toBe('2026-03-11');
  });

  it('handles a timezone behind UTC', () => {
    const early = new Date('2026-03-11T02:00:00Z');
    expect(dayIn('America/New_York', early)).toBe('2026-03-10');
  });
});

describe('timeIn and hourIn', () => {
  it('formats a 24 hour local clock', () => {
    expect(timeIn('Europe/Berlin', new Date('2026-06-01T07:05:00Z'))).toBe('09:05');
  });

  it('reads the local hour, which is what decides a fasted weigh-in', () => {
    expect(hourIn('Europe/Berlin', new Date('2026-06-01T07:05:00Z'))).toBe(9);
    expect(hourIn('UTC', new Date('2026-06-01T07:05:00Z'))).toBe(7);
  });
});

describe('weekdayIn', () => {
  it('returns 0 for Sunday', () => {
    expect(weekdayIn('UTC', new Date('2026-08-23T12:00:00Z'))).toBe(0);
    expect(weekdayIn('UTC', new Date('2026-08-24T12:00:00Z'))).toBe(1);
  });

  it('can differ from the UTC weekday', () => {
    const sundayLate = new Date('2026-08-23T23:30:00Z');
    expect(weekdayIn('UTC', sundayLate)).toBe(0);
    expect(weekdayIn('Europe/Berlin', sundayLate)).toBe(1);
  });
});

describe('date arithmetic', () => {
  it('adds and subtracts days across a month boundary', () => {
    expect(addDays('2026-01-31', 1)).toBe('2026-02-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('survives a daylight saving change', () => {
    // In Berlin, 2026-03-29 is 23 hours long. Naive hour arithmetic lands on
    // the wrong day here; string arithmetic does not.
    expect(addDays('2026-03-28', 2)).toBe('2026-03-30');
  });

  it('counts whole days in both directions', () => {
    expect(daysBetween('2026-01-01', '2026-01-08')).toBe(7);
    expect(daysBetween('2026-01-08', '2026-01-01')).toBe(-7);
    expect(daysBetween('2026-01-01', '2026-01-01')).toBe(0);
  });

  it('daysAgo walks back from today in the user timezone', () => {
    const at = new Date('2026-08-23T10:00:00Z');
    expect(daysAgo('Europe/Berlin', 7, at)).toBe('2026-08-16');
  });
});

describe('dateLabel', () => {
  it('spells out the weekday for the prompt', () => {
    expect(dateLabel('UTC', new Date('2026-08-23T12:00:00Z'))).toBe('Sunday, 2026-08-23');
  });
});

describe('isDay', () => {
  it('accepts YYYY-MM-DD and nothing else', () => {
    expect(isDay('2026-08-23')).toBe(true);
    expect(isDay('23.08.2026')).toBe(false);
    expect(isDay(undefined)).toBe(false);
    expect(isDay(20260823)).toBe(false);
  });
});
