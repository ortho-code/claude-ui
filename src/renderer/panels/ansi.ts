/**
 * Strip terminal escape sequences from command output, so `ls --color=always` does not paint garbage into a `<pre>`.
 *
 * Defensive, on top of `NO_COLOR=1` and `TERM=dumb` in the command's environment: those are requests, and not every tool listens.
 * Three shapes, MEASURED from real `git` and `ls` output rather than from the standard:
 * - CSI: `ESC [`, parameter bytes, intermediate bytes, one final byte — colour (`ESC[31m`, `ESC[m`, `ESC[38;2;…m`), cursor and erase (`ESC[?25l`, `ESC[2K`).
 * - Strings: `ESC ]` (OSC, a title or an OSC 8 hyperlink), `ESC P` (DCS), `ESC _`, `ESC ^`, `ESC X`, each up to `BEL` or `ESC \`.
 * - Two-byte escapes: `ESC (` `B` (charset), `ESC c` (reset), `ESC 7`/`ESC 8` (save/restore cursor) — an ESC, optional intermediates, one final.
 * Nothing else is touched: `\r`, `\t` and the text stay as they came.
 */

// One alternation, longest shapes first so a string escape is consumed whole rather than as an ESC plus text.
// The two-byte form excludes the introducers of the other two (`[`, `]`, `P`, `X`, `^`, `_`) as its final byte, so a CSI or string escape cut off right after its introducer reads as incomplete rather than as a complete short one.
const ESCAPES =
  // eslint-disable-next-line no-control-regex
  /\x1b\[[0-?]*[ -/]*[@-~]|\x1b[\]P_^X][\s\S]*?(?:\x07|\x1b\\)|\x1b(?:[ -/]+[0-~]|[0-OQ-WY-Z\\`-~])/g;

export function stripAnsi(text: string): string {
  return text.replace(ESCAPES, '');
}

/**
 * Split off a trailing escape that a chunk boundary cut in half, so the caller can hold it and prepend it to the next chunk.
 * Output arrives in reads, and a read can end in the middle of `ESC[3` `1m`; stripped read by read that leaves `1m` in the text.
 * Returns the text safe to strip now and the incomplete tail, which is '' when the chunk ends cleanly.
 */
export function splitPendingEscape(text: string): [string, string] {
  const esc = text.lastIndexOf('\x1b');
  if (esc === -1) return [text, ''];
  const tail = text.slice(esc);
  // A complete sequence at the end is fine to strip now; only one the regex cannot finish is held back.
  const whole = tail.match(ESCAPES);
  if (whole?.[0].length === tail.length) return [text, ''];
  // A string escape that has not seen its terminator yet is also incomplete, however long it is.
  return [text.slice(0, esc), tail];
}
