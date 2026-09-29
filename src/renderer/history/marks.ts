/**
 * The arithmetic of the bar beside the history, kept free of the DOM so it can be tested: what the pointer is on, and how far a wheel movement steps.
 */

/** A request or its reply, as the bar and the loupe address them: `k` is the exchange's index in the history. */
export interface Entry {
  k: number;
  part: 'request' | 'reply';
}

/** One exchange on the bar, in pixels from the bar's top: where its request starts, and where its reply does (null for none). */
export interface MarkAt {
  k: number;
  request: number;
  reply: number | null;
}

/**
 * What the pointer at `y` is on: the last mark that starts at or above it, as its request when the pointer is near the tick, as its reply once it is on the reply's bar.
 * A request whose tick lies within 2px below the pointer wins, so a tick can be hit from just above it.
 */
export function entryAt(marks: readonly MarkAt[], y: number): Entry | null {
  if (marks.length === 0) return null;
  let lo = 0;
  let hi = marks.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (marks[mid]!.request <= y) lo = mid;
    else hi = mid - 1;
  }
  const mark = marks[lo]!;
  const next = marks[lo + 1];
  if (y < mark.request) return { k: mark.k, part: 'request' };
  if (next && next.request - y < 2) return { k: next.k, part: 'request' };
  const reply = mark.reply;
  if (reply === null || y <= Math.max(reply, mark.request + 3)) return { k: mark.k, part: 'request' };
  return { k: mark.k, part: 'reply' };
}

/**
 * How many entries a wheel event steps, one at a time however dense the bar: one per notch of a mouse wheel, and for a trackpad's small deltas one per 30px, with the remainder carried to the next event.
 * A notch is a line-mode event, or a pixel one of 50 or more, which is what a mouse wheel sends and a trackpad does not.
 */
export function wheelSteps(deltaMode: number, deltaY: number, carry: number): { steps: number; carry: number } {
  if (deltaY === 0) return { steps: 0, carry };
  if (deltaMode !== 0 || Math.abs(deltaY) >= 50) return { steps: Math.sign(deltaY), carry: 0 };
  const total = carry + deltaY / 30;
  const steps = Math.trunc(total);
  return { steps, carry: total - steps };
}
