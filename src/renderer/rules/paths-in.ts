/** A piece of one line of output that looks like a path: where it stands, the path, and the line number after it, if any. */
export interface PathMatch {
  start: number;
  end: number;
  path: string;
  line: number | null;
}

/**
 * The file a `file://` link names on this machine, and the line its fragment names when it is exactly `#42` or `#L42`; null for any other link, one naming another host, and one whose escapes are no UTF-8.
 */
export function fileOfUri(uri: string): { path: string; line: number | null } | null {
  let url: URL;
  try {
    url = new URL(uri);
  } catch {
    return null;
  }
  if (url.protocol !== 'file:' || !['', 'localhost'].includes(url.hostname)) return null;
  const line = /^#L?(\d+)$/.exec(url.hash);
  try {
    return { path: decodeURIComponent(url.pathname), line: line ? Number(line[1]) : null };
  } catch {
    // An escape that is no UTF-8 names no file anyone can open.
    return null;
  }
}

/**
 * A terminal row's text, from each of its `columns` cells as `cellAt` gives it, with the cell each UTF-16 unit of the text stands in, which a link's range is counted in.
 * A cell nothing was written to has no characters, as where a program moved the cursor rather than writing a space, and reads as a space; the second half of a wide character, of width 0, reads as nothing.
 */
export function cellText(columns: number, cellAt: (x: number) => { chars: string; width: number }): { text: string; cells: number[] } {
  let text = '';
  const cells: number[] = [];
  for (let x = 0; x < columns; x++) {
    const cell = cellAt(x);
    const chars = cell.chars || (cell.width > 0 ? ' ' : '');
    text += chars;
    // Per UTF-16 unit, as `pathsIn` counts: an emoji outside the basic plane is two units in one cell.
    cells.push(...new Array<number>(chars.length).fill(x));
  }
  return { text, cells };
}

/** A URL, which is the web links' to open, and whose path part is no file. */
const ANY_URL = /\b[a-z][a-z0-9+.-]*:\/\/\S+/gi;

/** A run of the characters a path is written in, with a `:line` or `:line:column` after it. */
const RUN = /[\w.~@+\-/]+(?::\d+(?::\d+)?)?/g;

/** A file's extension, which a name without a folder needs to count as a path. */
const EXTENSION = /\.[A-Za-z][A-Za-z0-9]{0,9}$/;

/** Whether a piece reads as a path: a letter in it, and a folder in it or an extension at its end, `~` only as the home folder, no flag. */
function pathLike(piece: string): boolean {
  if (piece.length < 3 || !/[A-Za-z]/.test(piece) || piece.startsWith('-')) return false;
  if (piece.includes('~') && !piece.startsWith('~/')) return false;
  return piece.startsWith('/') || piece.startsWith('~/') || /[^/]\/[^/]/.test(piece) || EXTENSION.test(piece);
}

/**
 * The pieces of a line of output that read as paths, in order: a URL left out, and a full stop or dash ending a sentence after one left off it.
 * Whether a piece names a file is not known here; only a file that is there should become a link.
 */
export function pathsIn(text: string): PathMatch[] {
  const masked = text.replace(ANY_URL, (url) => ' '.repeat(url.length));
  const found: PathMatch[] = [];
  for (const match of masked.matchAll(RUN)) {
    const whole = match[0];
    const number = /:(\d+)(?::\d+)?$/.exec(whole);
    const path = (number ? whole.slice(0, number.index) : whole).replace(/[.-]+$/, '');
    if (!pathLike(path)) continue;
    found.push({ start: match.index, end: match.index + (number ? whole.length : path.length), path, line: number ? Number(number[1]) : null });
  }
  return found;
}
