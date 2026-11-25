import { describe, it, expect } from 'vitest';

import { atDay, dayOf, readMoment, type Comparison, type Moment } from '../../../../src/shared/query/moment';

const atMoment = (time: number, comparison: Comparison, moment: Moment, now: number): boolean => atDay(time, comparison, dayOf(moment, now));

const now = new Date(2026, 10, 25, 15, 30).getTime();
const at = (day: number, hour = 12, month = 10): number => new Date(2026, month, day, hour).getTime();

describe('readMoment', () => {
  it('reads a calendar date, and refuses one the calendar does not have', () => {
    expect(readMoment('2026-11-01')).toEqual({ kind: 'date', year: 2026, month: 11, day: 1 });
    expect(readMoment('2026-02-30')).toBeNull();
  });

  it('reads today, a named day and a count of days or weeks from today', () => {
    expect(readMoment('today')).toEqual({ kind: 'today', days: 0 });
    expect(readMoment('yesterday')).toEqual({ kind: 'today', days: -1 });
    expect(readMoment('tomorrow')).toEqual({ kind: 'today', days: 1 });
    expect(readMoment('today-30d')).toEqual({ kind: 'today', days: -30 });
    expect(readMoment('today+2w')).toEqual({ kind: 'today', days: 14 });
  });

  it('refuses what names no day', () => {
    expect(readMoment('soon')).toBeNull();
    expect(readMoment('30d')).toBeNull();
    expect(readMoment('today-30')).toBeNull();
  });
});

describe('atDay', () => {
  const today = readMoment('today');
  const monthAgo = readMoment('today-30d');
  if (today === null || monthAgo === null) throw new Error('the moments under test must read');

  it('holds : within the day, from its midnight to the next', () => {
    expect(atMoment(at(25, 0), ':', today, now)).toBe(true);
    expect(atMoment(at(25, 23), ':', today, now)).toBe(true);
    expect(atMoment(at(24, 23), ':', today, now)).toBe(false);
    expect(atMoment(at(26, 0), ':', today, now)).toBe(false);
  });

  it('counts a day from today by whole days, from that day\'s midnight', () => {
    // 30 days before 25 November is 26 October.
    expect(atMoment(at(26, 23, 9), '<', monthAgo, now)).toBe(false);
    expect(atMoment(at(26, 23, 9), '<=', monthAgo, now)).toBe(true);
    expect(atMoment(at(25, 23, 9), '<', monthAgo, now)).toBe(true);
    expect(atMoment(at(27, 0, 9), '>', monthAgo, now)).toBe(true);
    expect(atMoment(at(26, 0, 9), '>=', monthAgo, now)).toBe(true);
    expect(atMoment(at(25, 23, 9), '>=', monthAgo, now)).toBe(false);
  });

  it('holds a calendar date the same way', () => {
    const first = readMoment('2026-11-01');
    if (first === null) throw new Error('the date under test must read');
    expect(atMoment(at(1), ':', first, now)).toBe(true);
    expect(atMoment(at(31, 12, 9), '<', first, now)).toBe(true);
    expect(atMoment(at(2, 0), '>', first, now)).toBe(true);
  });
});
