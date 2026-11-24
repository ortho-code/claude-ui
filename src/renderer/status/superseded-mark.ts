import type { SupersededCopy } from '../../shared/types';
import { iconMark, showIconMark } from '../ui/icon-mark';
import { momentInLanguage } from '../ui/locale';
import { COPY_ICON } from '../ui/svg';

/**
 * The two pages beside a session with a superseded copy of its transcript: what was said only in that copy, such as while two claudes ran the session at once, is not in the session's history.
 * Its tooltip says when each copy was replaced and how many of its requests the current transcript lacks; it goes when Claude Code's cleanup deletes the copy.
 */
export function supersededMark(className: string, pill = false): HTMLElement {
  return iconMark(`superseded-mark ${className}`, COPY_ICON, pill);
}

/** What a session's superseded copies say, a line each, or null for none: the mark's tooltip and the row's say the same. */
export function supersededLines(copies: readonly SupersededCopy[]): string | null {
  if (copies.length === 0) return null;
  return copies.map(({ at, missing }) => `An older copy of this session, replaced ${momentInLanguage(at)}, has ${missing === 0 ? 'no request' : missing === 1 ? '1 request' : `${missing} requests`} the current one lacks.`).join('\n');
}

/** Show the mark for a session's superseded copies, or hide it for none; says whether it shows. */
export function showSuperseded(mark: HTMLElement, copies: readonly SupersededCopy[]): boolean {
  return showIconMark(mark, supersededLines(copies));
}
