import { fileWeights, pxOf, shareOf, type NodeSize } from './layout';

/**
 * How the children of one split share its length, as CSS flex values.
 * Pure: the tree measures and applies, this decides, tested per rule.
 *
 * ONE UNIT FOR EVERYTHING: a child's share of the flexible room is its flex-grow weight, and a dragged size is stored in px and used as that same weight, so a drag and the file's proportions mix without conversion and a window resize redistributes by weight on its own.
 * A child sized in PIXELS stands apart: its px are its basis, it never grows, and it gives way only once the others are down to their `min` (P10).
 */

/** A folded group's rail, in px along its parent's axis. */
export const RAIL = 28;

/** What the sizing needs to know about one child of a split. */
export interface FlexChild {
  id: string;
  size: NodeSize | null;
  min: number;
  folded: boolean;
}

/** The CSS for one child: its `flex`, and its min-width or min-height in px (none for a rail, which is exactly its own size). */
export interface FlexValue {
  flex: string;
  min: number | null;
}

/**
 * Each child's flex from the file's sizes and the dragged ones.
 * `stored` is the split's dragged px per child id, or undefined for none; it is honoured for the flexible children only when it holds EVERY one of them (decision 8), since weights from two sources do not mean anything together.
 */
export function flexFor(children: FlexChild[], stored: Record<string, number> | undefined): FlexValue[] {
  const flexible = children.filter((child) => !child.folded && pxOf(child) === null);
  const dragged = stored !== undefined && flexible.every((child) => stored[child.id] !== undefined);
  const file = fileWeights(flexible.map(shareOf)).weights;
  return children.map((child) => {
    if (child.folded) return { flex: `0 0 ${RAIL}px`, min: null };
    const px = pxOf(child);
    if (px !== null) return { flex: `0 1 ${stored?.[child.id] ?? px}px`, min: child.min };
    const weight = dragged ? stored[child.id] : file[flexible.indexOf(child)];
    return { flex: `${weight} 1 0px`, min: child.min };
  });
}

/**
 * Every child on show stored at the size it measures now; a folded child keeps what it had stored, which is its size from before it folded.
 * Taken at the start of a drag, so the layout does not jump when the flexible children switch from the file's weights to px, and before a fold, so the group unfolds to the size it had.
 */
export function snapshot(children: FlexChild[], measured: number[], previous: Record<string, number> = {}): Record<string, number> {
  const next: Record<string, number> = {};
  children.forEach((child, index) => {
    const kept = previous[child.id];
    if (!child.folded) next[child.id] = measured[index]!;
    else if (kept !== undefined) next[child.id] = kept;
  });
  return next;
}

/**
 * The stored sizes after dragging the divider between children `a` and `b` by `delta` px from where the drag started.
 * The two move against each other and nothing else moves; each stops at its `min`, and one already squeezed below it by a narrow window may not shrink further, but is not made to jump back up either.
 */
export function dragTo(children: FlexChild[], measured: number[], a: number, b: number, delta: number, previous: Record<string, number> = {}): Record<string, number> {
  const next = snapshot(children, measured, previous);
  const before = children[a]!;
  const after = children[b]!;
  const beforePx = measured[a]!;
  const afterPx = measured[b]!;
  const lowest = Math.min(0, before.min - beforePx);
  const highest = Math.max(0, afterPx - after.min);
  const moved = Math.min(highest, Math.max(lowest, delta));
  next[before.id] = beforePx + moved;
  next[after.id] = afterPx - moved;
  return next;
}

/**
 * A split's stored sizes if they still describe it, else undefined: they are dropped WHOLE once its set of children differs from the one they were stored for, so a file edit that adds or removes a child falls back to the file's sizes rather than keeping half of each (decision 8).
 */
export function keptSizes(stored: Record<string, number> | undefined, ids: string[]): Record<string, number> | undefined {
  if (!stored) return undefined;
  const keys = Object.keys(stored);
  return keys.length === ids.length && ids.every((id) => stored[id] !== undefined) ? stored : undefined;
}
