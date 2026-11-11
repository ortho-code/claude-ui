import type { ClosedHow, NeedsYou, PrChange, PrNeedsYouType, ScheduledTask, SetAside, SettledBy, SettledNeedsYou } from '../../shared/types';
import { scheduledTasksOf } from '../../shared/status/scheduled';
import { HISTORY_KEPT } from '../../shared/status/session-marks';
import { isPrReason, isPrType, PR_TYPES } from '../../shared/status/needs-you';

const CLOSED_HOWS: readonly ClosedHow[] = ['quit', 'ended', 'unknown'];

/** A PR's change in its older words, as its type. */
const PR_TYPE_OF = new Map(Object.entries(PR_TYPES).map(([type, change]) => [change, type as PrNeedsYouType]));

/**
 * One stored reason as the reasons it reads as, none for one this build cannot read: by its type, or in the older form from before reasons had types, where how the app closed was the reason itself and a PR's changes were one reason holding them all, one reason per change now (decided 2026-11-06).
 * A type this build does not fire, a reason without a time, a PR's without the PR, and an older PR reason with a change this build does not know are left out.
 */
function reasonsOf(item: unknown): NeedsYou[] {
  if (typeof item !== 'object' || item === null) return [];
  const { type, reason, at, pr, how, changes } = item as Record<string, unknown>;
  if (typeof at !== 'number') return [];
  if (type !== undefined) {
    if (type === 'app.reminder') return [{ type, at }];
    if (type === 'app.was-running') return CLOSED_HOWS.includes(how as ClosedHow) ? [{ type, at, how: how as ClosedHow }] : [];
    return typeof type === 'string' && isPrType(type) && typeof pr === 'string' ? [{ type, at, pr }] : [];
  }
  if (CLOSED_HOWS.includes(reason as ClosedHow)) return [{ type: 'app.was-running', at, how: reason as ClosedHow }];
  if (reason === 'reminder') return [{ type: 'app.reminder', at }];
  if (reason !== 'pr' || typeof pr !== 'string' || !Array.isArray(changes) || changes.length === 0) return [];
  const types = changes.map((change) => PR_TYPE_OF.get(change as PrChange));
  return types.every((t) => t !== undefined) ? types.map((t) => ({ type: t, at, pr })) : [];
}

/**
 * Session -> every reason it needs you for, from whatever was stored (`reasonsOf`), a session left with none dropped.
 * A single reason, as a file from before a session kept every reason holds it, is read as a list of one.
 */
export function needsYouOf(raw: unknown): Record<string, NeedsYou[]> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {};
  return Object.fromEntries(
    Object.entries(raw as Record<string, unknown>).flatMap(([id, entry]) => {
      const reasons = (Array.isArray(entry) ? entry : [entry]).flatMap(reasonsOf);
      return reasons.length > 0 ? [[id, reasons]] : [];
    }),
  );
}

const SETTLED_BY: readonly SettledBy[] = ['prompt', 'cleared', 'closed', 'moved', 'finished', 'replaced', 'off'];

/** Session -> its settled reasons, from whatever was stored: an entry whose reason does not read (`reasonsOf`), or without a moment it was settled or what settled it, left out, the newest `HISTORY_KEPT` kept, and a session left with none dropped. */
export function needsYouHistoryOf(raw: unknown): Record<string, SettledNeedsYou[]> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {};
  return Object.fromEntries(
    Object.entries(raw as Record<string, unknown>).flatMap(([id, entry]) => {
      const settled = (Array.isArray(entry) ? entry : []).flatMap((item: unknown): SettledNeedsYou[] => {
        const reasons = reasonsOf(item);
        if (reasons.length !== 1) return [];
        const { settled: at, by } = item as Record<string, unknown>;
        return typeof at === 'number' && SETTLED_BY.includes(by as SettledBy) ? [{ ...reasons[0]!, settled: at, by: by as SettledBy }] : [];
      });
      return settled.length > 0 ? [[id, settled.slice(0, HISTORY_KEPT)]] : [];
    }),
  );
}

/**
 * The reasons as they are written: each with its older form beside its type, `reason` and for a PR's change `changes` holding its one change, which a build from before reasons had types reads as it always did, ignoring the type, so going back a build loses no mark (decided 2026-11-06).
 * Never read while the type is there; nothing released knows `needsYou`, so the next release drops it.
 */
export function storedNeedsYou(needsYou: Record<string, NeedsYou[]>): Record<string, object[]> {
  const older = (reason: NeedsYou): object => {
    if (isPrReason(reason)) return { reason: 'pr', changes: [PR_TYPES[reason.type]] };
    return reason.type === 'app.was-running' ? { reason: reason.how } : { reason: 'reminder' };
  };
  return Object.fromEntries(Object.entries(needsYou).map(([id, reasons]) => [id, reasons.map((reason) => ({ ...reason, ...older(reason) }))]));
}

/** Session -> its set-aside mark, from whatever was stored, an entry with a time left out or a day that is not a number dropped. */
export function setAsideOf(raw: unknown): Record<string, SetAside> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {};
  return Object.fromEntries(
    Object.entries(raw as Record<string, unknown>).flatMap(([id, entry]) => {
      if (typeof entry !== 'object' || entry === null) return [];
      const { due, at } = entry as Record<string, unknown>;
      return (due === null || typeof due === 'number') && typeof at === 'number' ? [[id, { due, at }]] : [];
    }),
  );
}

/**
 * The set-aside marks with each session an older file lists as paused (`pausedSessions`) added, whenever, from `at`; one marked already keeps its mark.
 * Read on every read until the next write drops the list, so `at` is that read's until a write keeps one.
 */
export function setAsideWithPaused(setAside: Record<string, SetAside>, paused: unknown, at: number): Record<string, SetAside> {
  if (!Array.isArray(paused)) return setAside;
  const added = (paused as unknown[]).filter((id): id is string => typeof id === 'string' && !(id in setAside));
  return { ...setAside, ...Object.fromEntries(added.map((id) => [id, { due: null, at }])) };
}

/** Session -> its tasks, from whatever was stored, a session with none left out. */
export function scheduledBySession(raw: unknown): Record<string, ScheduledTask[]> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {};
  return Object.fromEntries(
    Object.entries(raw as Record<string, unknown>)
      .map(([id, list]) => [id, scheduledTasksOf(list)] as const)
      .filter(([, tasks]) => tasks.length > 0),
  );
}
