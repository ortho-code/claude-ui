import type { DiffHunk, DiffRow, FileDiff } from '../../../../../shared/diff/types';
import { element } from '../../../../ui/dom';
import { colourLines, type Colour } from '../../../../ui/syntax';
import './hunks.css';

/**
 * A file's hunks drawn into the diff's body: split as one grid of three columns in one scroller, so the two sides scroll together with nothing keeping them in step, or unified as one column.
 * The unchanged lines between hunks are drawn from the file as it is on disk: all of them for the whole file, else folded, opened whole on a press or 20 lines from either end.
 * Without the file's lines, a deleted file or one past the read's cap, they stay folds either way, which ask git for more context.
 * Every row of a change block carries the block's number (`data-blk`), and the first row of each is handed back, for stepping and the change map.
 */

/** How many lines a fold's steps show from either end. */
const STEP = 20;

/** The fewest unchanged lines that fold: fewer are shown, since a fold saying "1 unchanged line" takes the room of the line it hides. */
const MIN_FOLD = 5;

/**
 * How far a fold has been opened, per fold: lines shown from its top and from its bottom.
 * Keyed by the hunk the fold sits above, and the hunk count for the one after the last.
 */
export type Reveal = Map<number, { top: number; bottom: number }>;

/** Past this many characters a side is coloured line by line rather than as one text: the colouring's cost is the text's length, and a side this long is rarely read whole. */
const WHOLE_SIDE_MAX = 128 * 1024;

export interface HunkDraw {
  split: boolean;
  /** Every unchanged line drawn, where the file's lines are there, rather than folds. */
  whole: boolean;
  /** The grammar the file is coloured with, or null for plain text. */
  language: string | null;
  reveal: Reveal;
  /** A fold was opened: draw again. */
  redraw(): void;
  /** A fold without the file's lines to draw from asks git for this many more lines of context around every change. */
  widen(lines: number): void;
}

/** One line of one side: its number, drawn from an attribute so a copied selection carries none, and its text coloured, with the words that changed marked. */
function lineEl(row: DiffRow | null, side: 'old' | 'new', colours: Colour[] | null): HTMLElement {
  const empty = !row || (side === 'old' && row.kind === 'add') || (side === 'new' && row.kind === 'del');
  const line = element('div', `diff-line${empty ? ' empty' : row.kind === 'context' ? '' : ` ${row.kind}`}`);
  const number = element('i');
  number.dataset.n = empty ? '' : String((side === 'old' ? row.old : row.new) ?? '');
  const text = element('s');
  if (!empty) paint(text, row, colours);
  line.append(number, text);
  return line;
}

/** A unified line: both numbers, then its text. */
function unifiedEl(row: DiffRow, colours: Colour[] | null): HTMLElement {
  const line = element('div', `diff-line unified${row.kind === 'context' ? '' : ` ${row.kind}`}`);
  const old = element('i');
  old.dataset.n = row.old === null ? '' : String(row.old);
  const now = element('i');
  now.dataset.n = row.new === null ? '' : String(row.new);
  const text = element('s');
  paint(text, row, colours);
  line.append(old, now, text);
  return line;
}

/**
 * A row's text, cut where either its colour or its changed words start or end, each piece a span of its colour, marked when it changed; a blank line keeps a space so it has a height.
 * The two are ranges over the same text rather than markup, so a changed word inside a coloured token, or across two, is marked without cutting into either.
 */
function paint(into: HTMLElement, row: DiffRow, colours: Colour[] | null): void {
  const { text } = row;
  if (!text) {
    into.textContent = ' ';
    return;
  }
  const colourAt: (Colour | null)[] = new Array<Colour | null>(text.length).fill(null);
  for (const colour of colours ?? []) for (let at = colour.start; at < Math.min(colour.end, text.length); at++) colourAt[at] = colour;
  const changed = new Uint8Array(text.length);
  for (const [start, end] of row.words ?? []) changed.fill(1, start, end);
  let at = 0;
  while (at < text.length) {
    let end = at + 1;
    while (end < text.length && colourAt[end] === colourAt[at] && changed[end] === changed[at]) end++;
    const colour = colourAt[at];
    const piece = text.slice(at, end);
    if (!colour && !changed[at]) into.append(piece);
    else {
      const span = element('span', changed[at] ? (row.kind === 'add' ? 'word-add' : 'word-del') : '');
      if (colour) span.style.color = colour.colour;
      if (colour?.italic) span.style.fontStyle = 'italic';
      span.textContent = piece;
      into.append(span);
    }
    at = end;
  }
}

