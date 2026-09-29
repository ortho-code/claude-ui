import type { ClaudeUiApi, Exchange, HistoryPin, ReplyPart } from '../../shared/types';
import { flash } from '../flash';
import { relativeTime } from '../logic';
import { chevronIcon, PIN_ICON, PINNED_ICON } from '../svg';
import { setTooltip } from '../tooltip';
import { renderMarkdown, routeLinks } from './markdown';
import type { Band } from './marks';
import { applySlice, emptyModel, replyBlocks, requestLabel, toolSummary, type HistoryModel } from './model';

/** What the history needs from the rest of the window. */
export interface HistoryHost {
  getHistory: ClaudeUiApi['getHistory'];
  toggleHistoryPin: ClaudeUiApi['toggleHistoryPin'];
  openExternal(url: string): void;
  /** Hand the pane back to the live terminal. */
  leave(): void;
  /** Open the history on the tab on show, the way every other way in does. */
  open(): void;
}

const MARKS: Partial<Record<Exchange['kind'], [label: string, tooltip: string]>> = {
  busy: ['sent while claude was working', 'Sent while claude was still working on something else, and taken up by it.'],
};
const REPLACED: [string, string] = ['sent again', 'You stopped this and sent it again: the request below replaced it.'];
const REWOUND: [string, string] = ['rewound', "You went back to before this with claude's rewind and carried on from there, so claude's conversation no longer has it."];

/** How long one slice of drawing may hold the window. */
const SLICE_MS = 12;
/** How often the bar measures the list while it is drawn in slices. */
const BAR_EVERY_MS = 250;

/** Where in a history to come back to: the exchange at the top of the view and how far past its request line, or null for the end. */
type Place = { at: number; offset: number } | null;

/**
 * The app's own view of a session's requests and claude's replies, read from its transcript.
 * It opens as a drawer over the terminal area, from the bar beside it, and is KEPT LAID OUT while the live terminal is on show — hidden by visibility, not display — so what is drawn can still be measured, which is how the bar places its marks.
 * One view for the active tab: switching tabs points it at the new tab's session.
 */
export class HistoryView {
  readonly el = document.createElement('section');
  /** What dims claude beside it while it is open over the live terminal; a click on it closes the history. Goes into the terminal area just before `el`. */
  readonly scrim = document.createElement('div');
  private readonly allButton = document.createElement('button');
  private readonly pinnedButton = document.createElement('button');
  private readonly scroller = document.createElement('div');
  private readonly list = document.createElement('div');
  private readonly note = document.createElement('div');
  /** The sentence it stands under while its tab has no claude behind it; null while there is a live view to go back to. */
  private standalone: string | null = null;
  private model: HistoryModel = emptyModel();
  private nodes: HTMLElement[] = [];
  private session: string | null = null;
  /** Counts the sessions followed, so a read that comes back after the view moved on can tell. */
  private followed = 0;
  private pins: Record<string, HistoryPin> = {};
  private pinnedOnly = false;
  private reading = false;
  private readAgain = false;
  /** Per session, where its history was left open when its tab was left: the exchange at the top and how far into it, or null for the end. A session left with it closed has no entry. */
  private readonly left = new Map<string, Place>();
  /** Where to reopen the session followed once its history has been read; undefined when it was left closed, or has been opened or closed since. */
  private reopen: Place | undefined;
  /** The folded runs of tool calls opened by hand, by exchange and where the run starts. */
  private readonly openRuns = new Set<string>();
  /** Drawn in slices (see draw): the exchanges before `drawnTo` and from `tailFrom` on are drawn, the ones between still to come. */
  private drawnTo = 0;
  private tailFrom = 0;
  /** Counts the times drawing started from the start, so a slice due for an earlier drawing knows to stop. */
  private slicing = 0;
  /** When the bar last measured the list while it was drawn in slices. */
  private measuredAt = 0;
  /** Whenever what is drawn changes size or order: the bar measures its marks from it. */
  onLayout: (() => void) | null = null;
  /** Whenever where you are in it changes, by scrolling or by the pane changing hands: the bar moves its band. */
  onScroll: (() => void) | null = null;

