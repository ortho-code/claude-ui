// A short "x min ago" relative time.
// `now` is injectable for tests.
export function relativeTime(iso: string, now: number = Date.now()): string {
  const seconds = Math.round((now - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return `${Math.round(hours / 24)} d ago`;
}

/**
 * A moment as the language `tag` writes its day and its time to the minute: "Tue 3 Nov, 09:00" in en-GB, "Tue, Nov 3, 9:00 AM" in en-US, "di 3 nov, 09:00" in nl-NL.
 * The year only where it is not the year of `now`, since a weekday and a date name a day well enough within the year.
 */
export function momentLabel(at: number, tag: string, now: number = Date.now()): string {
  const moment = new Date(at);
  const otherYear = moment.getFullYear() !== new Date(now).getFullYear();
  return `${formatter(tag, otherYear ? 'day-year' : 'day').format(moment)}, ${formatter(tag, 'time').format(moment)}`;
}

/** How `momentLabel` writes a part of a moment: its day, its day with the year, or its time. */
type Form = 'day' | 'day-year' | 'time';

const FORMS: Record<Form, Intl.DateTimeFormatOptions> = {
  day: { weekday: 'short', day: 'numeric', month: 'short' },
  'day-year': { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' },
  time: { timeStyle: 'short' },
};

/**
 * Formatters by language and form, each built once.
 * Building an `Intl.DateTimeFormat` costs far more than formatting with one, and the session list writes a moment for every row it draws.
 */
const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(tag: string, form: Form): Intl.DateTimeFormat {
  const key = `${tag}|${form}`;
  let made = formatters.get(key);
  if (!made) {
    made = new Intl.DateTimeFormat(tag, FORMS[form]);
    formatters.set(key, made);
  }
  return made;
}