/** The file as its base had it, from the file as it is now and the hunks between them: outside the hunks the two sides are the same lines, inside them the old side is the unchanged rows and the removed ones. */
function oldLinesOf(file: FileDiff, lines: readonly string[]): string[] {
  const old: string[] = [];
  let next = 0;
  for (const hunk of file.hunks) {
    // A hunk with no new row, a removal at the very start, names the line it follows rather than one it starts on.
    const before = hunk.rows.some((row) => row.kind !== 'del') ? hunk.newStart - 1 : hunk.newStart;
    while (next < before && next < lines.length) old.push(lines[next++]!);
    for (const row of hunk.rows) {
      if (row.kind !== 'add') old.push(row.text);
      if (row.kind !== 'del') next++;
    }
  }
  while (next < lines.length) old.push(lines[next++]!);
  return old;
}

interface Sides {
  old: Colour[][];
  new: Colour[][];
  oldText: string[];
}

/** Each read file's sides once coloured, so opening a fold, which draws the file again, does not colour it again; a read of the file is a new object, and is coloured afresh. */
const coloured = new WeakMap<FileDiff, Sides | null>();

/** Each side of a file coloured as one text, or null for sides coloured line by line: no grammar, no file on disk to build them from, or a side past `WHOLE_SIDE_MAX`. */
function sidesOf(file: FileDiff, language: string | null): Sides | null {
  if (!language || !file.lines) return null;
  if (coloured.has(file)) return coloured.get(file)!;
  const oldText = oldLinesOf(file, file.lines);
  const length = (lines: readonly string[]): number => lines.reduce((sum, line) => sum + line.length + 1, 0);
  const sides = length(file.lines) > WHOLE_SIDE_MAX || length(oldText) > WHOLE_SIDE_MAX ? null : { old: colourLines(oldText, language), new: colourLines(file.lines, language), oldText };
  coloured.set(file, sides);
  return sides;
}

/** A hunk's rows side by side: an unchanged row on both, a run of removed rows beside the run of added rows after it, the shorter run padded so the two stay in step. */
function pairs(rows: DiffRow[]): [DiffRow | null, DiffRow | null][] {
  const out: [DiffRow | null, DiffRow | null][] = [];
  let at = 0;
  while (at < rows.length) {
    if (rows[at]!.kind === 'context') {
      out.push([rows[at]!, rows[at]!]);
      at++;
      continue;
    }
    const removed: DiffRow[] = [];
    const added: DiffRow[] = [];
    while (at < rows.length && rows[at]!.kind === 'del') removed.push(rows[at++]!);
    while (at < rows.length && rows[at]!.kind === 'add') added.push(rows[at++]!);
    for (let k = 0; k < Math.max(removed.length, added.length); k++) out.push([removed[k] ?? null, added[k] ?? null]);
  }
  return out;
}

/** The last line each side of a hunk reaches, so the fold after it starts on the next. */
function ends(hunk: DiffHunk): { old: number; new: number } {
  let old = hunk.oldStart - 1;
  let now = hunk.newStart - 1;
  for (const row of hunk.rows) {
    old = row.old ?? old;
    now = row.new ?? now;
  }
  return { old, new: now };
}

export class HunkDrawer {
  private block = -1;
  private inBlock = false;
  private readonly anchors: HTMLElement[] = [];
  private readonly sides: ReturnType<typeof sidesOf>;

  constructor(
    private readonly body: HTMLElement,
    private readonly file: FileDiff,
    private readonly draw: HunkDraw,
  ) {
    this.sides = sidesOf(file, draw.language);
  }

  /**
   * A row's colours on one side: from that side's whole-text pass where the line it names there is the row's text, else from the row alone.
   * The two can disagree with whitespace hidden, or when the file moved between reading it and its diff; the row then loses what the lines around it would have told, a comment it sits in, but keeps its colours.
   */
  private colours(row: DiffRow | null, side: 'old' | 'new'): Colour[] | null {
    const language = this.draw.language;
    if (!row || !language) return null;
    const old = row.kind === 'del' || (row.kind === 'context' && side === 'old');
    const at = ((old ? row.old : row.new) ?? 0) - 1;
    if (this.sides && (old ? this.sides.oldText : this.file.lines)?.[at] === row.text) return (old ? this.sides.old : this.sides.new)[at] ?? null;
    return colourLines([row.text], language)[0] ?? null;
  }