  constructor(private readonly host: HistoryHost) {
    this.el.className = 'history';
    this.el.setAttribute('aria-label', 'History of this session');

    const head = document.createElement('div');
    head.className = 'history-head';
    const title = document.createElement('span');
    title.className = 'history-title';
    title.textContent = 'History';
    // What is shown, as a labelled switch with the counts on it: all the requests, or only the pinned ones. An unlabelled star did not say it was a filter.
    const show = document.createElement('span');
    show.className = 'history-show';
    for (const [button, pinnedOnly, tooltip] of [
      [this.allButton, false, 'Show every request'],
      [this.pinnedButton, true, 'Show only the pinned requests'],
    ] as const) {
      button.type = 'button';
      button.className = 'history-filter';
      setTooltip(button, tooltip);
      button.addEventListener('click', () => this.setPinnedOnly(pinnedOnly));
      show.append(button);
    }
    const grow = document.createElement('span');
    grow.className = 'grow';
    const previous = this.stepButton('up', 'Previous request (Ctrl+Shift+↑)', -1);
    const next = this.stepButton('down', 'Next request (Ctrl+Shift+↓)', 1);
    // The way out, labelled and always in view at the head, with its key on it: a floating pill at the foot was not found.
    const leave = document.createElement('button');
    leave.type = 'button';
    leave.className = 'history-leave';
    leave.innerHTML = 'Back to live <kbd>Esc</kbd>';
    setTooltip(leave, 'Back to the live session');
    leave.addEventListener('click', () => this.leave());
    head.append(title, show, grow, previous, next, leave);

    this.scroller.className = 'history-scroll';
    this.list.className = 'history-list';
    this.scroller.append(this.list);
    // Focusable, so the page keys scroll it and Esc reaches it; -1 keeps it out of the tab order.
    this.scroller.tabIndex = -1;
    this.scroller.addEventListener('scroll', () => this.onScroll?.());
    this.scroller.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape' || event.ctrlKey || event.shiftKey || event.altKey || event.metaKey) return;
      event.preventDefault();
      this.leave();
    });
    routeLinks(this.scroller, (url) => this.host.openExternal(url));
    // Its width is the drawer's over a live tab and the whole pane's on a cold one, and the window's besides: every change rewraps the replies, and so moves the marks.
    new ResizeObserver(() => this.onLayout?.()).observe(this.list);

    this.scrim.className = 'history-scrim';
    this.scrim.addEventListener('mousedown', (event) => {
      event.preventDefault();
      this.leave();
    });

    this.note.className = 'history-note';
    this.note.hidden = true;
    this.el.append(head, this.note, this.scroller);
    this.drawCount();
  }

  /**
   * Show session `id`'s history, or nothing; the same session is a no-op.
   * Each tab keeps its own: leaving one with its history open remembers where, and coming back reopens it there once it has been read again.
   */
  follow(id: string | null): void {
    if (id === this.session) return;
    if (this.session) {
      if (this.shown) this.left.set(this.session, this.place());
      // Left again before its history came back: it was never closed, so it keeps where it was.
      else if (this.reopen === undefined) this.left.delete(this.session);
    }
    this.setStandalone(null);
    if (this.shown) this.host.leave();
    this.reopen = id ? this.left.get(id) : undefined;
    this.session = id;
    this.followed++;
    this.model = emptyModel();
    this.nodes = [];
    this.drawnTo = 0;
    this.tailFrom = 0;
    this.slicing++;
    this.list.replaceChildren();
    this.drawCount();
    if (id) void this.refresh();
    else this.drawEmpty();
    this.onLayout?.();
  }

  /** Drop what is remembered about session `id`, whose tab has gone: opening it again later starts closed. */
  forget(id: string): void {
    this.left.delete(id);
  }

  get shown(): boolean {
    return this.el.classList.contains('shown');
  }

  /** Whether it is standing in for a tab with no claude behind it. */
  get standing(): boolean {
    return this.standalone !== null;
  }

  /**
   * Stand in for a tab with no claude behind it, under `note` — the sentence the pane says for it — with `resume` to start it and a Close back to that sentence; null gives the pane back.
   * Only ever on request (the pane's "Show history", or the bar): a tab opened at launch shows the sentence, since the point is to work in a session, not to read it.
   * There is no live view to return to meanwhile, so "Back to live" is off.
   */
  setStandalone(note: string | null, resume?: HTMLElement): void {
    const was = this.standalone !== null;
    this.standalone = note;
    const text = document.createElement('span');
    text.className = 'history-note-text';
    text.textContent = note ?? '';
    const close = document.createElement('button');
    close.type = 'button';
    close.textContent = 'Close';
    setTooltip(close, 'Close the history (Esc)');
    close.addEventListener('click', () => this.setStandalone(null));
    this.note.replaceChildren(text, ...(resume ? [resume] : []), close);
    this.note.hidden = note === null;
    // Hidden before it turns back into the drawer, so closing it does not slide a drawer out; reading its style makes the browser take the hiding first, where it would otherwise take both changes at once and slide.
    if (note === null && was) {
      this.setShown(false);
      getComputedStyle(this.el).getPropertyValue('visibility');
    }
    this.el.classList.toggle('standalone', note !== null);
    if (note !== null) this.setShown(true);
    this.drawScrim();
  }

  /** The scrim is up while the history is open as the drawer, over a live claude. */
  private drawScrim(): void {
    this.scrim.classList.toggle('shown', this.shown && this.standalone === null);
  }

  private leave(): void {
    if (this.standalone === null) this.host.leave();
    else this.setStandalone(null);
  }

  /**
   * Take the pane from the live terminal, or give it back; says whether anything changed.
   * Taking it starts at the end, where the live view was, with the keys here.
   */
  setShown(shown: boolean): boolean {
    if (shown === this.shown) return false;
    // Opened or closed by hand before its history came back: that says where it should be now, not where it was left.
    this.reopen = undefined;
    this.el.classList.toggle('shown', shown);
    this.drawScrim();
    if (shown) {
      this.scrollToEnd();
      this.scroller.focus({ preventScroll: true });
    }
    this.onScroll?.();
    return true;
  }

  /**
   * Where each exchange on show starts, and its reply, as fractions of the whole history's height, for the bar to place its marks.
   * Measured from what is drawn, which is laid out even while the live terminal covers it; an exchange hidden by "Pinned only" is left out.
   */
  marks(): { k: number; request: number; reply: number | null; pinned: boolean; replyPinned: boolean; leftBehind: boolean }[] {
    const height = this.scroller.scrollHeight || 1;
    const marks: { k: number; request: number; reply: number | null; pinned: boolean; replyPinned: boolean; leftBehind: boolean }[] = [];
    this.model.exchanges.forEach((exchange, k) => {
      const node = this.nodes[k];
      if (!node || node.hidden) return;
      const reply = exchange.parts.length > 0 ? node.querySelector<HTMLElement>('.exchange-reply') : null;
      marks.push({ k, request: node.offsetTop / height, reply: reply ? reply.offsetTop / height : null, pinned: exchange.id in this.pins, replyPinned: this.pinnedMessages(exchange) > 0, leftBehind: exchange.replaced || exchange.rewound });
    });
    return marks;
  }

  /** How many of claude's messages in an exchange are pinned. */
  private pinnedMessages(exchange: Exchange): number {
    return exchange.parts.filter((part) => part.kind === 'text' && part.id in this.pins).length;
  }

  /** Whether an exchange holds a pin: on its request, or on any of claude's messages in it. */
  private holdsPin(exchange: Exchange): boolean {
    return exchange.id in this.pins || this.pinnedMessages(exchange) > 0;
  }

  /** The part of the history in view, as fractions of its height. */
  band(): Band {
    const total = this.scroller.scrollHeight || 1;
    return { top: this.scroller.scrollTop / total, height: this.scroller.clientHeight / total };
  }

  /** Put the top of the view at `top`, a fraction of the whole history: a drag on the bar. */
  scrollTo(top: number): void {
    this.scroller.scrollTop = top * this.scroller.scrollHeight;
  }

  /** What the loupe says about exchange `k`: its number, when, the request's first line, and the reply's (null when there is none). */
  describe(k: number): { number: number; time: string; request: string; reply: string | null; pinned: boolean; replyPinned: boolean } | null {
    const exchange = this.model.exchanges[k];
    if (!exchange) return null;
    // The reply's first message, as a line; a reply that is only tool calls so far is named by its first one.
    const first = exchange.parts.find((part) => part.kind === 'text') ?? exchange.parts[0];
    const reply = !first ? null : first.kind === 'text' ? requestLabel(first.text.replace(/^\s*(#{1,6}|>|[-*+])\s+/gm, '')) : `${first.name}${first.detail ? `(${first.detail})` : ''}`;
    return { number: k + 1, time: exchange.time, request: requestLabel(exchange.request), reply, pinned: exchange.id in this.pins, replyPinned: this.pinnedMessages(exchange) > 0 };
  }

  get size(): number {
    return this.model.exchanges.length;
  }

  /** Read what was added to the shown session's transcript and draw it; reads that pile up while one is in flight collapse into one more. */
  async refresh(): Promise<void> {
    if (!this.session) return;
    if (this.reading) {
      this.readAgain = true;
      return;
    }
    this.reading = true;
    try {
      do {
        this.readAgain = false;
        const session = this.session;
        if (!session) break;
        const followed = this.followed;
        const slice = await this.host.getHistory(session, this.model.exchanges.length, this.model.generation);
        // Pointed at another session while the read was out: this answer is for one no longer shown, so read again for the one that is.
        if (followed !== this.followed) {
          this.readAgain = true;
          continue;
        }
        const atEnd = this.atEnd();
        this.draw(applySlice(this.model, slice));
        if (atEnd) this.scrollToEnd();
        this.reopenWhereLeft();
      } while (this.readAgain);
    } finally {
      this.reading = false;
    }
  }

  setPins(pins: Record<string, HistoryPin>): void {
    this.pins = pins;
    this.model.exchanges.forEach((exchange, index) => {
      const node = this.nodes[index];
      if (node) this.drawPin(node, exchange);
    });
    this.applyFilter();
    this.drawCount();
    this.onLayout?.();
  }

  scrollToEnd(): void {
    this.scroller.scrollTop = this.scroller.scrollHeight;
  }

  /** Bring exchange `index` to the top, at its request or at its reply. */
  goTo(index: number, part: 'request' | 'reply' = 'request'): void {
    const node = this.nodes[index];
    if (!node) return;
    const target = (part === 'reply' ? node.querySelector<HTMLElement>('.exchange-reply') : node.querySelector<HTMLElement>('.exchange-request')) ?? node;
    this.scroller.scrollTop = target.offsetTop - 4;
    flash(target);
  }

  /** Where the view is, to come back to: the exchange at its top and how far into it, or null at the end, where it keeps following what claude adds. */
  private place(): Place {
    if (this.atEnd()) return null;
    const at = this.current();
    return { at, offset: this.scroller.scrollTop - this.anchor(at) };
  }

  /** Reopen the history where its tab left it, now that it has been read; the way in is the host's, so a tab with no claude behind it gets it standing. */
  private reopenWhereLeft(): void {
    const where = this.reopen;
    if (where === undefined) return;
    // Not drawn that far back yet: again once its slice is in.
    if (where && !this.nodes[where.at]) return;
    this.reopen = undefined;
    this.host.open();
    if (where) this.scroller.scrollTop = this.anchor(where.at) + where.offset;
  }

  /** Where a jump to exchange `index` puts the top of the view: its request line, which is what stepping measures from too. */
  private anchor(index: number): number {
    const node = this.nodes[index];
    const request = node?.querySelector<HTMLElement>('.exchange-request') ?? node;
    return request ? request.offsetTop - 4 : 0;
  }

  private stepButton(direction: 'up' | 'down', label: string, step: number): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'icon-btn compact';
    button.innerHTML = chevronIcon(direction, 14);
    button.setAttribute('aria-label', label);
    setTooltip(button, label);
    button.addEventListener('click', () => this.step(step));
    return button;
  }

  /** The exchange at the top of the view: the last one whose request line is at or above it. */
  private current(): number {
    const top = this.scroller.scrollTop + 8;
    let found = 0;
    this.nodes.forEach((node, index) => {
      if (!node.hidden && this.anchor(index) <= top) found = index;
    });
    return found;
  }

  /** Go to the previous (-1) or next (+1) request; says whether there was one to go to. */
  step(by: number): boolean {
    const visible = this.nodes.map((node, index) => (node.hidden ? -1 : index)).filter((index) => index >= 0);
    const at = this.current();
    // Scrolled into an exchange, "previous" goes to its own start first, as a page's previous-heading key does; sitting on its request line, it goes to the one before.
    const inside = this.scroller.scrollTop > this.anchor(at) + 8;
    const position = visible.indexOf(at);
    const target = by < 0 && inside ? at : visible[position + by];
    if (target === undefined) return false;
    this.goTo(target);
    return true;
  }

  private atEnd(): boolean {
    return this.scroller.scrollTop + this.scroller.clientHeight >= this.scroller.scrollHeight - 4;
  }

  private setPinnedOnly(on: boolean): void {
    this.pinnedOnly = on;
    this.drawSwitch();
    this.applyFilter();
    this.onLayout?.();
  }

  private drawSwitch(): void {
    this.allButton.classList.toggle('active', !this.pinnedOnly);
    this.allButton.setAttribute('aria-pressed', String(!this.pinnedOnly));
    this.pinnedButton.classList.toggle('active', this.pinnedOnly);
    this.pinnedButton.setAttribute('aria-pressed', String(this.pinnedOnly));
  }

  private applyFilter(): void {
    this.model.exchanges.forEach((exchange, index) => {
      const node = this.nodes[index];
      const hidden = this.pinnedOnly && !this.holdsPin(exchange);
      // Only where it changes: it runs after every slice of drawing, over all that is drawn.
      if (node && node.hidden !== hidden) node.hidden = hidden;
    });
  }

  /**
   * Draw the exchanges from `from` on, replacing those already drawn: only the last one ever changes, or what a rewind marked.
   * A whole history is drawn in slices with the window free between them: first the newest, which is where the history opens, then the rest from the oldest up, each slice going in just above that newest part.
   * So what is drawn is a run from the start, up to `drawnTo`, and the newest, from `tailFrom` on; the two meet once it is all drawn.
   * Drawn at once, the longest session here held the window for 1–2 s on every switch to its tab, most of it the browser laying out the whole list in one go.
   * Drawn newest first all the way down, every slice went in above everything drawn and made the browser lay all of that out again: twice the work, in slices that grew to 300 ms.
   */
  private draw(from: number): void {
    const total = this.model.exchanges.length;
    if (from === 0) {
      this.slicing++;
      this.list.replaceChildren();
      this.nodes = [];
      this.drawnTo = 0;
      this.tailFrom = total;
    }
    for (let k = total; k < this.nodes.length; k++) this.nodes[k]?.remove();
    this.nodes.length = Math.min(this.nodes.length, total);
    this.tailFrom = Math.min(this.tailFrom, total);
    this.drawnTo = Math.min(this.drawnTo, this.tailFrom);
    // Drawn already and changed; one not drawn yet gets the model as it is when its slice comes.
    for (let k = from; k < this.nodes.length; k++) {
      const old = this.nodes[k];
      if (!old) continue;
      const node = this.exchangeNode(this.model.exchanges[k]!, k);
      old.replaceWith(node);
      this.nodes[k] = node;
    }
    if (this.nodes.length > 0) {
      // New at the end, a few at a time as claude goes on.
      for (let k = this.nodes.length; k < total; k++) this.list.append((this.nodes[k] = this.exchangeNode(this.model.exchanges[k]!, k)));
    } else if (total > 0) {
      this.tailFrom = this.drawTail(total, performance.now() + SLICE_MS);
      if (this.drawnTo < this.tailFrom) this.sliceOn(this.slicing);
    }
    if (total === 0) this.drawEmpty();
    this.applyFilter();
    this.drawCount();
    this.onLayout?.();
  }

  /** Draw the newest exchanges, back from `end`, until `deadline` (always one). Says where they start. */
  private drawTail(end: number, deadline: number): number {
    const fresh: HTMLElement[] = [];
    let k = end;
    do {
      k--;
      const node = this.exchangeNode(this.model.exchanges[k]!, k);
      this.nodes[k] = node;
      fresh.push(node);
    } while (k > 0 && performance.now() < deadline);
    this.list.append(...fresh.reverse());
    return k;
  }

  /** Draw the next slice up from `drawnTo`, once the window has had its turn, until the whole history is drawn or it is drawn again from the start (`token` changes). */
  private sliceOn(token: number): void {
    window.setTimeout(() => {
      if (token !== this.slicing || this.drawnTo >= this.tailFrom) return;
      // Put in above what is in view, which stays where it is; at the end, the view stays at the end.
      const atEnd = this.atEnd();
      const deadline = performance.now() + SLICE_MS;
      const slice = document.createDocumentFragment();
      do {
        const k = this.drawnTo++;
        slice.append((this.nodes[k] = this.exchangeNode(this.model.exchanges[k]!, k)));
      } while (this.drawnTo < this.tailFrom && performance.now() < deadline);
      this.list.insertBefore(slice, this.nodes[this.tailFrom] ?? null);
      if (atEnd) this.scrollToEnd();
      this.applyFilter();
      // The bar measures the whole list, so not after every slice.
      const done = this.drawnTo >= this.tailFrom;
      const now = performance.now();
      if (done || now - this.measuredAt > BAR_EVERY_MS) {
        this.measuredAt = now;
        this.onLayout?.();
      }
      this.reopenWhereLeft();
      if (!done) this.sliceOn(token);
    }, 0);
  }

  private drawEmpty(): void {
    const empty = document.createElement('p');
    empty.className = 'history-empty';
    empty.textContent = this.session ? 'Nothing has been asked in this session yet.' : 'No session is selected.';
    this.list.replaceChildren(empty);
  }

  private drawCount(): void {
    const total = this.model.exchanges.length;
    const pinned = this.model.exchanges.reduce((sum, exchange) => sum + (exchange.id in this.pins ? 1 : 0) + this.pinnedMessages(exchange), 0);
    this.allButton.textContent = `All ${total}`;
    this.pinnedButton.innerHTML = `${PINNED_ICON} Pinned ${pinned}`;
    this.drawSwitch();
  }

  private exchangeNode(exchange: Exchange, index: number): HTMLElement {
    const node = document.createElement('article');
    // Sent again or rewound past, it is no longer in claude's conversation, and is drawn the one way for both.
    node.className = `exchange${exchange.replaced || exchange.rewound ? ' left-behind' : ''}`;

    // Your request as claude echoes it, on a band, with its number, time and marks at the band's end.
    const request = document.createElement('div');
    request.className = 'exchange-request';
    const text = document.createElement('span');
    text.className = 'exchange-request-text';
    text.textContent = exchange.request;
    const meta = document.createElement('span');
    meta.className = 'exchange-meta';
    const when = document.createElement('span');
    when.textContent = `#${index + 1} · ${exchange.time ? relativeTime(exchange.time) : ''}`;
    if (exchange.time) setTooltip(when, new Date(exchange.time).toLocaleString());
    const marks = [MARKS[exchange.kind], exchange.replaced ? REPLACED : undefined, exchange.rewound ? REWOUND : undefined].filter((m): m is [string, string] => m !== undefined);
    for (const [label, tooltip] of marks) {
      const mark = document.createElement('span');
      mark.className = 'exchange-mark';
      mark.textContent = label;
      setTooltip(mark, tooltip);
      meta.append(mark);
    }
    // The star stands where the `>` is, at the start of the line, and stands in for it on hover and once pinned, as a message's star does for its dot.
    const pin = document.createElement('button');
    pin.type = 'button';
    pin.className = 'icon-btn compact exchange-pin';
    pin.addEventListener('click', () => void this.togglePin(exchange));
    text.prepend(pin);
    meta.append(when);
    request.append(text, meta);

    // The reply as claude wrote it: each message its own block, the tool calls where they came between them, a run of them folded to one line.
    const reply = document.createElement('div');
    reply.className = 'exchange-reply';
    for (const block of replyBlocks(exchange.parts)) {
      if (block.kind === 'text') {
        const part = block.part;
        const piece = document.createElement('div');
        piece.className = 'exchange-text';
        piece.dataset.id = part.id;
        // Safe to hand to innerHTML: raw HTML in a reply comes out as text, and dangerous links not at all (markdown.ts).
        piece.innerHTML = renderMarkdown(part.text);
        // Its star sits where claude's dot is, at the message's start, and stands in for the dot on hover and once pinned.
        const star = document.createElement('button');
        star.type = 'button';
        star.className = 'icon-btn compact exchange-pin';
        star.addEventListener('click', () => void this.toggleMessagePin(part));
        piece.prepend(star);
        reply.append(piece);
      } else if (block.kind === 'tool') reply.append(toolLine(block.part));
      else reply.append(this.toolRun(`${exchange.id}:${block.at}`, block.parts));
    }

    node.append(request, reply);
    this.drawPin(node, exchange);
    return node;
  }

  /**
   * A run of tool calls as one line, "Ran 4 shell commands, read 1 file", that opens into the calls, as claude folds them; closed until opened.
   * Kept open or closed by `key` while the last exchange is drawn again as claude's reply grows.
   */
  private toolRun(key: string, parts: Extract<ReplyPart, { kind: 'tool' }>[]): HTMLElement {
    const run = document.createElement('div');
    run.className = 'exchange-tools';
    const head = document.createElement('button');
    head.type = 'button';
    head.className = 'exchange-tools-head';
    const label = document.createElement('span');
    label.textContent = toolSummary(parts);
    const chevron = document.createElement('span');
    chevron.className = 'exchange-tools-chevron';
    head.append(label, chevron);
    const list = document.createElement('div');
    list.className = 'exchange-tools-list';
    list.append(...parts.map(toolLine));
    const draw = (): void => {
      const open = this.openRuns.has(key);
      run.classList.toggle('open', open);
      list.hidden = !open;
      head.setAttribute('aria-expanded', String(open));
      chevron.innerHTML = chevronIcon(open ? 'down' : 'right', 12);
      setTooltip(head, open ? 'Fold the tool calls' : 'Show each tool call');
    };
    head.addEventListener('click', () => {
      if (!this.openRuns.delete(key)) this.openRuns.add(key);
      draw();
    });
    draw();
    run.append(head, list);
    return run;
  }

  /** Draw the stars of an exchange: its request's and each of claude's messages'. */
  private drawPin(node: HTMLElement, exchange: Exchange): void {
    const star = node.querySelector<HTMLElement>('.exchange-request .exchange-pin');
    if (star) drawStar(node, star, exchange.id in this.pins, 'request');
    for (const piece of node.querySelectorAll<HTMLElement>('.exchange-text')) {
      const pin = piece.querySelector<HTMLElement>(':scope > .exchange-pin');
      if (pin) drawStar(piece, pin, (piece.dataset.id ?? '') in this.pins, 'message');
    }
  }

  private async togglePin(exchange: Exchange): Promise<void> {
    if (!this.session || !exchange.id) return;
    this.setPins(await this.host.toggleHistoryPin(exchange.id, { kind: 'request', session: this.session, text: exchange.request, time: exchange.time }));
  }

  private async toggleMessagePin(part: Extract<ReplyPart, { kind: 'text' }>): Promise<void> {
    if (!this.session || !part.id) return;
    this.setPins(await this.host.toggleHistoryPin(part.id, { kind: 'reply', session: this.session, text: requestLabel(part.text, 300), time: part.time }));
  }
}

/** A tool call as claude draws it: the name in bold, what it acted on in brackets after it. */
function toolLine(part: Extract<ReplyPart, { kind: 'tool' }>): HTMLElement {
  const piece = document.createElement('div');
  piece.className = 'exchange-tool';
  const name = document.createElement('span');
  name.className = 'exchange-tool-name';
  name.textContent = part.name;
  piece.append(name);
  if (part.detail) piece.append(`(${part.detail})`);
  return piece;
}

/** A star, like the session row's told apart by ink alone, filled or outlined; what it pins carries the accent line in the margin. */
function drawStar(owner: HTMLElement, star: HTMLElement, pinned: boolean, what: 'request' | 'message'): void {
  owner.classList.toggle('pinned', pinned);
  star.innerHTML = pinned ? PINNED_ICON : PIN_ICON;
  star.setAttribute('aria-pressed', String(pinned));
  const label = `${pinned ? 'Unpin' : 'Pin'} this ${what}`;
  star.setAttribute('aria-label', label);
  setTooltip(star, label);
}
