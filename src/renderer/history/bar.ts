import { relativeTime } from '../logic';
import { PINNED_ICON, strokeIcon } from '../svg';
import { setTooltip } from '../tooltip';
import { dragTop, entryAt, grabAt, wheelSteps, type Band, type Entry, type MarkAt } from './marks';

/** What the bar reads from the history it marks (view.ts). */
export interface BarSource {
  /** `pinned` is the request's pin, `replyPinned` whether any of claude's messages in the exchange is pinned. */
  marks(): { k: number; request: number; reply: number | null; pinned: boolean; replyPinned: boolean; replaced: boolean }[];
  band(): Band;
  /** Put the top of the view at `top`, a fraction of the whole history. */
  scrollTo(top: number): void;
  describe(k: number): { number: number; time: string; request: string; reply: string | null; pinned: boolean; replyPinned: boolean } | null;
  readonly size: number;
  /** Whether the history, rather than the live terminal, has the pane. */
  readonly shown: boolean;
}

const LAST_ICON = strokeIcon(12, '<path d="M3.5 3.5h9M8 13V6.5M5 9.5l3-3 3 3" />');
/** The loupe's rows: fixed in height, so stepping and keeping the chosen one in view is arithmetic. */
const ROW = 22;
const ROWS = 9;
/** Over this many marks the ticks are drawn a pixel thin and faint, so a long session reads as a density rather than a solid bar. */
const DENSE = 120;

/**
 * The bar at the edge of the terminal area: the history's scrollbar, always there, live or not.
 * A request is a tick across it and its reply a thin bar down its middle until the next request — a shape apart, not only a shade — with pins in the accent, a request that was sent again dimmer, the last request in full white, and, in the history, a band for where you are.
 * Its marks are placed from the history's measured heights, so they sit where the history's own scrolling puts things.
 *
 * Hovering opens the LOUPE beside it: the entries around the pointer, in words. At 821 requests the bar has under a pixel each, so the pointer alone picks roughly; the wheel — over the bar, or inside the loupe once the pointer has moved into it — steps one entry at a time, and a click on its row or Enter opens it.
 * The user's words that settled this, after a fisheye was tried and rejected: "when there are a lot of messages you can't reach the correct message".
 *
 * Pressing on it is a scrollbar's: the view goes to that point at once, opening the history if it is closed, and follows the pointer until the button is let go. The rough way to a place, with the loupe for the exact entry.
 * In the user's words: "I want to press the mouse on a point in the sidebar, then the view should already go there. When I keep the mouse down I can drag and the view scrolls with it until I release the mouse button."
 */
export class HistoryBar {
  readonly el = document.createElement('div');
  private readonly area = document.createElement('div');
  private readonly bandEl = document.createElement('div');
  private marks: MarkAt[] = [];
  private readonly requestEls = new Map<number, HTMLElement>();
  private readonly replyEls = new Map<number, HTMLElement>();
  private hot: Entry | null = null;
  /** The marks lit for being in view. */
  private seen: HTMLElement[] = [];
  private loupe: Loupe | null = null;
  /** A press on the bar, while the button is down: where on the band it holds it. */
  private press: { grab: number } | null = null;
  /** While a press is held the view follows every move of a held pointer, anywhere on the window. */
  private readonly follow = (event: PointerEvent): void => {
    if (!this.press) return;
    // The button came up where its release did not reach the bar.
    if (event.buttons === 0) {
      this.letGo();
      return;
    }
    this.source.scrollTo(dragTop(this.fraction(event.clientY), this.press.grab, this.source.band()));
  };
  private readonly letGo = (): void => {
    this.press = null;
    this.el.classList.remove('dragging');
    window.removeEventListener('pointermove', this.follow, true);
    window.removeEventListener('pointerup', this.letGo, true);
  };

  constructor(
    private readonly source: BarSource,
    private readonly pick: (entry: Entry) => void,
    /** Open the history, where it is, for a press to scroll. */
    private readonly open: () => void,
  ) {
    this.el.className = 'history-bar';
    this.area.className = 'history-bar-area';
    this.bandEl.className = 'history-band';
    const foot = document.createElement('button');
    foot.type = 'button';
    foot.className = 'history-bar-foot';
    foot.innerHTML = LAST_ICON;
    foot.setAttribute('aria-label', 'Your last request (Ctrl+Shift+↑; again for the one before)');
    setTooltip(foot, 'Your last request (Ctrl+Shift+↑; again for the one before)');
    foot.addEventListener('click', () => this.pickLast());
    this.el.append(this.area, foot);
    // A press on the bar leaves the focus where it was, in the terminal or the history: the bar is something to point at, and taking the focus left Esc and the step keys with nothing.
    this.el.addEventListener('mousedown', (event) => event.preventDefault());

    this.area.addEventListener('mousemove', (event) => {
      if (!this.press) this.pointerAt(event);
    });
    this.area.addEventListener('wheel', (event) => {
      if (!this.loupe) return;
      event.preventDefault();
      this.loupe.wheel(event);
    });
    this.area.addEventListener('mouseleave', (event) => {
      if (this.loupe && !this.loupe.el.contains(event.relatedTarget as Node | null)) this.loupe.closeSoon();
    });
    this.area.addEventListener('pointerdown', (event) => this.pressAt(event));
    new ResizeObserver(() => this.refresh()).observe(this.area);
  }

