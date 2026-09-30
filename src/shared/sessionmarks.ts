/**
 * Main's rules for the marks a session carries in meta — its pin, its archive entry, its note — pure, so that the window's checks answer them the way main does.
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

/** A note written: trimmed, and a blank one removes the note, which is how a note is deleted. */
export function withNote(notes: Readonly<Record<string, string>>, id: string, note: string): Record<string, string> {
  const next = { ...notes };
  const trimmed = note.trim();
  if (trimmed) next[id] = trimmed;
  else delete next[id];
  return next;
}

/** A deleted session's marks forgotten: its pin, its archive entry and its note (`purgeSession` forgets the rest of what meta holds about it). */
export function withoutSession(marks: Readonly<SessionMarks>, id: string): SessionMarks {
  const archived = { ...marks.archived };
  delete archived[id];
  const notes = { ...marks.notes };
  delete notes[id];
  return { pinned: marks.pinned.filter((key) => key !== id), archived, notes };
}
