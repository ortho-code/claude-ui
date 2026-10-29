import { setTooltip } from './tooltip';

/**
 * A wordless mark beside a session, its words in its tooltip: on its tab, its row in the list and its row in the strip, built here once so each kind of mark is the same element on all three.
 * Each surface places it and gives it its look, `className`; a row's marks are pills, so there the icon sits in the pill's icon box (`pill`), as the row's worktree mark's does.
 */
export function iconMark(className: string, icon: string, pill = false): HTMLElement {
  const mark = document.createElement('span');
  mark.className = className;
  mark.innerHTML = pill ? `<span class="badge-icon">${icon}</span>` : icon;
  mark.hidden = true;
  return mark;
}

/** Show the mark with `text` as its tooltip, or hide it for null; says whether it shows. */
export function showIconMark(mark: HTMLElement, text: string | null): boolean {
  mark.hidden = text === null;
  setTooltip(mark, text);
  // Wordless, so it carries its words for a screen reader too.
  if (text) mark.setAttribute('aria-label', text);
  else mark.removeAttribute('aria-label');
  return text !== null;
}
