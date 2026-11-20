import { placeChildren } from '../../../ui/keyed';

/**
 * PUTTING A DRAW'S ROWS ON THE PAGE, A BATCH A FRAME: a draw puts at most `ROWS_PER_FRAME` rows that are not on the page yet into it, in the order it places them, which is the list's order from the top, and the rest that many a frame after it; a newer draw drops what an older one left.
 * Many rows come back at once when a filter changes, and the list then starts at its top, so the rows in sight go in first; at a thousand sessions on a slower machine, putting six hundred rows on the page in one go took longer than a key's 200 ms.
 * What is not a row, such as a group's section, is always placed at once, so no row goes into a section that is not on the page.
 */

/** How many rows not yet on the page one frame puts there. */
const ROWS_PER_FRAME = 60;

let budget = Infinity;
let draws = 0;
let left: [Node, readonly Node[]][] = [];

/**
 * Run `draw`, whose rows go on the page through `placeRows` a batch a frame, and `followed` after each later batch, for what draws over the rows on the page, such as bulk mode's boxes.
 */
export function inBatches(draw: () => void, followed: () => void): void {
  draws++;
  left = [];
  budget = ROWS_PER_FRAME;
  try {
    draw();
  } finally {
    budget = Infinity;
  }
  if (left.length > 0) placeLater(draws, followed);
}

/** `placeChildren`, putting on the page only as many rows of `children` not on it yet as this frame has left, and the rest in a frame to come; outside `inBatches`, all at once. */
export function placeRows(parent: Node, children: readonly Node[]): void {
  const now: Node[] = [];
  let leftOut = false;
  for (const child of children) {
    if (child.parentNode === parent || !isRow(child)) now.push(child);
    else if (budget > 0) {
      budget--;
      now.push(child);
    } else leftOut = true;
  }
  placeChildren(parent, now);
  if (leftOut) left.push([parent, children]);
}

function isRow(node: Node): boolean {
  return node instanceof HTMLElement && node.classList.contains('session');
}

/** The next batch of what draw number `draw` left, in the next frame, unless a newer draw came first. */
function placeLater(draw: number, followed: () => void): void {
  requestAnimationFrame(() => {
    if (draw !== draws) return;
    const todo = left;
    left = [];
    budget = ROWS_PER_FRAME;
    try {
      for (const [parent, children] of todo) placeRows(parent, children);
    } finally {
      budget = Infinity;
    }
    followed();
    if (left.length > 0) placeLater(draw, followed);
  });
}
