/** A new element with its classes, for the code that builds panels out of plain DOM. */
export function element<K extends keyof HTMLElementTagNameMap>(tag: K, className = ''): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (className) el.className = className;
  return el;
}

/**
 * One element built from markup the app writes itself, never from data, for a part whose structure reads best as HTML: built detached, by the module that draws it, for whoever assembles the parts to place.
 * Exactly one root, so a part is one thing to place, and of `kind` when given, as `byId` checks it.
 */
export function fromMarkup(markup: string): HTMLElement;
export function fromMarkup<T extends HTMLElement>(markup: string, kind: abstract new () => T): T;
export function fromMarkup(markup: string, kind: abstract new () => HTMLElement = HTMLElement): HTMLElement {
  const holder = document.createElement('div');
  holder.innerHTML = markup.trim();
  const root = holder.firstElementChild;
  if (!(root instanceof kind) || holder.childElementCount !== 1) throw new Error(`fromMarkup takes markup with exactly one root element, a ${kind.name}.`);
  root.remove();
  return root;
}

/**
 * An element of a part, by its id, found inside the part rather than the document, since a part is read before it is placed; `kind` says what it must be (a button, an input), checked rather than assumed.
 * One that is missing, or of another kind, is a mistake in the part's own markup.
 */
export function byId(root: ParentNode, id: string): HTMLElement;
export function byId<T extends HTMLElement>(root: ParentNode, id: string, kind: abstract new () => T): T;
export function byId(root: ParentNode, id: string, kind: abstract new () => HTMLElement = HTMLElement): HTMLElement {
  const found = root.querySelector(`#${id}`);
  if (!(found instanceof kind)) throw new Error(`#${id} is not in its part's markup${found ? ` as a ${kind.name}` : ''}.`);
  return found;
}
