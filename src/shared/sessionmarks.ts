/**
 * Main's rules for the marks a session carries in meta — its pin, its archive entry, its note (written with `withText`, src/shared/text.ts), its needs-you and later marks, and when it was kept out of the review — pure, so that the window's checks answer them the way main does, and the window keeps its own copy of the needs-you, later and keep marks by them.
 * Main (src/main/meta.ts) applies them inside its serialised writes of `meta.json`.
 */
import type { SetAside, NeedsYou, NeedsYouReason, PrChange, ScheduledTask } from './types';

/** The marks, as `meta.json` holds them. */
export interface SessionMarks {
  pinned: string[];
  archived: Record<string, number>;
  notes: Record<string, string>;
  needsYou: Record<string, NeedsYou[]>;
  later: Record<string, SetAside>;
  /** When each session was last kept out of the review, epoch ms; how long that holds is the review's own term (`kept:<30d`), not the mark's. */
  kept: Record<string, number>;
}

/** Sessions kept out of the review from `at`: a stamp already there is replaced, so Keep again starts its days afresh. */
export function keptFrom(kept: Readonly<Record<string, number>>, ids: readonly string[], at: number): Record<string, number> {
  return { ...kept, ...Object.fromEntries(ids.map((id) => [id, at])) };
}

/** Sessions' keep stamps gone, whether or not each had one. */
export function unkept(kept: Readonly<Record<string, number>>, ids: readonly string[]): Record<string, number> {
  const next = { ...kept };
  for (const id of ids) delete next[id];
  return next;
}

/** A pin toggled: in if it was out, out if it was in, the order of the rest kept. */
export function togglePinned(pinned: readonly string[], id: string): string[] {
  const set = new Set(pinned);
  if (set.has(id)) set.delete(id);
  else set.add(id);
  return [...set];
}

/** An archive entry there, from `now`, or from when it was archived before, so a second archive is no change. */
export function archivedFrom(archived: Readonly<Record<string, number>>, id: string, now: number): Record<string, number> {
  return id in archived ? { ...archived } : { ...archived, [id]: now };
}

/** Every reason a session can need you for, as `meta.json` may hold them. */
export const NEEDS_YOU_REASONS: readonly NeedsYouReason[] = ['quit', 'ended', 'unknown', 'reminder', 'pr'];

/** Every change of a PR that marks a session, as `meta.json` may hold them. */
export const PR_CHANGES: readonly PrChange[] = ['checks failed', 'merge conflict', 'changes requested', 'merged', 'closed', 'approved', 'reopened'];

/** What a reason replaces when it is added: how the app closed replaces how it closed before, a reminder the reminder before, and a PR's change that PR's change before. */
function kindOf(reason: NeedsYou): string {
  if (reason.reason === 'pr') return `pr:${reason.pr}`;
  return reason.reason === 'reminder' ? 'reminder' : 'launch';
}

/**
 * Sessions marked as needing you for `reasons`: each added beside the reasons a session already has, replacing one of its kind, so a session picked up again still says every reason it needed you for (decided 2026-10-29).
 * No sessions or no reasons is no change.
 */
export function markedNeedsYou(needsYou: Readonly<Record<string, readonly NeedsYou[]>>, ids: readonly string[], reasons: readonly NeedsYou[]): Record<string, NeedsYou[]> {
  const next = Object.fromEntries(Object.entries(needsYou).map(([id, list]) => [id, [...list]]));
  if (reasons.length === 0) return next;
  const kinds = new Set(reasons.map(kindOf));
  for (const id of ids) next[id] = [...(next[id] ?? []).filter((reason) => !kinds.has(kindOf(reason))), ...reasons];
  return next;
}

/** When a session's newest reason was marked; 0 for none. */
export function newestAt(reasons: readonly NeedsYou[]): number {
  return Math.max(0, ...reasons.map((reason) => reason.at));
}

/** A needs-you mark gone, every reason with it, whether or not it was there. */
export function clearedNeedsYou<T extends readonly NeedsYou[]>(needsYou: Readonly<Record<string, T>>, id: string): Record<string, T> {
  const next = { ...needsYou };
  delete next[id];
  return next;
}

