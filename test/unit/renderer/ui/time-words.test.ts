import { describe, it, expect } from 'vitest';
import { dayLabel, momentLabel, relativeTime } from '../../../../src/renderer/ui/time-words';

describe('relativeTime', () => {
  const now = Date.parse('2026-07-28T12:00:00.000Z');
  it('formats buckets', () => {
    expect(relativeTime('2026-07-28T11:59:30.000Z', now)).toBe('just now');
    expect(relativeTime('2026-07-28T11:30:00.000Z', now)).toBe('30 min ago');
    expect(relativeTime('2026-07-28T09:00:00.000Z', now)).toBe('3 h ago');
    expect(relativeTime('2026-07-26T12:00:00.000Z', now)).toBe('2 d ago');
  });
});

describe('dayLabel and momentLabel', () => {
  it('names a day short, and a moment by its day and time', () => {
    expect(dayLabel(new Date(2026, 10, 2).getTime())).toBe('Mon 2 Nov');
    expect(momentLabel(new Date(2026, 10, 2, 9, 5).getTime())).toBe('Mon 2 Nov, 09:05');
  });
});
