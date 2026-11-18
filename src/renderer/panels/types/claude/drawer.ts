import { element } from '../../../ui/dom';
import './drawer.css';

/** How the drawer stands: closed; over a live claude, slid in beside it with claude dimmed; or over the whole pane, standing in for a tab with no claude behind it. */
export type DrawerState = 'closed' | 'over' | 'whole';

/**
 * The one drawer over the terminal area, which the terminal area owns and whatever it holds is drawn in.
 * Over a live claude it slides in from the right over about two-thirds of the pane, never narrower than 560px, and claude stays in view on the left, dimmed under the scrim, at its real size, so it never redraws; a press on the scrim is the way back.
 * It is KEPT LAID OUT while closed, hidden by visibility and never by display, so what it holds can still be measured, which is how the history's bar places its marks.
 */
export class Drawer {
  /** The drawer itself, which what it holds goes into. */
  readonly frame = element('div', 'drawer');
  /** What dims claude beside it while it is over a live claude; it goes into the terminal area just before `frame`. */
  readonly scrim = element('div', 'drawer-scrim');
  private state: DrawerState = 'closed';

  /** `close` is a press on the scrim. */
  constructor(close: () => void) {
    this.scrim.addEventListener('mousedown', (event) => {
      event.preventDefault();
      close();
    });
  }

  set(state: DrawerState): void {
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
