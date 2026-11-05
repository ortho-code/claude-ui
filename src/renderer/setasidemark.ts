import type { SetAside } from '../shared/types';
import { iconMark, showIconMark } from './iconmark';
import { setAsideLabel } from './logic';
import { SET_ASIDE_ICON } from './svg';

/**
 * The bookmark beside a session you set aside for later (`AppState.setAside`): on its tab, its row in the list and its row in the strip, by one rule (decided 2026-10-29), as the scheduled clock is.
 * Its tooltip says the day and time it comes back, if it has one; the session's menu says the same in its header.
 */
export function setAsideMark(className: string, pill = false): HTMLElement {
  return iconMark(`set-aside-mark ${className}`, SET_ASIDE_ICON, pill);
}

/** Show the bookmark for a session's later mark, or hide it for none; says whether it shows. */
export function showSetAside(mark: HTMLElement, setAside: SetAside | undefined): boolean {
  return showIconMark(mark, setAside ? setAsideLabel(setAside) : null);
}