  /** Where `clientY` is on the bar, as a fraction of its height. */
  private fraction(clientY: number): number {
    const area = this.area.getBoundingClientRect();
    return (clientY - area.top) / (area.height || 1);
  }

  /**
   * Go to the point pressed, at once, opening the history if it is closed; pressed on the band, hold it where it was taken instead, as a scrollbar's thumb.
   * Then follow the pointer until the button is let go, wherever it goes: a hand's drag drifts sideways off a 14px bar.
   * Followed on the window, from ANY pointer, not by capturing the one pressed: under WSLg the moves of a held mouse button arrive as a second pointer, a pen (id 2 against the press's 1, in the app's log), which a capture of the first never sees — so nothing dragged in the app while every headless check passed.
   */
  private pressAt(event: PointerEvent): void {
    if (event.button !== 0 || this.source.size === 0) return;
    const bandShown = this.source.shown;
    this.loupe?.close();
    this.open();
    const pressed = this.fraction(event.clientY);
    this.press = { grab: grabAt(pressed, this.source.band(), bandShown) };
    this.el.classList.add('dragging');
    this.source.scrollTo(dragTop(pressed, this.press.grab, this.source.band()));
    window.addEventListener('pointermove', this.follow, true);
    window.addEventListener('pointerup', this.letGo, true);
  }

  /** Open the history at the session's last request. */
  pickLast(): void {
    if (this.source.size > 0) this.pick({ k: this.source.size - 1, part: 'request' });
  }

  /** Place every mark again from the history's measurements: after a draw, a pin, a filter, a tool list opened. */
  refresh(): void {
    const height = this.area.clientHeight;
    const marks = this.source.marks();
    this.el.classList.toggle('dense', marks.length > DENSE);
    this.requestEls.clear();
    this.replyEls.clear();
    const nodes: HTMLElement[] = [];
    this.marks = marks.map((mark, index) => {
      const top = mark.request * height;
      const next = marks[index + 1];
      const tick = document.createElement('div');
      tick.className = `mark-request${mark.pinned ? ' pinned' : ''}${mark.replaced ? ' replaced' : ''}${mark.k === this.source.size - 1 ? ' last' : ''}`;
      tick.style.top = `${top}px`;
      this.requestEls.set(mark.k, tick);
      let reply: number | null = null;
      if (mark.reply !== null) {
        reply = mark.reply * height;
        const start = Math.max(reply, top + 2);
        const end = (next ? next.request * height : height) - 2;
        const bar = document.createElement('div');
        bar.className = `mark-reply${mark.replyPinned ? ' pinned' : ''}`;
        bar.style.top = `${start}px`;
        bar.style.height = `${Math.max(0, end - start)}px`;
        this.replyEls.set(mark.k, bar);
        nodes.push(bar);
      }
      nodes.push(tick);
      return { k: mark.k, request: top, reply };
    });
    this.area.replaceChildren(...nodes, this.bandEl);
    if (this.hot) this.setHot(this.hot);
    this.moveBand();
    this.loupe?.rebuild(this.marks);
  }

  /**
   * Put the band where the history is scrolled to, and light the marks in it — and none while the live terminal has the pane.
   * The wheel scrolls claude's own view there, and where claude is scrolled is not something the app can know, so a band "at the end" would be a guess.
   */
  moveBand(): void {
    this.bandEl.hidden = !this.source.shown;
    for (const el of this.seen) el.classList.remove('seen');
    this.seen = [];
    if (!this.source.shown) return;
    const height = this.area.clientHeight;
    const band = this.source.band();
    const top = band.top * height;
    const bottom = top + band.height * height;
    this.bandEl.style.top = `${top}px`;
    this.bandEl.style.height = `${Math.max(4, band.height * height)}px`;
    // What is in view is lit, as the loupe's entry is: a request whose tick is in the band, a reply whose bar reaches into it.
    this.marks.forEach((mark, index) => {
      const end = this.marks[index + 1]?.request ?? height;
      if (mark.request >= top && mark.request <= bottom) this.seen.push(this.requestEls.get(mark.k)!);
      if (mark.reply !== null && mark.reply < bottom && end > top) this.seen.push(this.replyEls.get(mark.k)!);
    });
    for (const el of this.seen) el.classList.add('seen');
  }

