import type { Later } from '../shared/types';
import { iconMark, showIconMark } from './iconmark';
import { laterLabel } from './logic';
import { LATER_ICON } from './svg';

/**
 * The bookmark beside a session you set aside for later (`AppState.later`): on its tab, its row in the list and its row in the strip, by one rule (decided 2026-10-29), as the scheduled clock is.
 * Its tooltip says the day and time it comes back, if it has one; the session's menu says the same in its header.
 */
export function laterMark(className: string, pill = false): HTMLElement {
  return iconMark(`later-mark ${className}`, LATER_ICON, pill);
}

/** Show the bookmark for a session's later mark, or hide it for none; says whether it shows. */
export function showLater(mark: HTMLElement, later: Later | undefined): boolean {
  return showIconMark(mark, later ? laterLabel(later) : null);
}
