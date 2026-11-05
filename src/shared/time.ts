/**
 * Times of day and local days, pure and shared: the settings check a time of day with them, and the set-aside choices and Pick a date… work out their moments with them.
 * Every day here is a local day, so a moment set for a time of day stays at that time across a change of the clocks.
 * A module of its own rather than part of settings.ts: settings.ts checks the choices with setaside.ts, which needs `timeOfDay`, and the two importing each other would be a cycle, which the import rules refuse (test/unit/imports.test.ts).
 */

/** A time of day as `"HH:MM"` in 24 hours, as hours and minutes, or null for anything else. */
export function timeOfDay(value: string): { hours: number; minutes: number } | null {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value);
  return match ? { hours: Number(match[1]), minutes: Number(match[2]) } : null;
}

/** The start of the local day `days` after the one `now` falls in: tomorrow for 1. */
export function dayStart(now: number, days: number): number {
  const day = new Date(now);
  return new Date(day.getFullYear(), day.getMonth(), day.getDate() + days).getTime();
}

/** `time` ("HH:MM") on the local day `day` falls in, the day's start for a time that does not read; a time the clocks skip that day comes as much later as they skip. */
export function onDayAt(day: number, time: string): number {
  const at = new Date(day);
  const { hours, minutes } = timeOfDay(time) ?? { hours: 0, minutes: 0 };
  return new Date(at.getFullYear(), at.getMonth(), at.getDate(), hours, minutes).getTime();
}
