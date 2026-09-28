/**
 * The app's own folders that Settings points people at, by name.
 * The window only ever names one; main alone knows the paths, so nothing the window sends is ever opened as a path.
 */
export type FolderName = 'config' | 'logs';

/** Log files are kept for this many of the most recent dates that have one — dates with a log, not calendar days, so two weeks away does not empty the folder on the next launch. */
export const KEEP_LOG_DATES = 7;

/** Crash logs are kept apart from the dates, newest first, up to this many. */
export const KEEP_CRASH_LOGS = 20;
