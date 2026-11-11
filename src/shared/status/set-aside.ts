import { dayStart, onDayAt, timeOfDay } from '../helpers/time';

/**
 * THE SET-ASIDE CHOICES: the presets in `settings.json` (`setAside`), read, checked and worked out into moments, pure and shared, so the settings' check in main and the choices the window offers read one grammar (docs/architecture/status-cues.md § Status cues).
 * English words whatever the language setting, as the app's other words are; every moment local time, worked out when asked.
 */

/** A choice as read: whenever, a count of a unit from now, tomorrow, or the next such weekday; `time` is the time of day it was written with, null for the setting's. */
export type Preset =
  | { kind: 'whenever' }
  | { kind: 'in'; count: number; unit: 'm' | 'h' | 'd' | 'w'; time: string | null }
  | { kind: 'tomorrow'; time: string | null }
  | { kind: 'next'; weekday: number; time: string | null };

/** The weekdays as `Date.getDay()` numbers them, each by its name and its first three letters. */
const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'] as const;

/** The most of a unit a choice may count, so no choice lands past what a date can hold. */
const MOST = 999;

/** A time of day written after a choice, or null for none; undefined for one that does not read. */
function timeAfter(text: string | undefined): string | null | undefined {
  if (text === undefined) return null;
  return timeOfDay(text) !== null ? text : undefined;
}

/**
 * A choice as written, read: `whenever`; `in <N>m` or `in <N>h`, that long from the press; `in <N>d` or `in <N>w`, that many days or weeks on; `tomorrow`; `next <weekday>`, the first such day after today, by its name or its first three letters.
 * A day may be followed by a time of day, `"HH:MM"`; case and extra spaces do not count, nor a space before a unit (`in 2 h`); null for anything else.
 */
export function parsePreset(written: string): Preset | null {
  const text = written.trim().toLowerCase().replace(/\s+/g, ' ');
  if (text === 'whenever') return { kind: 'whenever' };
  const counted = /^in (\d+) ?([mhdw])(?: (\S+))?$/.exec(text);
  if (counted) {
    const count = Number(counted[1]);
    const unit = counted[2] as 'm' | 'h' | 'd' | 'w';
    const time = timeAfter(counted[3]);
    // A time belongs to a day, so minutes and hours from now take none.
    if (count < 1 || count > MOST || time === undefined || (time !== null && (unit === 'm' || unit === 'h'))) return null;
    return { kind: 'in', count, unit, time };
  }
  const tomorrow = /^tomorrow(?: (\S+))?$/.exec(text);
  if (tomorrow) {
    const time = timeAfter(tomorrow[1]);
    return time === undefined ? null : { kind: 'tomorrow', time };
  }
  const next = /^next ([a-z]+)(?: (\S+))?$/.exec(text);
  if (next) {
    const name = next[1]!;
    const weekday = WEEKDAYS.findIndex((day) => day === name || day.slice(0, 3) === name);
    const time = timeAfter(next[2]);
    return weekday < 0 || time === undefined ? null : { kind: 'next', weekday, time };
  }
  return null;
}

/** The moment a choice comes back from `now`, at its own time of day or else `time`, the setting's; null for whenever. */
export function presetMoment(preset: Preset, now: number, time: string): number | null {
  switch (preset.kind) {
    case 'whenever':
      return null;
    case 'in':
      if (preset.unit === 'm') return now + preset.count * 60_000;
      if (preset.unit === 'h') return now + preset.count * 3_600_000;
      return onDayAt(dayStart(now, preset.count * (preset.unit === 'w' ? 7 : 1)), preset.time ?? time);
    case 'tomorrow':
      return onDayAt(dayStart(now, 1), preset.time ?? time);
    case 'next': {
      // Never today: on that weekday itself, the next is a week on.
      const days = (preset.weekday - new Date(now).getDay() + 7) % 7 || 7;
      return onDayAt(dayStart(now, days), preset.time ?? time);
    }
  }
}

const UNIT_WORDS = { m: 'minute', h: 'hour', d: 'day', w: 'week' } as const;

/** A choice in words, as a menu names it before its moment: "In 2 hours", "Tomorrow", "Next Monday", "Whenever". */
export function presetWords(preset: Preset): string {
  switch (preset.kind) {
    case 'whenever':
      return 'Whenever';
    case 'in':
      return `In ${preset.count} ${UNIT_WORDS[preset.unit]}${preset.count === 1 ? '' : 's'}`;
    case 'tomorrow':
      return 'Tomorrow';
    case 'next': {
      const name = WEEKDAYS[preset.weekday]!;
      return `Next ${name[0]!.toUpperCase()}${name.slice(1)}`;
    }
  }
}

/** One choice offered: as written, as read, and the moment it comes back, null for whenever. */
export interface SetAsideOffer {
  text: string;
  preset: Preset;
  due: number | null;
}

/**
 * The choices to offer from `presets` at `now`: in the order they would come, Whenever last, so a date is the easier pick (decided 2026-10-29); two that come at the same moment once, the first written; one that does not read left out, since the setting's check names it.
 * Worked out when a menu or a dialog opens, so the order is always the one the moments give.
 */
export function setAsideOffers(presets: readonly string[], now: number, time: string): SetAsideOffer[] {
  const offers: SetAsideOffer[] = [];
  for (const text of presets) {
    const preset = parsePreset(text);
    if (preset === null) continue;
    const due = presetMoment(preset, now, time);
    if (!offers.some((offer) => offer.due === due)) offers.push({ text, preset, due });
  }
  // No two moments are alike once the same moment is kept once; whenever, null, sorts last.
  return offers.sort((a, b) => (a.due ?? Infinity) - (b.due ?? Infinity));
}

/** The forms a choice may take, as a problem with the setting names them. */
const FORMS = '"whenever", "in 30m", "in 2h", "in 3d 14:00", "in 1w", "tomorrow 09:00" or "next monday 09:00", a time only where a day is';

/** Why `value` cannot be the setting's list of choices, or null when it can: a list of text, each a choice that reads, the empty list included. */
export function presetsProblem(value: unknown): string | null {
  if (!Array.isArray(value) || !value.every((item): item is string => typeof item === 'string')) return 'It has to be a list of choices, such as ["tomorrow", "in 1w", "whenever"].';
  const wrong = value.filter((text) => parsePreset(text) === null).map((text) => JSON.stringify(text));
  if (wrong.length === 0) return null;
  const named = wrong.length === 1 ? `${wrong[0]} is not a choice` : `${wrong.slice(0, -1).join(', ')} and ${wrong.at(-1)} are not choices`;
  return `${named} the app reads: write ${FORMS}.`;
}
