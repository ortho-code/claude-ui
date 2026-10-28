/**
 * Main's rules for the marks a session carries in meta — its pin, its archive entry, its note (written with `withText`, src/shared/text.ts), its needs-you mark — pure, so that the window's checks answer them the way main does, and the window keeps its own copy of the needs-you marks by them.
 * Main (src/main/meta.ts) applies them inside its serialised writes of `meta.json`.
 */
import type { ClosedHow, NeedsYou, ScheduledTask } from './types';

/** The marks, as `meta.json` holds them. */
export interface SessionMarks {
  pinned: string[];
  archived: Record<string, number>;
  notes: Record<string, string>;
  needsYou: Record<string, NeedsYou>;
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
export const CLOSED_HOW: readonly ClosedHow[] = ['quit', 'ended', 'unknown'];

/** Sessions marked as needing you, for `reason`, from `now`: a session already marked takes the newer reason. */
export function markedNeedsYou(needsYou: Readonly<Record<string, NeedsYou>>, ids: readonly string[], reason: ClosedHow, now: number): Record<string, NeedsYou> {
  return { ...needsYou, ...Object.fromEntries(ids.map((id) => [id, { reason, at: now }])) };
}

/** A needs-you mark gone, whether or not it was there. */
export function clearedNeedsYou(needsYou: Readonly<Record<string, NeedsYou>>, id: string): Record<string, NeedsYou> {
  const next = { ...needsYou };
  delete next[id];
  return next;
}

/** An archive entry gone, whether or not it was there. */
export function unarchived(archived: Readonly<Record<string, number>>, id: string): Record<string, number> {
  const next = { ...archived };
  delete next[id];
  return next;
}

/** A deleted session's marks forgotten: its pin, its archive entry, its note and its needs-you mark (`purgedSession` forgets the rest of what meta holds about it). */
export function withoutSession(marks: Readonly<SessionMarks>, id: string): SessionMarks {
  const archived = unarchived(marks.archived, id);
  const notes = { ...marks.notes };
  delete notes[id];
  return { pinned: marks.pinned.filter((key) => key !== id), archived, notes, needsYou: clearedNeedsYou(marks.needsYou, id) };
}

/** What else meta holds about a session, as `meta.json` holds it: the tabs open, which of them run and which you paused, the one on show overall and per project, and who is in which group. */
export interface SessionPlaces {
  openSessions: string[];
  runningSessions: string[];
  pausedSessions: string[];
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
    pausedSessions: meta.pausedSessions.filter((key) => key !== id),
    scheduledWhenStopped: Object.fromEntries(Object.entries(meta.scheduledWhenStopped).filter(([key]) => key !== id)),
    activeSession: meta.activeSession === id ? null : meta.activeSession,
    activeSessionByProject: Object.fromEntries(Object.entries(meta.activeSessionByProject).filter(([, key]) => key !== id)),
    groupOf,
  };
}
