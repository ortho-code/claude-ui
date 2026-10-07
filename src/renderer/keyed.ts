/**
 * ELEMENTS KEPT BY KEY, for a surface drawn again while it is used: a render updates and places what is already on screen rather than building it again.
 *
 * WHY: a click is a press and a release on the same element, and the keyboard focus sits on one element.
 * A surface drawn again between the two takes the pressed element away, and no click is produced at all; the focus falls to the page.
 * The surfaces that keep their elements here are drawn again on events nobody times — the session list when a transcript is written or a model switched, the live strip whenever a session's status changes — so the press that lands mid-redraw is an everyday one rather than a race.
 * Building a new element loses both, and so does taking a kept one out and putting it back, which is what `replaceChildren`, `appendChild` and `insertBefore` do in Chromium to an element already in place: `placeChildren` is the half that leaves it there, and `setMarkup` the same for an icon inside it.
 */

/**
 * Elements by key, built the first time a render draws a key and the same element on every render after it, until a render no longer draws it.
 * `E` is whatever a surface keeps for one thing: an element, or an element with its parts; `root` names the element that goes on screen.
 * The builder is handed to `draw` rather than kept here, so where the elements are kept need not import what builds them.
 */
export class Keyed<E> {
  private readonly kept = new Map<string, E>();
  private drawn = new Set<string>();

  constructor(private readonly root: (kept: E) => Element) {}

  /** What `key` is drawn with: `build` the first time, the same one after that; drawing it keeps it past the next `sweep`. */
  draw(key: string, build: (key: string) => E): E {
    this.drawn.add(key);
    let kept = this.kept.get(key);
    if (kept === undefined) {
      kept = build(key);
      this.kept.set(key, kept);
    }
    return kept;
  }

  /** What is kept for `key`, if anything, without drawing it. */
  find(key: string): E | undefined {
    return this.kept.get(key);
  }

  /** Forget, and take off the screen, everything not drawn since the last sweep: a render draws what it shows and then sweeps. */
  sweep(): void {
    for (const [key, kept] of this.kept) {
      if (this.drawn.has(key)) continue;
      this.root(kept).remove();
      this.kept.delete(key);
    }
    this.drawn = new Set();
  }

  /** Forget everything, taking it off the screen. */
  clear(): void {
    this.drawn = new Set();
    this.sweep();
  }

  /** Everything kept, by key. */
  entries(): MapIterator<[string, E]> {
    return this.kept.entries();
  }

  /** Everything kept. */
  values(): MapIterator<E> {
    return this.kept.values();
  }
}

/**
 * Make `children`, each named once, the children of `parent`, in that order, moving as few of them as that can be done with.
 * What is not wanted goes first; of the rest, the longest run already in the wanted order stays where it is, and only the others are inserted.
 * So a render that changes nothing moves nothing, one that adds or removes a child moves no other, and one that moves a child moves one child.
 */
export function placeChildren(parent: Node, children: readonly Node[]): void {
  const order = new Map(children.map((child, at) => [child, at]));
  for (const node of [...parent.childNodes]) if (!order.has(node)) node.remove();
  const staying = longestInOrder([...parent.childNodes].map((node) => order.get(node)!));
  // From the end, each child before the one after it: what stays is in order among itself already, so putting the rest around it puts every child where it goes.
  let next: Node | null = null;
  for (let at = children.length - 1; at >= 0; at--) {
    const child = children[at]!;
    if (!staying.has(at) && !(child.parentNode === parent && child.nextSibling === next)) parent.insertBefore(child, next);
    next = child;
  }
}

/** The values of a longest run of `sequence` that rises from left to right, not necessarily side by side: of a parent's children, by their wanted places, the ones that are in order already. */
export function longestInOrder(sequence: readonly number[]): Set<number> {
  // ends[k] is where in `sequence` the lowest-ending rising run of length k + 1 ends, and before[i] the run's previous step before i.
  const ends: number[] = [];
  const before: number[] = [];
  sequence.forEach((value, i) => {
    let low = 0;
    let high = ends.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (sequence[ends[middle]!]! < value) low = middle + 1;
      else high = middle;
    }
    before[i] = low > 0 ? ends[low - 1]! : -1;
    ends[low] = i;
  });
  const run = new Set<number>();
  for (let i = ends.at(-1) ?? -1; i >= 0; i = before[i]!) run.add(sequence[i]!);
  return run;
}

/** The markup each element was last given by `setMarkup`. */
const markups = new WeakMap<Element, string>();

/**
 * Give `el` this markup, leaving what is in it alone when it already has it: a press on an icon is a press on the icon's own element, which setting the same markup again would take away.
 * An element given its markup here is given it only here, since a change made around it would go unseen.
 */
export function setMarkup(el: Element, markup: string): void {
  if (markups.get(el) === markup) return;
  markups.set(el, markup);
  el.innerHTML = markup;
}
