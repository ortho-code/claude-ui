import { element } from '../ui/dom';
import { setTooltip } from '../ui/tooltip';
import './rail.css';

/**
 * A RAIL OF ICONS, one look and one behaviour wherever there is one: a panel group's switcher (tree.ts).
 * The one on show is filled and edged in the accent on the side away from what it switches; a press on another shows that one, and a press on the one on show puts the whole away, where that can be done.
 */

/** The strip itself, along `axis`, its edge the side it stands on. */
export function railStrip(axis: 'vertical' | 'horizontal', edge: 'start' | 'end'): HTMLElement {
  return element('div', `panel-rail ${axis} ${edge}`);
}

/** One of its icons: `label` its tooltip and its name, `onShow` the one on show, `putsAway` whether a press on that one puts the whole away. */
export function railItem(item: { icon: string; label: string; onShow: boolean; putsAway: boolean; press(): void }): HTMLButtonElement {
  const button = element('button', 'icon-btn rail-item dotted-icon');
  button.type = 'button';
  button.innerHTML = item.icon;
  button.setAttribute('aria-label', item.label);
  setTooltip(button, item.label);
  if (item.onShow) {
    button.classList.add('shown');
    // Nothing for a click to do where the whole cannot be put away, so no pointer cursor to claim one.
    button.classList.toggle('no-fold', !item.putsAway);
    button.setAttribute('aria-current', 'true');
  }
  button.addEventListener('click', () => item.press());
  return button;
}
