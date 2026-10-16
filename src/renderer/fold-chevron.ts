import { element } from './dom';
import { setMarkup } from './keyed';
import { chevronIcon, type Direction } from './svg';
import { setTooltip } from './tooltip';
import './fold-chevron.css';

/**
 * THE FOLD CHEVRON: a thin tab laid on a line, which folds what is beside the line away and back, pointing the way that edge moves and turned round while it is folded.
 * The chevron a panel group folds from on the divider beside it (panels/tree.ts), the tab bar on the line under it (panels/types/claude/tab-bar.ts), and a panel's tabs on its header's bottom line (panels/tabs.ts).
 * How it looks is here and in its stylesheet, for a line that runs down or across (`line`); how far across the line it sits, and when its line counts as pointed at, are the surface's.
 * Its mark sits in an element of its own, so a surface can give the chevron more, such as the tab bar's dot, which drawing the mark again leaves where it is.
 */
export function foldChevron(line: 'vertical' | 'horizontal'): HTMLButtonElement {
  const chevron = element('button', `icon-btn framed fold-chev ${line}`);
  chevron.type = 'button';
  chevron.append(element('span', 'fold-chev-mark'));
  return chevron;
}

/**
 * Offer a fold of rows, such as the tab bar's or a panel's tabs', only while there is something to fold: two or more rows unfolded, folded or not.
 * Folded is a stance all the same, kept unseen on one row, so a second row comes up folded, with the chevron to open it.
 */
export function offerRowFold(chevron: HTMLButtonElement, openRows: number): void {
  chevron.hidden = openRows < 2;
}

/** Draw a fold chevron as its fold now is: the way it points, and what a press does, said by its tooltip and its `aria-label`, one string. */
export function drawFoldChevron(chevron: HTMLButtonElement, direction: Direction, label: string): void {
  const mark = chevron.querySelector(':scope > .fold-chev-mark');
  if (mark) setMarkup(mark, chevronIcon(direction, 10));
  chevron.setAttribute('aria-label', label);
  setTooltip(chevron, label);
}
