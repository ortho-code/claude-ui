/** How serious a log line is. The renderer names one when it writes a line of its own, so both sides share the list. */
export const LOG_LEVELS = ['info', 'warn', 'error'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

/** Log files are kept for this many of the most recent dates that have one — dates with a log, not calendar days, so two weeks away does not empty the folder on the next launch. */
export const KEEP_LOG_DATES = 7;

/** Crash logs are kept apart from the dates, newest first, up to this many. */
export const KEEP_CRASH_LOGS = 20;

/** An error as a log line says it: its message, or the value itself when something threw a non-Error. */
export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The longest line the window may write; anything longer is cut, since the window is the less trusted side and a runaway there must not become a runaway file. */
export const RENDERER_LINE_MAX = 4000;
