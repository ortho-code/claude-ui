import type { Exchange } from '../../../../../shared/types';
import { exchangeNode, type ExchangeDrawing } from './exchange';

/** How long one slice of drawing may hold the window. */
const SLICE_MS = 12;
/** How often the bar measures the list while it is drawn in slices. */
const BAR_EVERY_MS = 250;

/** What the list asks of the view it is drawn in. */
export interface ListHooks {
  /** The exchanges as they are now: a slice drawn later draws them as they are then. */
  exchanges(): readonly Exchange[];
  atEnd(): boolean;
  scrollToEnd(): void;
  /** After each slice: hide what the filter hides. */
  filter(): void;
  /** The list changed size or order, so the bar measures it again. */
  layout(): void;
  /** More is drawn: reopen where the tab was left, once that part is in. */
  drewMore(): void;
}

/**
 * The history's exchanges, drawn into its list.
 * A whole history is drawn in slices with the window free between them: first the newest, which is where the history opens, then the rest from the oldest up, each slice going in just above that newest part.
 * So what is drawn is a run from the start, up to `drawnTo`, and the newest, from `tailFrom` on; the two meet once it is all drawn.
 * Drawn at once, the longest session here held the window for 1–2 s on every switch to its tab, most of it the browser laying out the whole list in one go.
 * Drawn newest first all the way down, every slice went in above everything drawn and made the browser lay all of that out again: twice the work, in slices that grew to 300 ms.
 */
export class HistoryList {
  readonly el = document.createElement('div');
  /** Each exchange's node, by its place in the history; one not drawn yet is missing. */
  nodes: HTMLElement[] = [];
  private drawnTo = 0;
  private tailFrom = 0;
  /** Counts the times drawing started from the start, so a slice due for an earlier drawing knows to stop. */
  private slicing = 0;
  /** When the bar last measured the list while it was drawn in slices. */
  private measuredAt = 0;

  constructor(
    private readonly drawing: ExchangeDrawing,
    private readonly hooks: ListHooks,
  ) {
    this.el.className = 'history-list';
  }

  /** Empty it, stopping any slice still to come. */
  reset(): void {
    this.slicing++;
    this.el.replaceChildren();
    this.nodes = [];
    this.drawnTo = 0;
    this.tailFrom = 0;
  }

  /** Draw the exchanges from `from` on, replacing those already drawn: only the last one ever changes, or what a rewind marked. */
  draw(from: number): void {
    const exchanges = this.hooks.exchanges();
    const total = exchanges.length;
    if (from === 0) {
      this.reset();
      this.tailFrom = total;
    }
    for (let k = total; k < this.nodes.length; k++) this.nodes[k]?.remove();
    this.nodes.length = Math.min(this.nodes.length, total);
    this.tailFrom = Math.min(this.tailFrom, total);
    this.drawnTo = Math.min(this.drawnTo, this.tailFrom);
    // Drawn already and changed; one not drawn yet gets the exchanges as they are when its slice comes.
    for (let k = from; k < this.nodes.length; k++) {
      const old = this.nodes[k];
      if (!old) continue;
      const node = exchangeNode(exchanges[k]!, k, this.drawing);
      old.replaceWith(node);
      this.nodes[k] = node;
    }
    if (this.nodes.length > 0) {
      // New at the end, a few at a time as claude goes on.
      for (let k = this.nodes.length; k < total; k++) this.el.append((this.nodes[k] = exchangeNode(exchanges[k]!, k, this.drawing)));
    } else if (total > 0) {
      this.tailFrom = this.drawTail(total, performance.now() + SLICE_MS);
      if (this.drawnTo < this.tailFrom) this.sliceOn(this.slicing);
    }
  }

  /** Say `text` in place of the exchanges. */
  showEmpty(text: string): void {
    const empty = document.createElement('p');
    empty.className = 'history-empty';
    empty.textContent = text;
    this.el.replaceChildren(empty);
  }

  /**
   * Draw the newest exchanges, back from `end`, until `deadline` (always one).
   * Says where they start.
   */
  private drawTail(end: number, deadline: number): number {
    const exchanges = this.hooks.exchanges();
    const fresh: HTMLElement[] = [];
    let k = end;
    do {
      k--;
      const node = exchangeNode(exchanges[k]!, k, this.drawing);
      this.nodes[k] = node;
      fresh.push(node);
    } while (k > 0 && performance.now() < deadline);
    this.el.append(...fresh.reverse());
    return k;
  }

  /** Draw the next slice up from `drawnTo`, once the window has had its turn, until the whole history is drawn or it is drawn again from the start (`token` changes). */
  private sliceOn(token: number): void {
    window.setTimeout(() => {
      if (token !== this.slicing || this.drawnTo >= this.tailFrom) return;
      const exchanges = this.hooks.exchanges();
      // Put in above what is in view, which stays where it is; at the end, the view stays at the end.
      const atEnd = this.hooks.atEnd();
      const deadline = performance.now() + SLICE_MS;
      const slice = document.createDocumentFragment();
      do {
        const k = this.drawnTo++;
        slice.append((this.nodes[k] = exchangeNode(exchanges[k]!, k, this.drawing)));
      } while (this.drawnTo < this.tailFrom && performance.now() < deadline);
      this.el.insertBefore(slice, this.nodes[this.tailFrom] ?? null);
      if (atEnd) this.hooks.scrollToEnd();
      this.hooks.filter();
      // The bar measures the whole list, so not after every slice.
      const done = this.drawnTo >= this.tailFrom;
      const now = performance.now();
      if (done || now - this.measuredAt > BAR_EVERY_MS) {
        this.measuredAt = now;
        this.hooks.layout();
      }
      this.hooks.drewMore();
      if (!done) this.sliceOn(token);
    }, 0);
  }
}
