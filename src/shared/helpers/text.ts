/**
 * A text kept under a key, as main keeps a session's note and a project's name: trimmed, and a blank one removes the entry.
 * So presence alone says there is one — a note's mark cannot linger over nothing, and a project without a name is called after its folder again.
 * Pure, so that the window's checks answer it the way main does.
 */
export function withText(texts: Readonly<Record<string, string>>, key: string, text: string): Record<string, string> {
  const next = { ...texts };
  const trimmed = text.trim();
  if (trimmed) next[key] = trimmed;
  else delete next[key];
  return next;
}