  /** Light the mark of `entry` on the bar, the one the loupe is on. */
  setHot(entry: Entry | null): void {
    for (const el of this.area.querySelectorAll('.hot')) el.classList.remove('hot');
    this.hot = entry;
    if (!entry) return;
    (entry.part === 'reply' ? this.replyEls : this.requestEls).get(entry.k)?.classList.add('hot');
  }

  private pointerAt(event: MouseEvent): void {
    const entry = entryAt(this.marks, event.clientY - this.area.getBoundingClientRect().top);
    if (!entry) return;
    this.loupe ??= new Loupe(this, this.source, this.marks, (e) => this.pick(e), () => (this.loupe = null));
    this.loupe.follow(entry, event);
  }
}

/**
 * The loupe: every entry on the bar as a row of words, nine in view, the one a click opens highlighted.
 * It follows the pointer along the bar; moving into it freezes it, keeping the entry you had until you move up or down inside it; the wheel and the arrow keys step one entry at a time from wherever it is.
 */
class Loupe {
  readonly el = document.createElement('div');
  private readonly head = document.createElement('div');
  private readonly list = document.createElement('div');
  private rows: HTMLElement[] = [];
  private entries: Entry[] = [];
  private index = -1;
  private carry = 0;
  /** Set once the wheel or a key has stepped: the pointer then has to move for real on the bar before it takes over again, or a twitch would undo the steps. */
  private steppedAtY: number | null = null;
  /** Where the pointer came into the loupe: crossing in keeps the entry; only moving up or down inside picks another. */
  private enteredAtY: number | null = null;
  private inside = false;
  private pointerY = 0;
  private lastMove = { x: 0, y: 0 };
  private closeTimer: number | undefined;
  private readonly keys = (event: KeyboardEvent): void => this.key(event);

  constructor(
    private readonly bar: HistoryBar,
    private readonly source: BarSource,
    marks: MarkAt[],
    private readonly onPick: (entry: Entry) => void,
    private readonly onClosed: () => void,
  ) {
    this.el.className = 'history-loupe';
    this.head.className = 'history-loupe-head';
    this.list.className = 'history-loupe-list';
    const foot = document.createElement('div');
    foot.className = 'history-loupe-foot';
    foot.textContent = 'Wheel: one at a time · click a row to open it';
    this.el.append(this.head, this.list, foot);
    // Pointed at, never focused, as the bar is: a click on a row leaves the keys with the history.
    this.el.addEventListener('mousedown', (event) => event.preventDefault());
    document.body.append(this.el);
    this.rebuild(marks);

    this.el.addEventListener('mouseenter', (event) => {
      window.clearTimeout(this.closeTimer);
      this.enteredAtY = event.clientY;
      this.inside = true;
    });
    this.el.addEventListener('mouseleave', (event) => {
      this.inside = false;
      if (!this.bar.el.contains(event.relatedTarget as Node | null)) this.closeSoon();
    });
    this.list.addEventListener('mousemove', (event) => {
      if (this.enteredAtY !== null && Math.abs(event.clientY - this.enteredAtY) < 6) return;
      this.enteredAtY = null;
      // A row the wheel scrolled under a pointer that has not moved is not a choice.
      if (Math.abs(event.clientX - this.lastMove.x) + Math.abs(event.clientY - this.lastMove.y) < 3) return;
      this.lastMove = { x: event.clientX, y: event.clientY };
      const row = (event.target as Element).closest<HTMLElement>('.history-loupe-row');
      if (row) this.select(Number(row.dataset.n), false);
    });
    this.list.addEventListener('wheel', (event) => {
      event.preventDefault();
      this.wheel(event);
    });
    this.list.addEventListener('click', (event) => {
      const row = (event.target as Element).closest<HTMLElement>('.history-loupe-row');
      if (row) this.pickAt(Number(row.dataset.n));
    });
    // Capture, on the window: the terminal has the focus while live, and the arrows would otherwise go to claude.
    window.addEventListener('keydown', this.keys, true);
  }

