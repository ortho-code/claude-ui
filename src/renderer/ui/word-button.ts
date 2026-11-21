import { element } from './dom';
import './word-button.css';

/** A button that reads as words of the line it sits in, pressed as a link is, in the class given too. */
export function wordButton(className: string): HTMLButtonElement {
  const button = element('button', `word-button ${className}`);
  button.type = 'button';
  return button;
}
