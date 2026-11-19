import { setMarkup } from './keyed';
import { strokeIcon } from './svg';
import { setUnavailable } from './unavailable';

// Two chevrons, as a code editor's fold-all draws them: pointing at each other to fold everything together, pointing apart to open it out again (decided 2026-11-19).
// Each chevron 3 units tall, with 4 clear between them, so the two read as a pair rather than as an X or a diamond; ink centred on 8,8 like the row icons, so the glyph sits square in its button.
const COLLAPSE_ALL_ICON = strokeIcon(14, '<path d="M4.5 3L8 6L11.5 3" /><path d="M4.5 13L8 10L11.5 13" />');
const EXPAND_ALL_ICON = strokeIcon(14, '<path d="M4.5 6L8 3L11.5 6" /><path d="M4.5 10L8 13L11.5 10" />');

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
