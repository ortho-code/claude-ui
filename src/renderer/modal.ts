/**
 * Run a modal to completion.
 *
 * Everything a modal in this app does the same way: show the overlay, close on Escape from anywhere,
 * unbind every listener exactly once, and resolve a promise with the result.
 * `bind` wires the modal's own controls and returns the unbinds; `escapeValue` is what Escape means
 * for this modal, which is the only part that genuinely differs between them.
 *
 * Escape is bound on the DOCUMENT rather than the dialog: clicking the dialog's own text blurs the
 * field, and with no backdrop dismiss that would leave Cancel as the only way out.
 * There is deliberately no backdrop dismiss — selecting text inside the dialog and releasing outside
 * it dispatches the click on the overlay, which threw the dialog away mid-drag.
 */
export function runModal<T>(overlay: HTMLElement, escapeValue: T, bind: (finish: (result: T) => void) => (() => void)[]): Promise<T> {
  overlay.hidden = false;
  return new Promise<T>((resolve) => {
    let unbind: (() => void)[] = [];
    const finish = (result: T): void => {
      overlay.hidden = true;
      for (const off of unbind) off();
      document.removeEventListener('keydown', onKey);
      resolve(result);
    };
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') finish(escapeValue);
    };
    document.addEventListener('keydown', onKey);
    unbind = bind(finish);
  });
}

/** Add a listener and hand back the function that removes it, so a modal cannot forget one. */
export function listen<K extends keyof HTMLElementEventMap>(el: HTMLElement, type: K, handler: (event: HTMLElementEventMap[K]) => void): () => void {
  el.addEventListener(type, handler);
  return () => el.removeEventListener(type, handler);
}
