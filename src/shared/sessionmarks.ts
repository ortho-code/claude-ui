/**
 * Main's rules for the marks a session carries in meta — its pin, its archive entry, its note (written with `withText`, src/shared/text.ts), its needs-you and later marks — pure, so that the window's checks answer them the way main does, and the window keeps its own copy of the needs-you and later marks by them.
 * Main (src/main/meta.ts) applies them inside its serialised writes of `meta.json`.
 */
import type { Later, NeedsYou, NeedsYouReason, ScheduledTask } from './types';

/** The marks, as `meta.json` holds them. */
export interface SessionMarks {
  pinned: string[];
  archived: Record<string, number>;
  notes: Record<string, string>;
  needsYou: Record<string, NeedsYou>;
  later: Record<string, Later>;
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
export const NEEDS_YOU_REASONS: readonly NeedsYouReason[] = ['quit', 'ended', 'unknown', 'reminder'];

/** Sessions marked as needing you, for `reason`, from `now`: a session already marked takes the newer reason. */
export function markedNeedsYou(needsYou: Readonly<Record<string, NeedsYou>>, ids: readonly string[], reason: NeedsYouReason, now: number): Record<string, NeedsYou> {
  return { ...needsYou, ...Object.fromEntries(ids.map((id) => [id, { reason, at: now }])) };
}

/** A needs-you mark gone, whether or not it was there. */
export function clearedNeedsYou(needsYou: Readonly<Record<string, NeedsYou>>, id: string): Record<string, NeedsYou> {
  const next = { ...needsYou };
  delete next[id];
  return next;
}

/** A session marked for later, until `due` or whenever for null, from `now`: a mark already there is replaced, so what it mutes is what needed you by now (`mutedByLater`). */
export function markedLater(later: Readonly<Record<string, Later>>, id: string, due: number | null, now: number): Record<string, Later> {
  return { ...later, [id]: { due, at: now } };
}

/** A later mark gone, whether or not it was there. */
export function clearedLater(later: Readonly<Record<string, Later>>, id: string): Record<string, Later> {
  const next = { ...later };
  delete next[id];
  return next;
}

/**
 * The later marks whose day has come by `now` settled: each goes, and its session needs you — for what it already needed you for, if anything, or else for the reminder, marked from the day it was for.
 * A mark it already had is kept rather than replaced, reason and time, so a session picked up again still says why it needed you (decided 2026-10-29).
 */
export function cameDue(marks: Readonly<Pick<SessionMarks, 'needsYou' | 'later'>>, now: number): Pick<SessionMarks, 'needsYou' | 'later'> {
  const due = Object.entries(marks.later).filter(([, mark]) => mark.due !== null && mark.due <= now);
  if (due.length === 0) return { needsYou: { ...marks.needsYou }, later: { ...marks.later } };
  const needsYou = { ...marks.needsYou };
  const later = { ...marks.later };
  for (const [id, mark] of due) {
    delete later[id];
    needsYou[id] ??= { reason: 'reminder', at: mark.due! };
  }
  return { needsYou, later };
}

/**
 * Whether a session's needs-you mark is muted by its later mark: it needed you before you set it aside, so you have seen why and chose later (decided 2026-10-29).
 * A mark that came after it is news the later mark did not know of, and is not muted.
 */
export function mutedByLater(needsYou: NeedsYou | undefined, later: Later | undefined): boolean {
  return needsYou !== undefined && later !== undefined && needsYou.at <= later.at;
}

/** An archive entry gone, whether or not it was there. */
export function unarchived(archived: Readonly<Record<string, number>>, id: string): Record<string, number> {
  const next = { ...archived };
  delete next[id];
  return next;
}

/** A deleted session's marks forgotten: its pin, its archive entry, its note, its needs-you mark and its later mark (`purgedSession` forgets the rest of what meta holds about it). */
export function withoutSession(marks: Readonly<SessionMarks>, id: string): SessionMarks {
  const archived = unarchived(marks.archived, id);
  const notes = { ...marks.notes };
  delete notes[id];
  return { pinned: marks.pinned.filter((key) => key !== id), archived, notes, needsYou: clearedNeedsYou(marks.needsYou, id), later: clearedLater(marks.later, id) };
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
