/** How a term compares its field with its value: `:` for equal to it, or within that day for a moment. */
export type Comparison = ':' | '<' | '<=' | '>' | '>=';

/** A day a query names: a calendar date, or a number of days from today, both in local time. */
export type Moment = { kind: 'date'; year: number; month: number; day: number } | { kind: 'today'; days: number };

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const FROM_TODAY = /^today(?:([+-])(\d+)([dw]))?$/i;
const NAMED_DAYS: Readonly<Record<string, number>> = { yesterday: -1, tomorrow: 1 };
const DAYS_PER_UNIT = { d: 1, w: 7 } as const;

/** The moment a value names, or null when it names none: `2026-11-01`, `today`, `yesterday`, `tomorrow`, `today-30d`, `today+1w`. */
export function readMoment(text: string): Moment | null {
  const date = DATE.exec(text);
  if (date) {
    const [year, month, day] = [Number(date[1]), Number(date[2]), Number(date[3])];
    const check = new Date(year, month - 1, day);
    return check.getFullYear() === year && check.getMonth() === month - 1 && check.getDate() === day ? { kind: 'date', year, month, day } : null;
  }
  const named = NAMED_DAYS[text.toLowerCase()];
  if (named !== undefined) return { kind: 'today', days: named };
  const relative = FROM_TODAY.exec(text);
  if (!relative) return null;
  if (relative[1] === undefined) return { kind: 'today', days: 0 };
  const count = Number(relative[2]) * DAYS_PER_UNIT[relative[3]?.toLowerCase() as keyof typeof DAYS_PER_UNIT];
  return { kind: 'today', days: relative[1] === '-' ? -count : count };
}

/** The local midnight a moment's day starts at, `after` days later, counted by the calendar so a day with a clock change is still one day. */
function dayStart(moment: Moment, now: number, after = 0): number {
  if (moment.kind === 'date') return new Date(moment.year, moment.month - 1, moment.day + after).getTime();
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() + moment.days + after);
  return start.getTime();
}

/** A moment's day as times: from its midnight, up to the next one, exclusive. */
export interface Day {
  start: number;
  end: number;
}

/** The day a moment names, as of `now`. */
export function dayOf(moment: Moment, now: number): Day {
  return { start: dayStart(moment, now), end: dayStart(moment, now, 1) };
}

/** Whether a time stands as the comparison says to a day: `:` within it, `<` before it, `<=` before its end, `>` after it, `>=` from its start. */
export function atDay(at: number, comparison: Comparison, { start, end }: Day): boolean {
  switch (comparison) {
    case ':':
      return at >= start && at < end;
    case '<':
      return at < start;
    case '<=':
      return at < end;
    case '>':
      return at >= end;
    case '>=':
      return at >= start;
  }
}
