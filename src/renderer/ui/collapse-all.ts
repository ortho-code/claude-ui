import { setMarkup } from './keyed';
import { strokeIcon } from './svg';
import { setUnavailable } from './unavailable';

// Chevrons stacked in the direction things will move: up to fold everything away, down to open it again.
// Ink centred on 8,8 like the row icons, so the glyph sits square in its button.
const COLLAPSE_ALL_ICON = strokeIcon(14, '<path d="M4 7.25L8 3.75L12 7.25" /><path d="M4 12.25L8 8.75L12 12.25" />');
const EXPAND_ALL_ICON = strokeIcon(14, '<path d="M4 3.75L8 7.25L12 3.75" /><path d="M4 8.75L8 12.25L12 8.75" />');

/**
 * A collapse-all button as it now stands: Expand all once everything it folds is folded, else Collapse all, its icon saying which; unavailable with `reason` when there is nothing to fold.
 * A redraw that changes nothing leaves its icon's element as it is, which a press on the button is mostly on (keyed.ts).
 */
export function drawCollapseAll(button: HTMLButtonElement, allFolded: boolean, reason: string | null): void {
  const label = allFolded ? 'Expand all' : 'Collapse all';
  setUnavailable(button, reason, label);
  setMarkup(button, allFolded ? EXPAND_ALL_ICON : COLLAPSE_ALL_ICON);
  button.setAttribute('aria-label', label);
}
