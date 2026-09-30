/**
 * Where a history read's answer starts, for a caller holding `known` exchanges of a transcript that now has `total`.
 * A caller of another read (`sameRead` false: the first read, or the transcript was read again from the start) gets everything from 0.
 * Otherwise only the last exchange ever changes, so the caller's last one is sent again with everything after it — or, when a rewind has marked earlier ones, everything from `changedFrom`, the first of those.
 * Main's rule (`readHistory` in src/main/transcript.ts); shared so that the window's checks answer a later read the way main does.
 */
export function readFrom(known: number, total: number, sameRead: boolean, changedFrom: number | null): number {
  const tail = sameRead ? Math.max(0, Math.min(known, total) - 1) : 0;
  return Math.min(tail, changedFrom ?? tail);
}
