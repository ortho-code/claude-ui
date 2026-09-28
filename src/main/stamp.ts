import { promises as fs } from 'node:fs';

/**
 * Local time with its UTC offset, to the millisecond: `2026-09-28T14:30:12.345+02:00`.
 * Local because these files are read by someone looking for "this morning's crash" on their own clock; the offset because local time alone is ambiguous in the hour the clocks go back, and on a colleague's machine in another zone.
 */
export function localTimestamp(date: Date = new Date()): string {
  const pad = (n: number, width = 2): string => String(n).padStart(width, '0');
  // getTimezoneOffset is minutes BEHIND UTC, so its sign is the opposite of the one written.
  const offset = -date.getTimezoneOffset();
  const sign = offset < 0 ? '-' : '+';
  const abs = Math.abs(offset);
  const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  const time = `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}`;
  return `${day}T${time}${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

/**
 * Append one line to `file`, stamped with the moment it is written.
 * The one way the app's own record files take a line, so they cannot disagree about how a moment is written.
 * Failure is the caller's to decide: a record that must never break a real write swallows it, and one that can recover from a vanished folder does that instead.
 */
export async function appendStamped(file: string, text: string): Promise<void> {
  await fs.appendFile(file, `${localTimestamp()} ${text}\n`);
}
