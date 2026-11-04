import { element } from '../dom';
import { setTooltip } from '../tooltip';
import type { PanelView } from './contract';
import { iconSvg } from './icons';

/**
 * THE SWITCH BETWEEN A PANEL'S VIEWS, one button per view: a list panel's header draws it (tree.ts), and it is kept apart for a panel that draws its own switch.
 * Its look is in `tree.css`, beside the rail's, whose rules it shares: the one on show filled at rest as a rail's panel on show is.
 */

/** A view's button in a panel's switch, in the compact box the header's other button takes; the view on show is marked pressed, and a press on it does nothing. */
export function viewButton(view: PanelView, shown: boolean, pick: () => void): HTMLButtonElement {
  const button = element('button', 'icon-btn compact panel-view');
  button.type = 'button';
  button.setAttribute('aria-label', view.label);
  button.setAttribute('aria-pressed', String(shown));
  setTooltip(button, view.label);
  button.innerHTML = iconSvg(view.icon);
  if (!shown) button.addEventListener('click', pick);
  return button;
}