  /** Draw every hunk and the folds around them; answers the first row of each change block. */
  all(): HTMLElement[] {
    this.body.replaceChildren();
    this.body.classList.toggle('split', this.draw.split);
    const { hunks, lines } = this.file;
    let previous: { old: number; new: number } = { old: 0, new: 0 };
    let lastHeading = '';
    hunks.forEach((hunk, index) => {
      const folded = this.gap(index, previous, hunk.gapBefore);
      if (hunk.heading && folded && hunk.heading !== lastHeading) this.body.append(this.heading(hunk.heading));
      lastHeading = hunk.heading;
      this.hunk(hunk);
      previous = ends(hunk);
    });
    if (lines && (hunks.length || this.draw.whole)) this.gap(hunks.length, previous, lines.length - previous.new);
    return this.anchors;
  }

  private heading(text: string): HTMLElement {
    const heading = element('div', 'diff-heading');
    heading.textContent = text;
    return heading;
  }

  private context(row: DiffRow): void {
    if (this.draw.split) this.body.append(lineEl(row, 'old', this.colours(row, 'old')), element('div', 'diff-gutter'), lineEl(row, 'new', this.colours(row, 'new')));
    else this.body.append(unifiedEl(row, this.colours(row, 'new')));
  }

  /** The unchanged lines after `previous`, `count` of them, as far as their fold is open; answers whether any stay folded. */
  private gap(index: number, previous: { old: number; new: number }, count: number): boolean {
    if (count <= 0) return false;
    const lines = this.file.lines;
    if (!lines) {
      if (index < this.file.hunks.length) this.body.append(this.foldBar(`${count} unchanged lines`, () => this.draw.widen(Math.max(count, STEP))));
      return true;
    }
    const row = (k: number): DiffRow => ({ kind: 'context', old: previous.old + 1 + k, new: previous.new + 1 + k, text: lines[previous.new + k] ?? '' });
    const seen = this.draw.reveal.get(index) ?? { top: 0, bottom: 0 };
    if (this.draw.whole || seen.top + seen.bottom >= count || count - seen.top - seen.bottom < MIN_FOLD) {
      for (let k = 0; k < count; k++) this.context(row(k));
      return false;
    }
    for (let k = 0; k < seen.top; k++) this.context(row(k));
    const hidden = count - seen.top - seen.bottom;
    const show = (top: number, bottom: number): void => {
      this.draw.reveal.set(index, { top: seen.top + top, bottom: seen.bottom + bottom });
      this.draw.redraw();
    };
    const bar = this.foldBar(`${hidden} unchanged line${hidden === 1 ? '' : 's'}`, () => show(count, 0));
    if (hidden > STEP && index > 0) bar.prepend(this.step(`↓ ${STEP}`, 'Show more below the change above', () => show(STEP, 0)));
    if (hidden > STEP && index < this.file.hunks.length) bar.prepend(this.step(`↑ ${STEP}`, 'Show more above the change below', () => show(0, STEP)));
    this.body.append(bar);
    for (let k = count - seen.bottom; k < count; k++) this.context(row(k));
    return true;
  }

  private foldBar(words: string, open: () => void): HTMLElement {
    const bar = element('button', 'diff-fold');
    bar.type = 'button';
    bar.title = 'Show them all';
    bar.append(`⋯ ${words}`);
    bar.addEventListener('click', open);
    return bar;
  }

  private step(label: string, tip: string, go: () => void): HTMLElement {
    const step = element('span', 'diff-fold-step');
    step.textContent = label;
    step.title = tip;
    step.addEventListener('click', (event) => {
      event.stopPropagation();
      go();
    });
    return step;
  }

  /** A hunk's rows, each change block numbered; in split view a block's first row is its right side, the file as it is now, where a block that only removes marks the place its lines went. */
  private hunk(hunk: DiffHunk): void {
    this.inBlock = false;
    if (!this.draw.split) {
      for (const row of hunk.rows) {
        const line = unifiedEl(row, this.colours(row, row.kind === 'del' ? 'old' : 'new'));
        this.mark(row.kind !== 'context', line, [line]);
        this.body.append(line);
      }
      return;
    }
    for (const [left, right] of pairs(hunk.rows)) {
      const old = lineEl(left, 'old', this.colours(left, 'old'));
      const now = lineEl(right, 'new', this.colours(right, 'new'));
      this.mark(left?.kind === 'del' || right?.kind === 'add', now, [old, now]);
      this.body.append(old, element('div', 'diff-gutter'), now);
    }
  }

  /** Number a changed row's elements with its block, starting a block at the first changed row after an unchanged one. */
  private mark(changed: boolean, anchor: HTMLElement, rows: HTMLElement[]): void {
    if (!changed) {
      this.inBlock = false;
      return;
    }
    if (!this.inBlock) {
      this.block++;
      this.anchors.push(anchor);
      this.inBlock = true;
    }
    for (const row of rows) row.dataset.blk = String(this.block);
  }
}
