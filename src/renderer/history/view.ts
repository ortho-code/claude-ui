import type { ClaudeUiApi, Exchange, RequestPin } from '../../shared/types';
import { flash } from '../flash';
import { relativeTime } from '../logic';
import { chevronIcon, PIN_ICON, PINNED_ICON } from '../svg';
import { setTooltip } from '../tooltip';
import { renderMarkdown, routeLinks } from './markdown';
import { applySlice, emptyModel, requestLabel, type HistoryModel } from './model';

/** What the history needs from the rest of the window. */
export interface HistoryHost {
  getHistory: ClaudeUiApi['getHistory'];
  toggleRequestPin: ClaudeUiApi['toggleRequestPin'];
  openExternal(url: string): void;
  /** Hand the pane back to the live terminal. */
  leave(): void;
}

const MARKS: Partial<Record<Exchange['kind'], [label: string, tooltip: string]>> = {
  busy: ['sent while claude was working', 'Sent while claude was still working on something else, and taken up by it.'],
};
const REPLACED: [string, string] = ['sent again', 'You stopped this and sent it again: the request below replaced it.'];

/**
 * The app's own view of a session's requests and claude's replies, read from its transcript.
 * It lies over the terminal area and is KEPT LAID OUT while the live terminal is on show — hidden by visibility, not display — so what is drawn can still be measured, which is how the bar beside it places its marks.
 * One view for the active tab: switching tabs points it at the new tab's session.
 */
export class HistoryView {
  readonly el = document.createElement('section');
  private readonly count = document.createElement('span');
  private readonly pinnedOnlyButton = document.createElement('button');
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
  private pins: Record<string, RequestPin> = {};
  private pinnedOnly = false;
  /** Tool lists opened by hand, by request id, so redrawing a growing exchange does not fold its list shut again. */
  private readonly toolsOpen = new Set<string>();
  private reading = false;
  private readAgain = false;
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
    this.count.className = 'history-count';
    this.pinnedOnlyButton.className = 'history-filter';
    this.pinnedOnlyButton.type = 'button';
    this.pinnedOnlyButton.innerHTML = PINNED_ICON;
    this.pinnedOnlyButton.setAttribute('aria-label', 'Show only pinned requests');
    this.pinnedOnlyButton.setAttribute('aria-pressed', 'false');
    setTooltip(this.pinnedOnlyButton, 'Show only pinned requests');
    this.pinnedOnlyButton.addEventListener('click', () => this.setPinnedOnly(!this.pinnedOnly));
    const previous = this.stepButton('up', 'Previous request', -1);
    const next = this.stepButton('down', 'Next request', 1);
    // The way out, labelled and always in view at the head, with its key on it: a floating pill at the foot was not found.
    const leave = document.createElement('button');
    leave.type = 'button';
    leave.className = 'history-leave';
    leave.innerHTML = 'Back to live <kbd>Esc</kbd>';
    setTooltip(leave, 'Back to the live session');
    leave.addEventListener('click', () => this.leave());
    head.append(title, this.count, this.pinnedOnlyButton, previous, next, leave);

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

