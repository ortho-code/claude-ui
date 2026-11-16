import type { DiffHunk, DiffRow, FileDiff } from '../../../../shared/diff/types';
import { element } from '../../../ui/dom';
import './hunks.css';

/**
 * A file's hunks drawn into the diff's body: split as one grid of three columns in one scroller, so the two sides scroll together with nothing keeping them in step, or unified as one column.
 * The unchanged lines between hunks are folded, and drawn from the file as it is on disk: the whole fold on a press, or 20 lines from either end.
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

export interface HunkDraw {
  split: boolean;
  reveal: Reveal;
  /** A fold was opened: draw again. */
  redraw(): void;
  /** A fold without the file's lines to draw from asks git for this many more lines of context around every change. */
  widen(lines: number): void;
}

/** One line of one side: its number, drawn from an attribute so a copied selection carries none, and its text with the words that changed marked. */
function lineEl(row: DiffRow | null, side: 'old' | 'new'): HTMLElement {
  const empty = !row || (side === 'old' && row.kind === 'add') || (side === 'new' && row.kind === 'del');
  const line = element('div', `diff-line${empty ? ' empty' : row.kind === 'context' ? '' : ` ${row.kind}`}`);
  const number = element('i');
  number.dataset.n = empty ? '' : String((side === 'old' ? row.old : row.new) ?? '');
  const text = element('s');
  if (!empty) paintWords(text, row);
  line.append(number, text);
  return line;
}

/** A unified line: both numbers, then its text. */
function unifiedEl(row: DiffRow): HTMLElement {
  const line = element('div', `diff-line unified${row.kind === 'context' ? '' : ` ${row.kind}`}`);
  const old = element('i');
  old.dataset.n = row.old === null ? '' : String(row.old);
  const now = element('i');
  now.dataset.n = row.new === null ? '' : String(row.new);
  const text = element('s');
  paintWords(text, row);
  line.append(old, now, text);
  return line;
}

/** A row's text, the ranges that changed in spans of their own; a blank line keeps a space so it has a height. */
function paintWords(into: HTMLElement, row: DiffRow): void {
  const words = row.words ?? [];
  if (!row.text) {
    into.textContent = ' ';
    return;
  }
  let at = 0;
  for (const [start, end] of words) {
    if (start > at) into.append(row.text.slice(at, start));
    const mark = element('span', row.kind === 'add' ? 'word-add' : 'word-del');
    mark.textContent = row.text.slice(start, end);
    into.append(mark);
    at = end;
  }
  if (at < row.text.length) into.append(row.text.slice(at));
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

  constructor(
    private readonly body: HTMLElement,
    private readonly file: FileDiff,
    private readonly draw: HunkDraw,
  ) {}

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
    if (lines && hunks.length) this.gap(hunks.length, previous, lines.length - previous.new);
    return this.anchors;
  }

  private heading(text: string): HTMLElement {
    const heading = element('div', 'diff-heading');
    heading.textContent = text;
    return heading;
  }

  private context(row: DiffRow): void {
    if (this.draw.split) this.body.append(lineEl(row, 'old'), element('div', 'diff-gutter'), lineEl(row, 'new'));
    else this.body.append(unifiedEl(row));
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
    if (seen.top + seen.bottom >= count || count - seen.top - seen.bottom < MIN_FOLD) {
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
        const line = unifiedEl(row);
        this.mark(row.kind !== 'context', line, [line]);
        this.body.append(line);
      }
      return;
    }
    for (const [left, right] of pairs(hunk.rows)) {
      const old = lineEl(left, 'old');
      const now = lineEl(right, 'new');
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
