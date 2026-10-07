import { fileWeights, pxOf, shareOf, type NodeSize } from './layout';

/**
 * How the children of one split share its length, as CSS flex values.
 * Pure: the tree measures and applies, this decides, tested per rule.
 *
 * A child's share of the flexible room is its flex-grow weight, and a size dragged to is kept in its node's own unit — a share as a share, pixels as pixels — over the file's, per node (`sizesAfterDrag`), so a window resize redistributes by weight on its own and a sibling the file adds later takes what the file gives it.
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

/** Each child's flex from its size as it stands, the app's over the file's (`withOverrides`). */
export function flexFor(children: FlexChild[]): FlexValue[] {
  const flexible = children.filter((child) => !child.folded && pxOf(child) === null);
  const weights = fileWeights(flexible.map(shareOf)).weights;
  return children.map((child) => {
    if (child.folded) return { flex: `0 0 ${RAIL}px`, min: null };
    const px = pxOf(child);
    if (px !== null) return { flex: `0 1 ${px}px`, min: child.min };
    return { flex: `${weights[flexible.indexOf(child)]} 1 0px`, min: child.min };
  });
}

/**
 * What each child measures after dragging the divider between children `a` and `b` by `delta` px from where the drag started.
 * The two move against each other and nothing else moves; each stops at its `min`, and one already squeezed below it by a narrow window may not shrink further, but is not made to jump back up either.
 */
export function dragTargets(children: FlexChild[], measured: number[], a: number, b: number, delta: number): number[] {
  const before = children[a]!;
  const after = children[b]!;
  const beforePx = measured[a]!;
  const afterPx = measured[b]!;
  const lowest = Math.min(0, before.min - beforePx);
  const highest = Math.max(0, afterPx - after.min);
  const moved = Math.min(highest, Math.max(lowest, delta));
  return measured.map((px, index) => (index === a ? beforePx + moved : index === b ? afterPx - moved : px));
}

/** A share as the app writes it: four places, which keeps a window of up to 10,000 px within half a pixel and the file readable. */
export const roundShare = (share: number): number => Math.round(share * 10_000) / 10_000;

/**
 * The size overrides a drag writes, each in its node's own unit, so that the split shows exactly what the drag left on screen (`targets`, from `dragTargets`).
 * A pixel node beside the divider takes its new px.
 * The flexible children's weights are scaled from what they were, so their sum holds wherever it can and a sibling the drag did not touch keeps its place: each written child's new share is its old weight per px of the room it shared, times what it measures now.
 * That is written for the two beside the divider when that alone puts every flexible child where it should be, and for every flexible child on show when it does not, which is when a share given to a child without one would change what its unsized siblings get; with every flexible child a share, the weights are the shares, so that is always exact.
 * A lone flexible child takes whatever room is left, so it is never written.
 * `children` carry their sizes as they are now, the app's overrides included; a folded child takes no part and keeps its own.
 */
export function sizesAfterDrag(children: FlexChild[], measured: number[], targets: number[], a: number, b: number): Record<string, NodeSize> {
  const written: Record<string, NodeSize> = {};
  for (const index of [a, b]) if (pxOf(children[index]!) !== null) written[children[index]!.id] = { px: Math.round(targets[index]!) };
  const flexible = children.flatMap((child, index) => (!child.folded && pxOf(child) === null ? [index] : []));
  if (flexible.length <= 1) return written;
  const weights = fileWeights(flexible.map((index) => shareOf(children[index]!))).weights;
  const perPx = weights.reduce((sum, weight) => sum + weight, 0) / flexible.reduce((sum, index) => sum + measured[index]!, 0);
  const shareFor = (index: number): number => roundShare(perPx * targets[index]!);
  const room = flexible.reduce((sum, index) => sum + targets[index]!, 0);
  // Whether writing shares for `which` puts every flexible child within half a pixel of where the drag left it.
  const exact = (which: number[]): boolean => {
    const after = fileWeights(flexible.map((index) => (which.includes(index) ? shareFor(index) : shareOf(children[index]!)))).weights;
    const total = after.reduce((sum, weight) => sum + weight, 0);
    return flexible.every((index, at) => Math.abs((after[at]! / total) * room - targets[index]!) < 0.5);
  };
  const pair = [a, b].filter((index) => flexible.includes(index));
  for (const index of exact(pair) ? pair : flexible) written[children[index]!.id] = { share: shareFor(index) };
  return written;
}

/**
 * A split's children's sizes with the app's overrides over the file's, or the file's alone where the overrides would leave an unsized child no share when the file's do not.
 * The app's file never makes your layout wrong: what it would do here is raise the "shares leave nothing" note about a file that does not say so, so the split goes back to the file's sizes, and `dropped` says so for the log.
 * Judged over the same children the validator's note is, every child without a pixel size.
 */
export function withOverrides(children: { id: string; size: NodeSize | null }[], overrides: Record<string, NodeSize | undefined>): { sizes: (NodeSize | null)[]; dropped: boolean } {
  const sizes = children.map((child) => overrides[child.id] ?? child.size);
  const exhausted = (all: (NodeSize | null)[]): boolean => fileWeights(all.flatMap((size) => (size === null ? [null] : 'share' in size ? [size.share] : []))).exhausted;
  const file = children.map((child) => child.size);
  return exhausted(sizes) && !exhausted(file) ? { sizes: file, dropped: true } : { sizes, dropped: false };
}

/**
 * A split's stored sizes if they still describe it, else undefined: they are dropped WHOLE once its set of children differs from the one they were stored for, so a file edit that adds or removes a child falls back to the file's sizes rather than keeping half of each (decision 8).
 */
export function keptSizes(stored: Record<string, number> | undefined, ids: string[]): Record<string, number> | undefined {
  if (!stored) return undefined;
  const keys = Object.keys(stored);
  return keys.length === ids.length && ids.every((id) => stored[id] !== undefined) ? stored : undefined;
}