/** A session marked for later, until `due` or whenever for null, from `now`: a mark already there is replaced, so what it mutes is what needed you by now (`mutedBySetAside`). */
export function markedSetAside(setAside: Readonly<Record<string, SetAside>>, id: string, due: number | null, now: number): Record<string, SetAside> {
  return { ...setAside, [id]: { due, at: now } };
}

/** A later mark gone, whether or not it was there. */
export function clearedSetAside(setAside: Readonly<Record<string, SetAside>>, id: string): Record<string, SetAside> {
  const next = { ...setAside };
  delete next[id];
  return next;
}

/**
 * The later marks come due by `now` settled: each goes, and its session needs you — for what it already needed you for, if anything, or else for the reminder, marked from the moment it was due.
 * A session that already needs you gets no reminder beside its reasons: the later mark going is what lights them up again (decided 2026-10-29).
 */
export function cameDue(marks: { needsYou: Readonly<Record<string, readonly NeedsYou[]>>; later: Readonly<Record<string, SetAside>> }, now: number): Pick<SessionMarks, 'needsYou' | 'later'> {
  const due = Object.entries(marks.later).filter(([, mark]) => mark.due !== null && mark.due <= now);
  const needsYou = Object.fromEntries(Object.entries(marks.needsYou).map(([id, reasons]) => [id, [...reasons]]));
  if (due.length === 0) return { needsYou, later: { ...marks.later } };
  const later = { ...marks.later };
  for (const [id, mark] of due) {
    delete later[id];
    if (!needsYou[id]?.length) needsYou[id] = [{ reason: 'reminder', at: mark.due! }];
  }
  return { needsYou, later };
}

/**
 * Whether a session's needs-you mark is muted by its later mark: every reason came before you set it aside, so you have seen why and chose later (decided 2026-10-29).
 * A reason that came after it is news the later mark did not know of, and none is muted.
 */
export function mutedBySetAside(needsYou: readonly NeedsYou[] | undefined, setAside: SetAside | undefined): boolean {
  return needsYou !== undefined && needsYou.length > 0 && setAside !== undefined && newestAt(needsYou) <= setAside.at;
}

/** An archive entry gone, whether or not it was there. */
export function unarchived(archived: Readonly<Record<string, number>>, id: string): Record<string, number> {
  const next = { ...archived };
  delete next[id];
  return next;
}

/** A deleted session's marks forgotten: its pin, its archive entry, its note, its needs-you mark, its later mark and its keep stamp (`purgedSession` forgets the rest of what meta holds about it). */
export function withoutSession(marks: Readonly<SessionMarks>, id: string): SessionMarks {
  const archived = unarchived(marks.archived, id);
  const notes = { ...marks.notes };
  delete notes[id];
  return { pinned: marks.pinned.filter((key) => key !== id), archived, notes, needsYou: clearedNeedsYou(marks.needsYou, id), later: clearedSetAside(marks.later, id), kept: unkept(marks.kept, [id]) };
}

/** What else meta holds about a session, as `meta.json` holds it: the tabs open and which of them run, the one on show overall and per project, and who is in which group. */
export interface SessionPlaces {
  openSessions: string[];
  runningSessions: string[];
  scheduledWhenStopped: Record<string, ScheduledTask[]>;
  activeSession: string | null;
  activeSessionByProject: Record<string, string>;
  groupOf: Record<string, string>;
}

/** Everything meta holds about a deleted session forgotten, its marks with the rest: main's purge (`purgeSession`, src/main/meta.ts), and the window checks' stand-in's. */
export function purgedSession(meta: Readonly<SessionMarks & SessionPlaces>, id: string): SessionMarks & SessionPlaces {
  const groupOf = { ...meta.groupOf };
  delete groupOf[id];
  return {
    ...withoutSession(meta, id),
    openSessions: meta.openSessions.filter((key) => key !== id),
    runningSessions: meta.runningSessions.filter((key) => key !== id),
    scheduledWhenStopped: Object.fromEntries(Object.entries(meta.scheduledWhenStopped).filter(([key]) => key !== id)),
    activeSession: meta.activeSession === id ? null : meta.activeSession,
    activeSessionByProject: Object.fromEntries(Object.entries(meta.activeSessionByProject).filter(([, key]) => key !== id)),
    groupOf,
  };
}
