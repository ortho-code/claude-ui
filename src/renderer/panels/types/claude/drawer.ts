import { element } from '../../../ui/dom';
import type { DrawerEntry } from '../../contract';
import { iconSvg } from '../../icons';
import { railCount, railItem, railStrip, showRailCount } from '../../rail';
import './drawer.css';

/** How the drawer stands: closed; over a live claude, slid in beside it with claude dimmed; or over the whole pane, standing in for a tab with no claude behind it. */
export type DrawerState = 'closed' | 'over' | 'whole';

/**
 * The one drawer over the terminal area, which the terminal area owns and what it holds is drawn in: the history, and the Editor while it is not docked.
 * Over a live claude it slides in from the right over about two-thirds of the pane, never narrower than 560px, and claude stays in view on the left, dimmed under the scrim, at its real size, so it never redraws; a press on the scrim is the way back.
 * It holds one thing on show at a time; whatever takes it closes what was on show, through that one's own way of closing.
 * While it is open with more than one thing listed, a rail on its left edge (panels/rail.ts) switches between them: a press on the one on show closes the drawer, a press on another shows that one.
 * It is KEPT LAID OUT while closed, and so is all it holds, hidden by visibility and never by display, so what it holds can still be measured, which is how the history's bar places its marks.
 */
export class Drawer {
  /** The drawer itself, which what it holds goes into. */
  readonly frame = element('div', 'drawer');
  /** What dims claude beside it while it is over a live claude; it goes into the terminal area just before `frame`. */
  readonly scrim = element('div', 'drawer-scrim');
  private readonly rail = railStrip('vertical', 'start');
  /** What the rail last drew, to draw it again only when that changes; empty while it is not shown. */
  private drawnRail = '';
  private state: DrawerState = 'closed';
  /** What it holds, each as its rail lists it and with how it opens and closes. */
  private readonly held = new Map<HTMLElement, DrawerEntry>();
  /** What is on show in it, or was last; null before anything was. */
  private onShow: HTMLElement | null = null;

  constructor() {
    // A press on the rail leaves the keys where they were, so what it closes gives them back to claude as its own way of closing does.
    this.rail.addEventListener('mousedown', (event) => event.preventDefault());
    this.scrim.addEventListener('mousedown', (event) => {
      event.preventDefault();
      if (this.onShow) this.held.get(this.onShow)?.close(false);
    });
  }

  /** Hold `el`, laid out and out of sight until it is shown, and listed on the rail as `entry` says; holding it again takes the new `entry`. */
  hold(el: HTMLElement, entry: DrawerEntry): void {
    el.classList.add('drawer-content');
    this.held.set(el, entry);
    if (el.parentElement !== this.frame) this.frame.append(el);
    this.relist();
  }

  /** Draw the rail again, for what it lists or a count that changed: shown while the drawer is open with more than one thing listed. */
  relist(): void {
    const listed = [...this.held].filter(([, entry]) => entry.listed?.() ?? true).map(([el, entry]) => ({ el, entry, count: entry.count() }));
    const railed = this.state !== 'closed' && listed.length > 1;
    this.frame.classList.toggle('railed', railed);
    // In the drawer only while it is shown, so a closed drawer adds no rail to the window.
    if (!railed) {
      this.rail.remove();
      this.drawnRail = '';
      return;
    }
    // Drawn again only when what it says changed: the history asks on every redraw while claude prints, and an icon replaced under a press loses its click.
    const drawn = JSON.stringify(listed.map(({ el, entry, count }) => [entry.label, count, el === this.onShow]));
    if (drawn !== this.drawnRail) {
      this.drawnRail = drawn;
      this.rail.replaceChildren(...listed.map(({ el, entry, count }) => this.railItem(el === this.onShow, entry, count)));
    }
    if (!this.rail.isConnected) this.frame.prepend(this.rail);
  }

  private railItem(onShow: boolean, entry: DrawerEntry, count: number | null): HTMLButtonElement {
    // One label for the tooltip and a screen reader, the count said whole, as a panel group's rail says it.
    const named = count === null ? entry.label : `${entry.label} · ${count}`;
    const item = railItem({
      icon: iconSvg(entry.icon),
      label: onShow ? `${named} — click to close` : named,
      onShow,
      putsAway: true,
      press: () => (onShow ? entry.close(false) : entry.open()),
    });
    const shownCount = railCount();
    showRailCount(shownCount, count);
    item.append(shownCount);
    return item;
  }

  /** Let go of `el`, closing the drawer first while it is what is on show, and taking it out, so it can be placed elsewhere. */
  release(el: HTMLElement): void {
    if (!this.held.has(el)) return;
    this.set(el, 'closed');
    this.held.delete(el);
    el.classList.remove('drawer-content', 'on');
    if (el.parentElement === this.frame) el.remove();
    if (this.onShow === el) this.onShow = null;
    this.relist();
  }

  /** Stand as `state` for `el`: show it so, or, closed, close the drawer when `el` is the one on show; closing anything else changes nothing. */
  set(el: HTMLElement, state: DrawerState): void {
    if (state === 'closed') {
      if (el === this.onShow) this.place('closed');
      this.relist();
      return;
    }
    const before = this.onShow;
    if (before !== el) {
      this.onShow = el;
      for (const held of this.held.keys()) held.classList.toggle('on', held === el);
      // What was on show closes its own way, after the drawer is already the newcomer's, so its closing does not close the drawer.
      if (before && this.state !== 'closed') this.held.get(before)?.close(true);
    }
    this.place(state);
    this.relist();
  }

  private place(state: DrawerState): void {
    if (state === this.state) return;
    const was = this.state;
    this.state = state;
    // Hidden before it stops standing over the whole pane, so closing it from there does not slide a drawer out; reading its style makes the browser take the hiding first, where it would otherwise take both changes at once and slide.
    if (was === 'whole' && state !== 'whole') {
      this.frame.classList.remove('shown');
      getComputedStyle(this.frame).getPropertyValue('visibility');
    }
    this.frame.classList.toggle('whole', state === 'whole');
    this.frame.classList.toggle('shown', state !== 'closed');
    this.scrim.classList.toggle('shown', state === 'over');
  }
}
