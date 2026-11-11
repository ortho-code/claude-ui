import { iconMark, showIconMark } from '../ui/icon-mark';
import { NOTE_ICON } from '../ui/svg';
import './note-mark.css';

/** How much of a note its mark shows on hover; the whole note is in Edit note, which a press on the mark opens. */
const NOTE_PREVIEW = 400;

/**
 * The page beside a session you attached a note to (`AppState.notes`), its text on hover and a press opening it to edit (`onPress`).
 * ONE mark for every surface that shows a session's note (`iconMark`), so it reads and acts the same on each; each surface places it.
 */
export function noteMark(onPress: () => void): HTMLElement {
  const mark = iconMark('note-badge', NOTE_ICON);
  mark.addEventListener('click', (event) => {
    // Its own press, not the row's.
    event.stopPropagation();
    onPress();
  });
  return mark;
}

/** Show the mark with the start of `note` on hover, or hide it for no note; says whether it shows. */
export function showNote(mark: HTMLElement, note: string | undefined): boolean {
  if (!note) return showIconMark(mark, null);
  return showIconMark(mark, note.length > NOTE_PREVIEW ? `${note.slice(0, NOTE_PREVIEW)}…` : note);
}
