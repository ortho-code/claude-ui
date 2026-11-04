import { element } from '../dom';
import { setTooltip } from '../tooltip';
import type { PanelView } from './contract';
import { iconSvg } from './icons';

/**
 * THE SWITCH BETWEEN A PANEL'S VIEWS, one button per view: a list panel's header draws it (tree.ts) with each view's icon, and the session list's row under its header with each one's words, Grouped and Recent (sessions/arrangement.ts), where the row has room for them.
 * Its look is in `tree.css`, beside the rail's, whose rules it shares: the one on show filled at rest as a rail's panel on show is.
 */

/** A view's button in a panel's switch, in the compact box the header's other button takes, or saying its label where `worded`; the view on show is marked pressed, and a press on it does nothing. */
export function viewButton(view: PanelView, shown: boolean, pick: () => void, worded = false): HTMLButtonElement {
  const button = element('button', `icon-btn compact panel-view${worded ? ' worded' : ''}`);
  button.type = 'button';
  button.setAttribute('aria-label', view.label);
  button.setAttribute('aria-pressed', String(shown));
  setTooltip(button, view.label);
  if (worded) button.textContent = view.label;
  else button.innerHTML = iconSvg(view.icon);
  if (!shown) button.addEventListener('click', pick);
  return button;
}