  /** Every entry on the bar, in order: a request, then its reply when it has one. */
  rebuild(marks: MarkAt[]): void {
    const current = this.entries[this.index];
    this.entries = marks.flatMap((mark): Entry[] => (mark.reply === null ? [{ k: mark.k, part: 'request' }] : [{ k: mark.k, part: 'request' }, { k: mark.k, part: 'reply' }]));
    this.rows = this.entries.map((entry, n) => {
      const info = this.source.describe(entry.k);
      const row = document.createElement('div');
      row.className = `history-loupe-row ${entry.part}`;
      row.dataset.n = String(n);
      const number = document.createElement('span');
      number.className = 'history-loupe-n';
      number.textContent = entry.part === 'request' && info ? String(info.number) : '';
      const text = document.createElement('span');
      text.className = 'history-loupe-text';
      text.textContent = (entry.part === 'request' ? info?.request : info?.reply) ?? '';
      row.append(number, text);
      if (entry.part === 'request' ? info?.pinned : info?.replyPinned) {
        const star = document.createElement('span');
        star.className = 'history-loupe-pin';
        star.innerHTML = PINNED_ICON;
        row.append(star);
      }
      return row;
    });
    this.list.replaceChildren(...this.rows);
    const again = current ? this.entries.findIndex((e) => e.k === current.k && e.part === current.part) : -1;
    this.index = -1;
    if (again >= 0) this.select(again, true);
  }

  /** The pointer is over the bar, on `entry`. */
  follow(entry: Entry, event: MouseEvent): void {
    window.clearTimeout(this.closeTimer);
    this.pointerY = event.clientY;
    if (this.steppedAtY !== null && Math.abs(event.clientY - this.steppedAtY) < 6) return;
    this.steppedAtY = null;
    const n = this.entries.findIndex((e) => e.k === entry.k && e.part === entry.part);
    if (n >= 0) this.select(n, true);
    this.place(event.clientY);
  }

  wheel(event: WheelEvent): void {
    const { steps, carry } = wheelSteps(event.deltaMode, event.deltaY, this.carry);
    this.carry = carry;
    if (steps) this.select(this.index + steps, false);
    this.steppedAtY = event.clientY;
    this.lastMove = { x: event.clientX, y: event.clientY };
  }

  pickCurrent(): void {
    if (this.index >= 0) this.pickAt(this.index);
  }

  closeSoon(): void {
    window.clearTimeout(this.closeTimer);
    this.closeTimer = window.setTimeout(() => this.close(), 350);
  }

  close(): void {
    window.clearTimeout(this.closeTimer);
    window.removeEventListener('keydown', this.keys, true);
    this.el.remove();
    this.bar.setHot(null);
    this.onClosed();
  }

  private pickAt(n: number): void {
    const entry = this.entries[n];
    this.close();
    if (entry) this.onPick(entry);
  }

  /**
   * The arrows, Enter and Esc, but only while the pointer is IN the loupe or the history has the pane.
   * With the pointer merely resting on the bar while the live terminal has the focus, those keys are claude's: a prompt typed with the pointer parked there must still be sent.
   */
  private key(event: KeyboardEvent): void {
    if (event.ctrlKey || event.shiftKey || event.altKey || event.metaKey) return;
    if (!this.inside && !this.source.shown) return;
    const step = event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0;
    if (!step && event.key !== 'Enter' && event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    if (step) {
      this.select(this.index + step, false);
      this.steppedAtY = this.pointerY;
    } else if (event.key === 'Enter') this.pickCurrent();
    else this.close();
  }

  /** Make entry `n` the one a click opens: centred when following the pointer, otherwise kept in view. */
  private select(n: number, centre: boolean): void {
    if (this.entries.length === 0) return;
    n = Math.max(0, Math.min(this.entries.length - 1, n));
    this.rows[this.index]?.classList.remove('current');
    this.index = n;
    this.rows[n]!.classList.add('current');
    const top = n * ROW;
    if (centre) this.list.scrollTop = top - Math.floor(ROWS / 2) * ROW;
    else if (top < this.list.scrollTop + ROW) this.list.scrollTop = top - ROW;
    else if (top > this.list.scrollTop + (ROWS - 2) * ROW) this.list.scrollTop = top - (ROWS - 2) * ROW;
    const entry = this.entries[n]!;
    const info = this.source.describe(entry.k);
    this.head.textContent = info ? `${entry.part === 'reply' ? 'Reply to' : 'Request'} #${info.number} of ${this.source.size}${info.time ? ` · ${relativeTime(info.time)}` : ''}` : '';
    this.bar.setHot(entry);
  }

  /** Beside the bar, flush against it so the pointer crosses nothing on its way in, centred on the pointer and kept within the bar's height. */
  private place(clientY: number): void {
    const bar = this.bar.el.getBoundingClientRect();
    const height = this.el.offsetHeight;
    this.el.style.right = `${window.innerWidth - bar.left - 1}px`;
    this.el.style.top = `${Math.min(bar.bottom - height, Math.max(bar.top, clientY - height / 2))}px`;
  }
}
