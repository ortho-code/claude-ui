import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { app } from 'electron';
import { sameReason } from '../../shared/status/session-marks';
import type { NeedsYou, SettledBy } from '../../shared/types';
import { errorText, logOnce } from './log';
import { inTurn } from '../files/queue';
import { appendStamped } from '../files/stamp';

/**
 * THE USAGE RECORD (docs/architecture/logs.md § The usage record): a line per decision, per opening and ending of the review, and per needs-you reason marked, settled or put back, so how the app is used can be counted over weeks.
 * A line holds moments, session ids, types and counts, never a title, a prompt or a note, and stays on this machine.
 */

/** A decision on sessions, as main writes it to meta.json. */
export type DecideAct = 'finish' | 'unfinish' | 'setAside' | 'clearSetAside' | 'keep' | 'unkeep';

/** What wrote a decision that you did not take: a prompt there clearing its set-aside mark, or a session resumed in claude making it unfinished. */
export type DecidedBy = 'prompt' | 'resume';

/** The review opened or ended, with how many sessions it offered to decide at that moment, and whether it covered the project on show or every project. */
export interface ReviewUsage {
  kind: 'review';
  act: 'start' | 'end';
  scope: 'project' | 'all';
  offered: number;
}

export type UsageEvent =
  | ReviewUsage
  | { kind: 'decide'; act: DecideAct; ids: string[]; by?: DecidedBy }
  | { kind: 'needsYou'; act: 'marked' | 'restored'; id: string; types: string[] }
  | { kind: 'needsYou'; act: 'settled'; id: string; types: string[]; by: SettledBy };

/** The review's opening or ending as the window sent it, checked rather than trusted, since the window is the less trusted side; null for anything else. */
export function reviewUsageOf(act: unknown, scope: unknown, offered: unknown): ReviewUsage | null {
  if ((act !== 'start' && act !== 'end') || (scope !== 'project' && scope !== 'all') || !Number.isSafeInteger(offered) || (offered as number) < 0) return null;
  return { kind: 'review', act, scope, offered: offered as number };
}

/** How long a line is kept: long enough to compare months, bounded so the file does not only grow. */
export const USAGE_KEPT_DAYS = 365;
const DAY_MS = 86_400_000;

function usagePath(): string {
  return path.join(app.getPath('userData'), 'usage.log');
}

/** Append `events`, a line each, after whatever was queued before; a failed append is logged once and never thrown, since the write it records has already happened. */
export function recordUsage(events: readonly UsageEvent[]): Promise<void> {
  if (events.length === 0) return Promise.resolve();
  const file = usagePath();
  return inTurn(file, async () => {
    try {
      for (const event of events) await appendStamped(file, JSON.stringify(event));
    } catch (error) {
      logOnce('warn', 'usage', `${file} not written: ${errorText(error)}`);
    }
  });
}

/** The lines of `text` written less than USAGE_KEPT_DAYS before `now`; a line whose moment cannot be read goes too. */
export function keptUsage(text: string, now: number): string {
  const since = now - USAGE_KEPT_DAYS * DAY_MS;
  return text
    .split('\n')
    .filter((line) => {
      const at = Date.parse(line.slice(0, line.indexOf(' ')));
      return Number.isFinite(at) && at >= since;
    })
    .map((line) => `${line}\n`)
    .join('');
}

/** Drop the lines past USAGE_KEPT_DAYS, as the app starts; no file is nothing to do, and a failure is logged once. */
export function trimUsage(now = Date.now()): Promise<void> {
  const file = usagePath();
  return inTurn(file, async () => {
    try {
      const text = await fs.readFile(file, 'utf8');
      const kept = keptUsage(text, now);
      if (kept !== text) await fs.writeFile(file, kept);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') logOnce('warn', 'usage', `${file} not trimmed: ${errorText(error)}`);
    }
  });
}

/**
 * What a write did to the needs-you marks, from the marks before it and after: per session, the reasons that went, settled by `by`, and those that came, marked anew or put back by Undo as `came` says.
 * A session whose reasons did not change gives no line.
 */
export function needsYouUsage(
  before: Readonly<Record<string, readonly NeedsYou[]>>,
  after: Readonly<Record<string, readonly NeedsYou[]>>,
  { by, came = 'marked' }: { by: SettledBy; came?: 'marked' | 'restored' },
): UsageEvent[] {
  const events: UsageEvent[] = [];
  for (const id of new Set([...Object.keys(before), ...Object.keys(after)])) {
    const was = before[id] ?? [];
    const is = after[id] ?? [];
    const went = was.filter((reason) => !is.some((other) => sameReason(reason, other)));
    const arrived = is.filter((reason) => !was.some((other) => sameReason(reason, other)));
    if (went.length > 0) events.push({ kind: 'needsYou', act: 'settled', id, types: went.map((reason) => reason.type), by });
    if (arrived.length > 0) events.push({ kind: 'needsYou', act: came, id, types: arrived.map((reason) => reason.type) });
  }
  return events;
}
