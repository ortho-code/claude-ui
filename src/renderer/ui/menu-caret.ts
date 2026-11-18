import { element } from './dom';
import { setMarkup } from './keyed';
import { caretIcon } from './svg';
import './menu-caret.css';

/** The caret after a button's label that says a press opens a menu of choices, such as a diff's question or its view. */
export function menuCaret(): HTMLElement {
  const caret = element('span', 'menu-caret');
  setMarkup(caret, caretIcon(false, 10));
  return caret;
}
