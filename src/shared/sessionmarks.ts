/**
 * Main's rules for the marks a session carries in meta — its pin, its archive entry, its note (written with `withText`, src/shared/text.ts) — pure, so that the window's checks answer them the way main does.
 * Main (src/main/meta.ts) applies them inside its serialised writes of `meta.json`.
 */

/** The three marks, as `meta.json` holds them. */
export interface SessionMarks {
  pinned: string[];
  archived: Record<string, number>;
  notes: Record<string, string>;
}

/** A pin toggled: in if it was out, out if it was in, the order of the rest kept. */
export function togglePinned(pinned: readonly string[], id: string): string[] {
  const set = new Set(pinned);
  if (set.has(id)) set.delete(id);
  else set.add(id);
  return [...set];
}

/** An archive entry toggled: gone if it was there, there from `now` if it was not. */
export function toggleArchived(archived: Readonly<Record<string, number>>, id: string, now: number): Record<string, number> {
  const next = { ...archived };
  if (id in next) delete next[id];
  else next[id] = now;
  return next;
}

/** A deleted session's marks forgotten: its pin, its archive entry and its note (`purgedSession` forgets the rest of what meta holds about it). */
export function withoutSession(marks: Readonly<SessionMarks>, id: string): SessionMarks {
  const archived = { ...marks.archived };
  delete archived[id];
  const notes = { ...marks.notes };
  delete notes[id];
  return { pinned: marks.pinned.filter((key) => key !== id), archived, notes };
}

/** What else meta holds about a session, as `meta.json` holds it: the tabs open, the one on show overall and per project, and who is in which group. */
export interface SessionPlaces {
  openSessions: string[];
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
    activeSession: meta.activeSession === id ? null : meta.activeSession,
    activeSessionByProject: Object.fromEntries(Object.entries(meta.activeSessionByProject).filter(([, key]) => key !== id)),
    groupOf,
  };
}
