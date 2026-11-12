import { describe, it, expect } from 'vitest';
import { momentLabel, relativeTime } from '../../../../src/renderer/ui/time-words';

describe('relativeTime', () => {
  const now = Date.parse('2026-07-28T12:00:00.000Z');
  it('formats buckets', () => {
    expect(relativeTime('2026-07-28T11:59:30.000Z', now)).toBe('just now');
    expect(relativeTime('2026-07-28T11:30:00.000Z', now)).toBe('30 min ago');
    expect(relativeTime('2026-07-28T09:00:00.000Z', now)).toBe('3 h ago');
    expect(relativeTime('2026-07-26T12:00:00.000Z', now)).toBe('2 d ago');
  });
});

describe('momentLabel', () => {
  const now = new Date(2026, 10, 12, 15, 0).getTime();
  const monday = new Date(2026, 10, 2, 9, 5).getTime();

  it('names a moment by its day and its time, as the language writes them', () => {
    expect(momentLabel(monday, 'en-GB', now)).toBe('Mon 2 Nov, 09:05');
    expect(momentLabel(monday, 'en-US', now)).toBe('Mon, Nov 2, 9:05 AM');
    expect(momentLabel(monday, 'nl-NL', now)).toBe('ma 2 nov, 09:05');
  });

  it('adds the year only to a moment in another year than now', () => {
    expect(momentLabel(new Date(2025, 9, 1, 16, 20).getTime(), 'en-GB', now)).toBe('Wed, 1 Oct 2025, 16:20');
    expect(momentLabel(new Date(2027, 0, 4, 9, 0).getTime(), 'en-GB', now)).toBe('Mon, 4 Jan 2027, 09:00');
  });
});
