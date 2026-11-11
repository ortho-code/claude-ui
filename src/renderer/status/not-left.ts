import { notLeftWords, type TabButtonTab } from '../rules/claude';
import './not-left.css';

/**
 * The words beside a session's name for a stop claude has not answered by leaving (`notLeftWords`): on its tab, and on its row in the list, which follows the session's first tab.
 * ONE element for the three, built and written here, as the clock is (scheduled-mark.ts); each surface places it, and names it with `className`.
 */
export function notLeftMark(className: string): HTMLElement {
  const mark = document.createElement('span');
  mark.className = `not-left ${className}`;
  mark.hidden = true;
  return mark;
}

/** Show the words for the tab running the session, or hide them; says whether they show. */
export function showNotLeft(mark: HTMLElement, tab: TabButtonTab | undefined): boolean {
  const words = tab ? notLeftWords(tab) : null;
  mark.hidden = words === null;
  mark.textContent = words ?? '';
  return words !== null;
}
