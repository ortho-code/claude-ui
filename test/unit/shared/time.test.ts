import { describe, expect, it } from 'vitest';
import { dayStart, onDayAt, timeOfDay } from '../../../src/shared/time';

describe('local days and times of day', () => {
  // Local times: Thursday 29 October 2026, mid-afternoon.
  const thursday = new Date(2026, 9, 29, 15, 30).getTime();

  it('reads a time of day in 24 hours, and nothing else', () => {
    expect(timeOfDay('09:05')).toEqual({ hours: 9, minutes: 5 });
    expect(timeOfDay('23:59')).toEqual({ hours: 23, minutes: 59 });
    for (const wrong of ['9:00', '24:00', '09:60', '9am', '']) expect(timeOfDay(wrong)).toBeNull();
  });

  it('starts tomorrow at its midnight, across the end of a month too', () => {
    expect(dayStart(thursday, 1)).toBe(new Date(2026, 9, 30).getTime());
    expect(dayStart(new Date(2026, 9, 31, 23, 59).getTime(), 1)).toBe(new Date(2026, 10, 1).getTime());
  });

  it('puts a time of day on the day given, a week on being the same weekday', () => {
    expect(onDayAt(dayStart(thursday, 1), '09:00')).toBe(new Date(2026, 9, 30, 9, 0).getTime());
    expect(onDayAt(dayStart(thursday, 7), '17:45')).toBe(new Date(2026, 10, 5, 17, 45).getTime());
    // A time that does not read leaves the day's start.
    expect(onDayAt(dayStart(thursday, 1), '9am')).toBe(new Date(2026, 9, 30).getTime());
  });
});
