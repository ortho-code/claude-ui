import { describe, expect, it } from 'vitest';
import { parsePreset, presetMoment, presetsProblem, presetWords, setAsideOffers } from '../../../src/shared/setaside';

// Wednesday 4 November 2026, 10:30 local time.
const now = new Date(2026, 10, 4, 10, 30).getTime();
const at = (month: number, day: number, hours: number, minutes = 0): number => new Date(2026, month, day, hours, minutes).getTime();
const moment = (text: string, from = now, time = '09:00'): number | null => {
  const preset = parsePreset(text);
  if (preset === null) throw new Error(`"${text}" does not read`);
  return presetMoment(preset, from, time);
};

describe('a set-aside choice as written', () => {
  it('reads every form, with and without a time, whatever the case and spaces', () => {
    for (const text of ['whenever', 'in 2h', 'in 30m', 'in 3d', 'in 3d 14:00', 'in 1w', 'in 2w 08:15', 'tomorrow', 'tomorrow 17:30', 'next monday', 'next mon 09:00', 'next Sunday', '  In  2H ', 'TOMORROW', 'in 2 h']) {
      expect({ text, read: parsePreset(text) !== null }).toEqual({ text, read: true });
    }
  });

  it('reads nothing else', () => {
    for (const text of ['', 'later', 'in 0h', 'in 2x', 'in h', 'in -1d', 'in 1000d', 'in 2h 09:00', 'in 30m 09:00', 'next moonday', 'next', 'tomorrow 25:00', 'tomorrow 9:00', 'tomorrow at 09:00', 'next week', 'whenever 09:00', 'in 1.5h']) {
      expect({ text, read: parsePreset(text) }).toEqual({ text, read: null });
    }
  });
});

describe('the moment a choice comes back', () => {
  it('counts minutes and hours from now, exactly', () => {
    expect(moment('in 30m')).toBe(now + 30 * 60_000);
    expect(moment('in 2h')).toBe(now + 2 * 3_600_000);
    // Across midnight it is still that long.
    expect(moment('in 2h', at(10, 4, 23, 15))).toBe(at(10, 5, 1, 15));
  });

  it('puts days, weeks, tomorrow and a weekday at their time, or the time of day for one without', () => {
    expect(moment('tomorrow')).toBe(at(10, 5, 9));
    expect(moment('tomorrow 17:30')).toBe(at(10, 5, 17, 30));
    expect(moment('in 3d', now, '08:00')).toBe(at(10, 7, 8));
    expect(moment('in 1w')).toBe(at(10, 11, 9));
    expect(moment('in 2w 08:15')).toBe(at(10, 18, 8, 15));
    // The first such day after today: from a Wednesday the coming Monday, and the next Wednesday a week on, never today.
    expect(moment('next monday')).toBe(at(10, 9, 9));
    expect(moment('next wed')).toBe(at(10, 11, 9));
    expect(moment('next monday', at(10, 9, 8))).toBe(at(10, 16, 9));
    expect(moment('whenever')).toBeNull();
  });

  it('keeps the local time of day across a change of the clocks', () => {
    // The clocks go back in much of Europe on Sunday 25 October 2026; local time is what counts, whatever the zone the tests run in.
    expect(moment('in 1d', at(9, 24, 12))).toBe(at(9, 25, 9));
    expect(moment('in 1w', at(9, 22, 12))).toBe(at(9, 29, 9));
  });
});

describe('the choices offered', () => {
  it('come in the order they would come, the same moment once, Whenever last', () => {
    const offers = setAsideOffers(['whenever', 'in 1w', 'next monday', 'tomorrow', 'in 2h', 'in 1d'], now, '09:00');
    expect(offers.map((offer) => offer.text)).toEqual(['in 2h', 'tomorrow', 'next monday', 'in 1w', 'whenever']);
    expect(offers.map((offer) => offer.due)).toEqual([now + 7_200_000, at(10, 5, 9), at(10, 9, 9), at(10, 11, 9), null]);
  });

  it('leave out what does not read, and offer nothing for an empty list', () => {
    expect(setAsideOffers(['tomorrow', 'nxt monday'], now, '09:00').map((offer) => offer.text)).toEqual(['tomorrow']);
    expect(setAsideOffers([], now, '09:00')).toEqual([]);
  });

  it('are named in words', () => {
    const words = (text: string): string => presetWords(parsePreset(text)!);
    expect(['in 1m', 'in 30m', 'in 1h', 'in 2h', 'in 1d', 'in 3d', 'in 1w', 'in 2w', 'tomorrow', 'next monday', 'next sun 10:00', 'whenever'].map(words)).toEqual([
      'In 1 minute',
      'In 30 minutes',
      'In 1 hour',
      'In 2 hours',
      'In 1 day',
      'In 3 days',
      'In 1 week',
      'In 2 weeks',
      'Tomorrow',
      'Next Monday',
      'Next Sunday',
      'Whenever',
    ]);
  });
});

describe('the setting', () => {
  it('takes a list of choices that all read, an empty one too', () => {
    expect(presetsProblem(['tomorrow', 'in 1w', 'whenever'])).toBeNull();
    expect(presetsProblem([])).toBeNull();
  });

  it('names each choice that does not read, and the forms that do', () => {
    expect(presetsProblem(['tomorrow', 'nxt monday', 'in 2x'])).toBe(
      '"nxt monday" and "in 2x" are not choices the app reads: write "whenever", "in 30m", "in 2h", "in 3d 14:00", "in 1w", "tomorrow 09:00" or "next monday 09:00", a time only where a day is.',
    );
    expect(presetsProblem(['nxt monday'])).toBe('"nxt monday" is not a choice the app reads: write "whenever", "in 30m", "in 2h", "in 3d 14:00", "in 1w", "tomorrow 09:00" or "next monday 09:00", a time only where a day is.');
  });

  it('is a list of text', () => {
    for (const wrong of ['tomorrow', null, 3, { tomorrow: true }, ['tomorrow', 3]]) {
      expect(presetsProblem(wrong)).toBe('It has to be a list of choices, such as ["tomorrow", "in 1w", "whenever"].');
    }
  });
});
