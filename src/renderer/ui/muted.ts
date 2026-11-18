import { element } from './dom';
import './muted.css';

/** `words` in the muted ink, to sit beside text in the normal one, such as the folders before a file's name. */
export function mutedText(words: string): HTMLElement {
  const span = element('span', 'muted-text');
  span.textContent = words;
  return span;
}