    this.note.className = 'history-note';
    this.note.hidden = true;
    this.el.append(head, this.note, this.scroller);
    this.drawCount();
  }

  /** Show session `id`'s history, or nothing. Says whether that is a different session from the one shown; the same one is a no-op. */
  follow(id: string | null): boolean {
    if (id === this.session) return false;
    this.setStandalone(null);
    this.session = id;
    this.followed++;
    this.model = emptyModel();
    this.nodes = [];
    this.list.replaceChildren();
    this.toolsOpen.clear();
    this.drawCount();
    if (id) void this.refresh();
    else this.drawEmpty();
    this.onLayout?.();
    return true;
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
    this.el.classList.toggle('standalone', note !== null);
    if (note !== null) this.setShown(true);
    else if (was) this.setShown(false);
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
    this.el.classList.toggle('shown', shown);
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
  marks(): { k: number; request: number; reply: number | null; pinned: boolean; replaced: boolean }[] {
    const height = this.scroller.scrollHeight || 1;
    const marks: { k: number; request: number; reply: number | null; pinned: boolean; replaced: boolean }[] = [];
    this.model.exchanges.forEach((exchange, k) => {
      const node = this.nodes[k];
      if (!node || node.hidden) return;
      const reply = exchange.reply || exchange.tools.length > 0 ? node.querySelector<HTMLElement>('.exchange-reply') : null;
      marks.push({ k, request: node.offsetTop / height, reply: reply ? reply.offsetTop / height : null, pinned: exchange.id in this.pins, replaced: exchange.replaced });
    });
    return marks;
  }

  /** The part of the history in view, as fractions of its height. */
  band(): { top: number; height: number } {
    const total = this.scroller.scrollHeight || 1;
    return { top: this.scroller.scrollTop / total, height: this.scroller.clientHeight / total };
  }

  /** What the loupe says about exchange `k`: its number, when, the request's first line, and the reply's (null when there is none). */
  describe(k: number): { number: number; time: string; request: string; reply: string | null; pinned: boolean } | null {
    const exchange = this.model.exchanges[k];
    if (!exchange) return null;
    const reply = exchange.reply
      ? requestLabel(exchange.reply.replace(/^\s*(#{1,6}|>|[-*+])\s+/gm, ''))
      : exchange.tools.length > 0
        ? `${exchange.tools.length} tool call${exchange.tools.length === 1 ? '' : 's'}`
        : null;
    return { number: k + 1, time: exchange.time, request: requestLabel(exchange.request), reply, pinned: exchange.id in this.pins };
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
      } while (this.readAgain);
    } finally {
      this.reading = false;
    }
  }

  setPins(pins: Record<string, RequestPin>): void {
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

  /** The exchange at the top of the view: the last one whose top is at or above it. */
  private current(): number {
    const top = this.scroller.scrollTop + 8;
    let found = 0;
    this.nodes.forEach((node, index) => {
      if (!node.hidden && node.offsetTop <= top) found = index;
    });
    return found;
  }

  private step(by: number): void {
    const visible = this.nodes.map((node, index) => (node.hidden ? -1 : index)).filter((index) => index >= 0);
    const at = this.current();
    // Scrolled into an exchange, "previous" goes to its own start first, as a page's previous-heading key does.
    const node = this.nodes[at];
    const inside = node !== undefined && this.scroller.scrollTop > node.offsetTop + 8;
    const position = visible.indexOf(at);
    const target = by < 0 && inside ? at : visible[Math.min(visible.length - 1, Math.max(0, position + by))];
    if (target !== undefined) this.goTo(target);
  }

  private atEnd(): boolean {
    return this.scroller.scrollTop + this.scroller.clientHeight >= this.scroller.scrollHeight - 4;
  }

  private setPinnedOnly(on: boolean): void {
    this.pinnedOnly = on;
    this.pinnedOnlyButton.classList.toggle('active', on);
    this.pinnedOnlyButton.setAttribute('aria-pressed', String(on));
    this.applyFilter();
    this.onLayout?.();
  }

  private applyFilter(): void {
    this.model.exchanges.forEach((exchange, index) => {
      const node = this.nodes[index];
      if (node) node.hidden = this.pinnedOnly && !(exchange.id in this.pins);
    });
  }

  /** Draw the exchanges from `from` on, replacing those already drawn: only the last one ever changes. */
  private draw(from: number): void {
    if (from === 0) this.list.replaceChildren();
    this.nodes.length = Math.min(this.nodes.length, from);
    for (let index = from; index < this.model.exchanges.length; index++) {
      const node = this.exchangeNode(this.model.exchanges[index]!, index);
      const old = this.list.children[index];
      if (old) old.replaceWith(node);
      else this.list.append(node);
      this.nodes[index] = node;
    }
    while (this.list.children.length > this.model.exchanges.length) this.list.lastElementChild?.remove();
    if (this.model.exchanges.length === 0) this.drawEmpty();
    this.applyFilter();
    this.drawCount();
    this.onLayout?.();
  }

  private drawEmpty(): void {
    const empty = document.createElement('p');
    empty.className = 'history-empty';
    empty.textContent = this.session ? 'Nothing has been asked in this session yet.' : 'No session is selected.';
    this.list.replaceChildren(empty);
  }

  private drawCount(): void {
    const total = this.model.exchanges.length;
    const pinned = this.model.exchanges.filter((exchange) => exchange.id in this.pins).length;
    this.count.textContent = `${total} request${total === 1 ? '' : 's'}${pinned ? ` · ${pinned} pinned` : ''}`;
  }

  private exchangeNode(exchange: Exchange, index: number): HTMLElement {
    const node = document.createElement('article');
    node.className = `exchange${exchange.replaced ? ' replaced' : ''}`;

    const meta = document.createElement('div');
    meta.className = 'exchange-meta';
    const when = document.createElement('span');
    when.textContent = `#${index + 1} · ${exchange.time ? relativeTime(exchange.time) : ''}`;
    if (exchange.time) setTooltip(when, new Date(exchange.time).toLocaleString());
    meta.append(when);
    const marks = [MARKS[exchange.kind], exchange.replaced ? REPLACED : undefined].filter((m): m is [string, string] => m !== undefined);
    for (const [label, tooltip] of marks) {
      const mark = document.createElement('span');
      mark.className = 'exchange-mark';
      mark.textContent = label;
      setTooltip(mark, tooltip);
      meta.append(mark);
    }
    const grow = document.createElement('span');
    grow.className = 'grow';
    const pin = document.createElement('button');
    pin.type = 'button';
    pin.className = 'icon-btn compact exchange-pin';
    pin.addEventListener('click', () => void this.togglePin(exchange));
    meta.append(grow, pin);

    const request = document.createElement('div');
    request.className = 'exchange-request';
    request.textContent = exchange.request;

    const reply = document.createElement('div');
    reply.className = 'exchange-reply';
    if (exchange.tools.length > 0) reply.append(...this.toolsNodes(exchange));
    if (exchange.reply) {
      const text = document.createElement('div');
      text.className = 'exchange-text';
      // Safe to hand to innerHTML: raw HTML in a reply comes out as text, and dangerous links not at all (markdown.ts).
      text.innerHTML = renderMarkdown(exchange.reply);
      reply.append(text);
    }

    node.append(meta, request, reply);
    this.drawPin(node, exchange);
    return node;
  }

  private toolsNodes(exchange: Exchange): HTMLElement[] {
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'exchange-tools';
    const list = document.createElement('div');
    list.className = 'exchange-tool-list';
    list.textContent = exchange.tools.join('\n');
    const label = `${exchange.tools.length} tool call${exchange.tools.length === 1 ? '' : 's'}`;
    const draw = (): void => {
      const open = this.toolsOpen.has(exchange.id);
      list.hidden = !open;
      toggle.innerHTML = `${chevronIcon(open ? 'down' : 'right', 11)}${label}`;
      toggle.setAttribute('aria-expanded', String(open));
    };
    toggle.addEventListener('click', () => {
      if (this.toolsOpen.has(exchange.id)) this.toolsOpen.delete(exchange.id);
      else this.toolsOpen.add(exchange.id);
      draw();
      this.onLayout?.();
    });
    draw();
    return [toggle, list];
  }

  private drawPin(node: HTMLElement, exchange: Exchange): void {
    const pin = node.querySelector<HTMLElement>('.exchange-pin');
    if (!pin) return;
    // The session row's star, and like it told apart by ink alone, filled or outlined.
    const pinned = exchange.id in this.pins;
    pin.innerHTML = pinned ? PINNED_ICON : PIN_ICON;
    pin.setAttribute('aria-pressed', String(pinned));
    pin.setAttribute('aria-label', pinned ? 'Unpin this request' : 'Pin this request');
    setTooltip(pin, pinned ? 'Unpin this request' : 'Pin this request');
  }

  private async togglePin(exchange: Exchange): Promise<void> {
    if (!this.session || !exchange.id) return;
    this.setPins(await this.host.toggleRequestPin(exchange.id, { session: this.session, text: exchange.request, time: exchange.time }));
  }
}
