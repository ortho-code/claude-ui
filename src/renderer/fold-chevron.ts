import { element } from './dom';
import { setMarkup } from './keyed';
import { chevronIcon, type Direction } from './svg';
import { setTooltip } from './tooltip';
import './fold-chevron.css';

/**
 * THE FOLD CHEVRON: a thin tab laid on a line, which folds what is beside the line away and back, pointing the way that edge moves and turned round while it is folded.
 * The chevron a panel group folds from on the divider beside it (panels/tree.ts).
 * How it looks is here and in its stylesheet, for a line that runs down or across (`line`); how far across the line it sits, and when its line counts as pointed at, are the surface's.
 */
export function foldChevron(line: 'vertical' | 'horizontal'): HTMLButtonElement {
  const chevron = element('button', `icon-btn framed fold-chev ${line}`);
  chevron.type = 'button';
  return chevron;
}

/** Draw a fold chevron as its fold now is: the way it points, and what a press does, said by its tooltip and its `aria-label`, one string. */
export function drawFoldChevron(chevron: HTMLButtonElement, direction: Direction, label: string): void {
  setMarkup(chevron, chevronIcon(direction, 10));
  chevron.setAttribute('aria-label', label);
  setTooltip(chevron, label);
}
