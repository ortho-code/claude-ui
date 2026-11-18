import { element } from '../../../ui/dom';
import './drawer.css';

/** How the drawer stands: closed; over a live claude, slid in beside it with claude dimmed; or over the whole pane, standing in for a tab with no claude behind it. */
export type DrawerState = 'closed' | 'over' | 'whole';

/**
 * The one drawer over the terminal area, which the terminal area owns and what it holds is drawn in: the history, and the Editor while it is not docked.
 * Over a live claude it slides in from the right over about two-thirds of the pane, never narrower than 560px, and claude stays in view on the left, dimmed under the scrim, at its real size, so it never redraws; a press on the scrim is the way back.
 * It holds one thing on show at a time; whatever takes it closes what was on show, through that one's own way of closing.
 * It is KEPT LAID OUT while closed, and so is all it holds, hidden by visibility and never by display, so what it holds can still be measured, which is how the history's bar places its marks.
 */
export class Drawer {
  /** The drawer itself, which what it holds goes into. */
  readonly frame = element('div', 'drawer');
  /** What dims claude beside it while it is over a live claude; it goes into the terminal area just before `frame`. */
  readonly scrim = element('div', 'drawer-scrim');
  private state: DrawerState = 'closed';
  /** What it holds, each with how it closes: `taken` when something else takes the drawer, which then keeps the keys, rather than a press on the scrim giving the pane back. */
  private readonly held = new Map<HTMLElement, (taken: boolean) => void>();
  /** What is on show in it, or was last; null before anything was. */
  private onShow: HTMLElement | null = null;

  constructor() {
    this.scrim.addEventListener('mousedown', (event) => {
      event.preventDefault();
      if (this.onShow) this.held.get(this.onShow)?.(false);
    });
  }

  /** Hold `el`, laid out and out of sight until it is shown; `close` closes it, for a press on the scrim or, `taken`, something else taking the drawer. */
  hold(el: HTMLElement, close: (taken: boolean) => void): void {
    el.classList.add('drawer-content');
    this.held.set(el, close);
    if (el.parentElement !== this.frame) this.frame.append(el);
  }

  /** Let go of `el`, closing the drawer first while it is what is on show, and taking it out, so it can be placed elsewhere. */
  release(el: HTMLElement): void {
    if (!this.held.has(el)) return;
    this.set(el, 'closed');
    this.held.delete(el);
    el.classList.remove('drawer-content', 'on');
    if (el.parentElement === this.frame) el.remove();
    if (this.onShow === el) this.onShow = null;
  }

  /** Stand as `state` for `el`: show it so, or, closed, close the drawer when `el` is the one on show; closing anything else changes nothing. */
  set(el: HTMLElement, state: DrawerState): void {
    if (state === 'closed') {
      if (el === this.onShow) this.place('closed');
      return;
    }
    const before = this.onShow;
    if (before !== el) {
      this.onShow = el;
      for (const held of this.held.keys()) held.classList.toggle('on', held === el);
      // What was on show closes its own way, after the drawer is already the newcomer's, so its closing does not close the drawer.
      if (before && this.state !== 'closed') this.held.get(before)?.(true);
    }
    this.place(state);
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
